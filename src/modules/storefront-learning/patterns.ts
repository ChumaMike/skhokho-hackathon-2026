/**
 * Pattern learning — INTERNAL to the platform. Never shown to merchants.
 *
 *   published storefronts → performance (from daily counters)
 *     → pattern detection (structure only) → CANDIDATE
 *     → platform review → APPROVED → used by the planner/AI for new storefronts
 *
 * Rules that keep this safe:
 *  - A pattern is STRUCTURE only: vertical, template, visible section order,
 *    main action. Never a merchant's words, colours, name, photos or catalogue.
 *  - A candidate needs at least MIN_BUSINESSES different businesses showing
 *    the structure, so one merchant's storefront can never become a pattern.
 *  - Nothing is used for new storefronts until a platform admin approves it.
 *  - Businesses that opted out (settings.storefrontLearning.contribute ===
 *    false) are left out of the evidence entirely.
 */

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { parseSpec, type StorefrontSpec } from '@/modules/storefront-spec/spec'
import type { PatternShape } from './learned-pattern'

export type { PatternShape } from './learned-pattern'

export const MIN_BUSINESSES = 3
export const MIN_VISITS = 300
export const MIN_LIFT = 0.15
export const LEARNING_WINDOW_DAYS = 90

/** Conversions: the actions that are the point of a storefront. */
const CONVERSION_EVENTS = ['ORDER_PLACED', 'BOOKING_SUBMITTED', 'ENQUIRY_CLICK'] as const

export function patternFromSpec(spec: StorefrontSpec): PatternShape {
  return {
    vertical: spec.strategy.vertical,
    templateId: spec.templateId ?? null,
    sections: spec.home.sections.filter((s) => s.visible).map((s) => s.id),
    ctaAction: spec.cta.action,
  }
}

export function patternSignature(pattern: PatternShape): string {
  const canonical = JSON.stringify([pattern.vertical, pattern.templateId ?? '', pattern.sections, pattern.ctaAction])
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32)
}

export interface RevisionPerformance {
  businessId: string
  pattern: PatternShape
  visits: number
  conversions: number
}

export interface DetectedPattern {
  signature: string
  pattern: PatternShape
  evidence: {
    businesses: number
    visits: number
    conversions: number
    conversionRate: number
    baselineRate: number
    lift: number
    windowDays: number
  }
}

/** Pure: which structures clearly outperform their vertical, across enough businesses. */
export function detectPatterns(
  rows: RevisionPerformance[],
  thresholds = { minBusinesses: MIN_BUSINESSES, minVisits: MIN_VISITS, minLift: MIN_LIFT },
  windowDays = LEARNING_WINDOW_DAYS,
): DetectedPattern[] {
  const baseline = new Map<string, { visits: number; conversions: number }>()
  const groups = new Map<string, { pattern: PatternShape; businesses: Set<string>; visits: number; conversions: number }>()

  for (const row of rows) {
    const b = baseline.get(row.pattern.vertical) ?? { visits: 0, conversions: 0 }
    b.visits += row.visits
    b.conversions += row.conversions
    baseline.set(row.pattern.vertical, b)

    const signature = patternSignature(row.pattern)
    const g = groups.get(signature) ?? { pattern: row.pattern, businesses: new Set<string>(), visits: 0, conversions: 0 }
    g.businesses.add(row.businessId)
    g.visits += row.visits
    g.conversions += row.conversions
    groups.set(signature, g)
  }

  const detected: DetectedPattern[] = []
  for (const [signature, g] of groups) {
    const base = baseline.get(g.pattern.vertical)!
    const baselineRate = base.visits > 0 ? base.conversions / base.visits : 0
    const rate = g.visits > 0 ? g.conversions / g.visits : 0
    const lift = baselineRate > 0 ? rate / baselineRate - 1 : 0
    if (g.businesses.size < thresholds.minBusinesses || g.visits < thresholds.minVisits || lift < thresholds.minLift) continue
    detected.push({
      signature,
      pattern: g.pattern,
      evidence: {
        businesses: g.businesses.size,
        visits: g.visits,
        conversions: g.conversions,
        conversionRate: Number(rate.toFixed(4)),
        baselineRate: Number(baselineRate.toFixed(4)),
        lift: Number(lift.toFixed(3)),
        windowDays,
      },
    })
  }
  return detected.sort((a, b) => b.evidence.lift - a.evidence.lift)
}

/** What merchants changed about an AI draft before publishing — a learning signal, structure-level only. */
export function editSignals(original: StorefrontSpec, published: StorefrontSpec) {
  const o = patternFromSpec(original)
  const p = patternFromSpec(published)
  return {
    templateChanged: o.templateId !== p.templateId,
    sectionsChanged: JSON.stringify(o.sections) !== JSON.stringify(p.sections),
    ctaChanged: o.ctaAction !== p.ctaAction,
    copyChanged:
      original.content.heroHeadline !== published.content.heroHeadline ||
      original.content.heroSubline !== published.content.heroSubline ||
      original.content.aboutBody !== published.content.aboutBody,
  }
}

function contributes(settings: unknown): boolean {
  const learning = (settings as { storefrontLearning?: { contribute?: unknown } } | null)?.storefrontLearning
  return learning?.contribute !== false
}

/** Performance per published storefront revision over the learning window. */
export async function gatherPerformance(now: Date = new Date()): Promise<RevisionPerformance[]> {
  const since = new Date(now.getTime() - LEARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const grouped = await prisma.storefrontDailyStat.groupBy({
    by: ['businessId', 'revisionId', 'event', 'page'],
    where: { day: { gte: since }, revisionId: { not: '' }, event: { in: ['PAGE_VIEW', ...CONVERSION_EVENTS] } },
    _sum: { count: true },
  })

  const byRevision = new Map<string, { businessId: string; visits: number; conversions: number }>()
  for (const g of grouped) {
    const r = byRevision.get(g.revisionId) ?? { businessId: g.businessId, visits: 0, conversions: 0 }
    const n = g._sum.count ?? 0
    if (g.event === 'PAGE_VIEW' && g.page === 'HOME') r.visits += n
    else if ((CONVERSION_EVENTS as readonly string[]).includes(g.event)) r.conversions += n
    byRevision.set(g.revisionId, r)
  }
  if (byRevision.size === 0) return []

  const revisions = await prisma.storefrontRevision.findMany({
    where: { id: { in: [...byRevision.keys()] }, publishedAt: { not: null } },
    select: { id: true, businessId: true, spec: true, business: { select: { settings: true } } },
  })

  const rows: RevisionPerformance[] = []
  for (const rev of revisions) {
    const perf = byRevision.get(rev.id)
    // The counters must belong to the revision's own business (never cross-attributed).
    if (!perf || perf.businessId !== rev.businessId || !contributes(rev.business.settings)) continue
    const parsed = parseSpec(rev.spec)
    if (!parsed.ok) continue
    rows.push({ businessId: rev.businessId, pattern: patternFromSpec(parsed.spec), visits: perf.visits, conversions: perf.conversions })
  }
  return rows
}

/**
 * Detects patterns and records them as candidates. A pattern a reviewer has
 * already decided on keeps its decision — only its evidence is refreshed.
 */
export async function runPatternDetection(now: Date = new Date()): Promise<{ evaluated: number; candidates: number; newCandidates: number }> {
  const rows = await gatherPerformance(now)
  const detected = detectPatterns(rows)
  let newCandidates = 0
  for (const d of detected) {
    const existing = await prisma.storefrontPatternCandidate.findUnique({ where: { signature: d.signature }, select: { id: true } })
    if (existing) {
      await prisma.storefrontPatternCandidate.update({ where: { id: existing.id }, data: { evidence: d.evidence as unknown as Prisma.InputJsonValue } })
    } else {
      newCandidates += 1
      await prisma.storefrontPatternCandidate.create({
        data: {
          signature: d.signature,
          vertical: d.pattern.vertical,
          templateId: d.pattern.templateId ?? '',
          pattern: d.pattern as unknown as Prisma.InputJsonValue,
          evidence: d.evidence as unknown as Prisma.InputJsonValue,
          status: 'CANDIDATE',
        },
      })
    }
  }
  return { evaluated: rows.length, candidates: detected.length, newCandidates }
}

export async function listPatternCandidates() {
  return prisma.storefrontPatternCandidate.findMany({ orderBy: [{ status: 'asc' }, { detectedAt: 'desc' }] })
}

/** A platform admin's decision. The only way a pattern ever becomes usable. */
export async function reviewPatternCandidate(
  id: string,
  decision: 'APPROVED' | 'REJECTED' | 'RETIRED',
  reviewer: string,
  note?: string,
) {
  return prisma.storefrontPatternCandidate.update({
    where: { id },
    data: { status: decision, reviewedBy: reviewer, reviewedAt: new Date(), reviewNote: note?.slice(0, 500) ?? null },
  })
}

/** The best APPROVED pattern for a vertical + template, for new storefronts. */
export async function getApprovedPattern(vertical: string, templateId: string | null): Promise<PatternShape | null> {
  const approved = await prisma.storefrontPatternCandidate.findMany({
    where: { vertical, templateId: templateId ?? '', status: 'APPROVED' },
    select: { pattern: true, evidence: true },
  })
  const best = approved.sort((a, b) => ((b.evidence as { lift?: number }).lift ?? 0) - ((a.evidence as { lift?: number }).lift ?? 0))[0]
  return best ? (best.pattern as unknown as PatternShape) : null
}

/** How merchants edit AI drafts, per vertical — for the internal review page. */
export async function aiEditSummary(now: Date = new Date()) {
  const since = new Date(now.getTime() - LEARNING_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const revisions = await prisma.storefrontRevision.findMany({
    where: { publishedAt: { gte: since }, originalSpec: { not: Prisma.AnyNull }, source: { in: ['AI_GENERATED', 'AI_ASSISTED'] } },
    select: { spec: true, originalSpec: true },
  })
  const byVertical = new Map<string, { drafts: number; templateChanged: number; sectionsChanged: number; ctaChanged: number; copyChanged: number }>()
  for (const r of revisions) {
    const original = parseSpec(r.originalSpec)
    const published = parseSpec(r.spec)
    if (!original.ok || !published.ok) continue
    const s = editSignals(original.spec, published.spec)
    const v = byVertical.get(published.spec.strategy.vertical) ?? { drafts: 0, templateChanged: 0, sectionsChanged: 0, ctaChanged: 0, copyChanged: 0 }
    v.drafts += 1
    if (s.templateChanged) v.templateChanged += 1
    if (s.sectionsChanged) v.sectionsChanged += 1
    if (s.ctaChanged) v.ctaChanged += 1
    if (s.copyChanged) v.copyChanged += 1
    byVertical.set(published.spec.strategy.vertical, v)
  }
  return [...byVertical.entries()].map(([vertical, v]) => ({ vertical, ...v }))
}
