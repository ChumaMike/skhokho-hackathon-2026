/**
 * Storefront revisions — the merchant's workflow around the engine:
 *
 *   generate (AI → DRAFT) → preview → edit → approve & publish
 *
 * AI never publishes. Every function takes the businessId from the caller's
 * signed session and scopes every query by it, so one business can never
 * see, edit or publish another's revision. Publishing re-validates against
 * the business's CURRENT facts and writes the spec's projection (project.ts)
 * in one transaction.
 */

import type { Prisma, StorefrontRevisionSource, StorefrontRevisionStatus } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma/client'
import { clearHostnameCache } from '@/lib/tenant/context'
import { gatherStorefrontFacts } from './facts'
import { applyTemplate, buildRulesSpec, planStorefront } from './planner'
import { TEMPLATE_IDS } from './templates'
import { SiteSchema } from './pages'
import { generateSpec, type GenerationMode, type StorefrontModel } from './copywriter'
import { projectSpec } from './project'
import { getApprovedPattern } from '@/modules/storefront-learning/patterns'
import { HOME_SECTIONS, SPEC_ACTIONS, SPEC_LIMITS, SPEC_PRESETS, hexColour, parseSpec, specText, type StorefrontSpec } from './spec'
import { SpecNotPublishableError, validateSpec, type ValidationReport } from './validate'

/** Drafts a business may generate per rolling day — cost control on the model. */
export const DAILY_GENERATION_LIMIT = 10
/** Open drafts kept per business; older ones are archived automatically. */
export const MAX_OPEN_DRAFTS = 10

export class GenerationLimitError extends Error {
  constructor() {
    super(`You've created ${DAILY_GENERATION_LIMIT} storefront drafts in the last day. Please try again tomorrow, or edit one of your existing drafts.`)
    this.name = 'GenerationLimitError'
  }
}

export class RevisionNotFoundError extends Error {
  constructor() {
    super('That storefront draft could not be found.')
    this.name = 'RevisionNotFoundError'
  }
}

export interface RevisionView {
  id: string
  version: number
  status: StorefrontRevisionStatus
  source: StorefrontRevisionSource
  spec: StorefrontSpec
  validation: ValidationReport
  aiNote: string | null
  createdAt: Date
  publishedAt: Date | null
}

function toView(row: {
  id: string
  version: number
  status: StorefrontRevisionStatus
  source: StorefrontRevisionSource
  spec: Prisma.JsonValue
  validation: Prisma.JsonValue
  aiNote: string | null
  createdAt: Date
  publishedAt: Date | null
}): RevisionView {
  const parsed = parseSpec(row.spec)
  if (!parsed.ok) throw new Error(`Stored storefront revision ${row.id} no longer parses: ${parsed.errors[0]}`)
  return { ...row, spec: parsed.spec, validation: row.validation as unknown as ValidationReport }
}

const VIEW_SELECT = {
  id: true,
  version: true,
  status: true,
  source: true,
  spec: true,
  validation: true,
  aiNote: true,
  createdAt: true,
  publishedAt: true,
} as const

export async function listRevisions(businessId: string): Promise<RevisionView[]> {
  const rows = await prisma.storefrontRevision.findMany({
    where: { businessId },
    orderBy: { version: 'desc' },
    take: 30,
    select: VIEW_SELECT,
  })
  return rows.map(toView)
}

export async function getRevision(businessId: string, revisionId: string): Promise<RevisionView | null> {
  const row = await prisma.storefrontRevision.findFirst({ where: { id: revisionId, businessId }, select: VIEW_SELECT })
  return row ? toView(row) : null
}

async function nextVersion(tx: Prisma.TransactionClient, businessId: string): Promise<number> {
  const last = await tx.storefrontRevision.findFirst({ where: { businessId }, orderBy: { version: 'desc' }, select: { version: true } })
  return (last?.version ?? 0) + 1
}

/** Runs the Storefront Intelligence Engine and saves the result as a DRAFT. */
export async function generateDraft(
  businessId: string,
  staffId: string | null,
  mode: GenerationMode,
  options: { model?: StorefrontModel | null; now?: Date } = {},
): Promise<RevisionView> {
  const now = options.now ?? new Date()
  const recent = await prisma.storefrontRevision.count({
    where: { businessId, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
  })
  if (recent >= DAILY_GENERATION_LIMIT) throw new GenerationLimitError()

  const facts = await gatherStorefrontFacts(businessId)
  // Only a pattern a platform admin APPROVED, and only for Level B.
  const plan = planStorefront(facts, mode)
  const learned = mode === 'GENERATE' ? await getApprovedPattern(plan.vertical, plan.templateId) : null
  const generated = await generateSpec(facts, mode, options.model, learned, { businessId, staffId })
  const validation = validateSpec(generated.spec, facts)

  const row = await prisma.$transaction(
    async (tx) => {
      const created = await tx.storefrontRevision.create({
        data: {
          businessId,
          version: await nextVersion(tx, businessId),
          status: 'DRAFT',
          source: generated.source,
          spec: generated.spec as unknown as Prisma.InputJsonValue,
          // What the engine proposed, kept so later edits can be compared (learning signal).
          originalSpec: generated.spec as unknown as Prisma.InputJsonValue,
          validation: validation as unknown as Prisma.InputJsonValue,
          aiNote: generated.aiNote,
          createdByStaffId: staffId,
        },
        select: VIEW_SELECT,
      })
      // Keep the draft list short: archive the oldest beyond the cap.
      const drafts = await tx.storefrontRevision.findMany({
        where: { businessId, status: 'DRAFT' },
        orderBy: { version: 'desc' },
        skip: MAX_OPEN_DRAFTS,
        select: { id: true },
      })
      if (drafts.length > 0) {
        await tx.storefrontRevision.updateMany({ where: { id: { in: drafts.map((d) => d.id) } }, data: { status: 'ARCHIVED' } })
      }
      return created
    },
    { timeout: 15_000, maxWait: 10_000 },
  )
  return toView(row)
}

/** What a merchant may change on a draft — the same safe vocabulary as the spec. */
export const DraftEditSchema = z
  .object({
    heroHeadline: specText(SPEC_LIMITS.headline).optional(),
    heroSubline: specText(SPEC_LIMITS.subline).nullable().optional(),
    aboutBody: specText(SPEC_LIMITS.about).nullable().optional(),
    highlights: z.array(specText(SPEC_LIMITS.highlight)).max(SPEC_LIMITS.highlights).optional(),
    ctaAction: z.enum(SPEC_ACTIONS).optional(),
    ctaLabel: specText(SPEC_LIMITS.ctaLabel).optional(),
    presetId: z.enum(SPEC_PRESETS).optional(),
    primaryColor: hexColour.optional(),
    accentColor: hexColour.optional(),
    sections: z
      .array(z.object({ id: z.enum(HOME_SECTIONS), visible: z.boolean(), layout: z.string().max(20).optional() }).strict())
      .length(HOME_SECTIONS.length)
      .optional(),
    /** "How it works" steps; an empty array removes them. */
    process: z.array(z.object({ title: specText(SPEC_LIMITS.processTitle), body: specText(SPEC_LIMITS.processBody) }).strict()).max(SPEC_LIMITS.processSteps).optional(),
    seoTitle: specText(SPEC_LIMITS.seoTitle).optional(),
    seoDescription: specText(SPEC_LIMITS.seoDescription).optional(),
    /** Switch design: a library template, or CLASSIC for the general Shopfront. */
    templateId: z.enum([...TEMPLATE_IDS, 'CLASSIC']).optional(),
  })
  .strict()

export type DraftEdit = z.infer<typeof DraftEditSchema>

export class InvalidEditError extends Error {
  constructor(readonly problems: string[]) {
    super(problems[0] ?? 'That change could not be saved.')
    this.name = 'InvalidEditError'
  }
}

/**
 * Applies a merchant's edit to one of their DRAFTS. Malformed or unsafe
 * input is refused outright; a well-formed edit that leaves the storefront
 * unpublishable (e.g. a button the business can't fulfil) is saved, with
 * the validation report saying exactly what to fix.
 */
export async function editDraft(businessId: string, revisionId: string, rawEdit: unknown): Promise<RevisionView> {
  const editResult = DraftEditSchema.safeParse(rawEdit)
  if (!editResult.success) {
    throw new InvalidEditError(editResult.error.issues.map((i) => `${i.path.join('.') || 'edit'}: ${i.message}`))
  }
  const edit = editResult.data

  const current = await prisma.storefrontRevision.findFirst({ where: { id: revisionId, businessId, status: 'DRAFT' }, select: { spec: true } })
  if (!current) throw new RevisionNotFoundError()
  const base = parseSpec(current.spec)
  if (!base.ok) throw new InvalidEditError(base.errors)

  const facts = await gatherStorefrontFacts(businessId)
  let spec: StorefrontSpec = structuredClone(base.spec)

  // A template switch first — it re-derives layout, sections, style and
  // possibly the button. The edit form posts every field on each save, so on
  // a save that SWITCHES template, the layout fields it carried are the old
  // template's and are ignored; only the words apply on top.
  let switched = false
  if (edit.templateId !== undefined) {
    const wanted = edit.templateId === 'CLASSIC' ? null : edit.templateId
    if (wanted !== (spec.templateId ?? null)) {
      switched = true
      if (wanted && !planStorefront(facts, 'GENERATE').availableTemplateIds.includes(wanted)) {
        throw new InvalidEditError(["That design doesn't fit your business yet — check what it needs on the design list."])
      }
      spec = applyTemplate(spec, facts, wanted)
    }
  }

  if (edit.heroHeadline !== undefined) spec.content.heroHeadline = edit.heroHeadline
  if (edit.heroSubline !== undefined) spec.content.heroSubline = edit.heroSubline
  if (edit.aboutBody !== undefined) spec.content.aboutBody = edit.aboutBody
  if (edit.highlights !== undefined) spec.content.highlights = edit.highlights
  if (edit.process !== undefined) spec.content.process = edit.process.length > 0 ? edit.process : undefined
  if (!switched && edit.ctaAction !== undefined) spec.cta.action = edit.ctaAction
  if (!switched && edit.ctaLabel !== undefined) spec.cta.label = edit.ctaLabel
  if (!switched && edit.presetId !== undefined) spec.theme.presetId = edit.presetId
  if (edit.primaryColor !== undefined) spec.theme.primaryColor = edit.primaryColor
  if (edit.accentColor !== undefined) spec.theme.accentColor = edit.accentColor
  if (!switched && edit.sections !== undefined) spec.home.sections = edit.sections
  if (edit.seoTitle !== undefined) spec.seo.title = edit.seoTitle
  if (edit.seoDescription !== undefined) spec.seo.description = edit.seoDescription

  const reparsed = parseSpec(spec)
  if (!reparsed.ok) throw new InvalidEditError(reparsed.errors)

  const validation = validateSpec(reparsed.spec, facts)
  const updated = await prisma.storefrontRevision.updateMany({
    where: { id: revisionId, businessId, status: 'DRAFT' },
    data: { spec: reparsed.spec as unknown as Prisma.InputJsonValue, validation: validation as unknown as Prisma.InputJsonValue },
  })
  if (updated.count === 0) throw new RevisionNotFoundError()
  return (await getRevision(businessId, revisionId))!
}

/**
 * Approve & publish. Accepts a DRAFT, or a previously PUBLISHED (now
 * archived) revision to restore it. Re-validates against today's facts;
 * any error blocks publishing.
 */
export async function publishRevision(businessId: string, revisionId: string, staffId: string | null): Promise<RevisionView> {
  const row = await prisma.storefrontRevision.findFirst({
    where: {
      id: revisionId,
      businessId,
      OR: [{ status: 'DRAFT' }, { status: 'ARCHIVED', publishedAt: { not: null } }],
    },
    select: { id: true, spec: true },
  })
  if (!row) throw new RevisionNotFoundError()

  const validation = validateSpec(row.spec, await gatherStorefrontFacts(businessId))
  const parsed = parseSpec(row.spec)
  if (!validation.ok || !parsed.ok) {
    await prisma.storefrontRevision.updateMany({
      where: { id: revisionId, businessId },
      data: { validation: validation as unknown as Prisma.InputJsonValue },
    })
    throw new SpecNotPublishableError(validation)
  }

  await prisma.$transaction(
    async (tx) => {
      const business = await tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { settings: true } })
      const projection = projectSpec(business.settings, parsed.spec, revisionId)

      await tx.storefrontRevision.updateMany({ where: { businessId, status: 'PUBLISHED' }, data: { status: 'ARCHIVED' } })
      await tx.storefrontRevision.update({
        where: { id: revisionId },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          publishedByStaffId: staffId,
          validation: validation as unknown as Prisma.InputJsonValue,
        },
      })
      await tx.business.update({
        where: { id: businessId },
        data: {
          primaryColor: projection.primaryColor,
          accentColor: projection.accentColor,
          settings: projection.settings as Prisma.InputJsonValue,
        },
      })
    },
    { timeout: 15_000, maxWait: 10_000 },
  )
  // A published template can change which layout this business's hostnames render.
  clearHostnameCache()
  return (await getRevision(businessId, revisionId))!
}

/** Throws a draft away (kept as ARCHIVED history, never deleted). */
export async function discardDraft(businessId: string, revisionId: string): Promise<void> {
  const updated = await prisma.storefrontRevision.updateMany({
    where: { id: revisionId, businessId, status: 'DRAFT' },
    data: { status: 'ARCHIVED' },
  })
  if (updated.count === 0) throw new RevisionNotFoundError()
}

// ---------------------------------------------------------------------------
// Website pages — edited on a draft, published with it (pages.ts)
// ---------------------------------------------------------------------------

/** The newest open draft, if any. Reading never creates one. */
export async function getOpenDraft(businessId: string): Promise<RevisionView | null> {
  const row = await prisma.storefrontRevision.findFirst({ where: { businessId, status: 'DRAFT' }, orderBy: { version: 'desc' }, select: VIEW_SELECT })
  return row ? toView(row) : null
}

/**
 * The draft an owner's page edits go into: the newest open draft, or a new
 * one started from the live storefront (rules only, no model, Level A so
 * every word and layout choice already live is kept). One place, so page
 * edits and AI drafts can never fork into two things waiting to publish.
 */
export async function ensureWorkingDraft(businessId: string, staffId: string | null): Promise<RevisionView> {
  const open = await getOpenDraft(businessId)
  if (open) return open

  const facts = await gatherStorefrontFacts(businessId)
  const spec = buildRulesSpec(facts, 'ASSIST')
  const validation = validateSpec(spec, facts)
  const row = await prisma.$transaction(
    async (tx) =>
      tx.storefrontRevision.create({
        data: {
          businessId,
          version: await nextVersion(tx, businessId),
          status: 'DRAFT',
          source: 'RULES',
          spec: spec as unknown as Prisma.InputJsonValue,
          originalSpec: spec as unknown as Prisma.InputJsonValue,
          validation: validation as unknown as Prisma.InputJsonValue,
          aiNote: 'Started from your live storefront so you can change your pages. Nothing changes for customers until you publish.',
          createdByStaffId: staffId,
        },
        select: VIEW_SELECT,
      }),
    { timeout: 15_000, maxWait: 10_000 },
  )
  return toView(row)
}

/**
 * Replaces the website pages of one DRAFT. The whole page list is posted
 * each time (it is small and order matters), validated by the same schema
 * the spec uses, so nothing unsafe or unroutable can be saved.
 */
export async function editDraftSite(businessId: string, revisionId: string, rawSite: unknown): Promise<RevisionView> {
  const site = SiteSchema.safeParse(rawSite)
  if (!site.success) throw new InvalidEditError(site.error.issues.map((i) => `${i.path.join('.') || 'pages'}: ${i.message}`))

  const current = await prisma.storefrontRevision.findFirst({ where: { id: revisionId, businessId, status: 'DRAFT' }, select: { spec: true } })
  if (!current) throw new RevisionNotFoundError()
  const base = parseSpec(current.spec)
  if (!base.ok) throw new InvalidEditError(base.errors)

  const spec: StorefrontSpec = { ...structuredClone(base.spec), site: site.data }
  const facts = await gatherStorefrontFacts(businessId)
  const validation = validateSpec(spec, facts)
  const updated = await prisma.storefrontRevision.updateMany({
    where: { id: revisionId, businessId, status: 'DRAFT' },
    data: { spec: spec as unknown as Prisma.InputJsonValue, validation: validation as unknown as Prisma.InputJsonValue },
  })
  if (updated.count === 0) throw new RevisionNotFoundError()
  return (await getRevision(businessId, revisionId))!
}
