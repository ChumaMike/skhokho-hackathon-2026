/**
 * Storefront CONTENT — distinct from storefront-theme.ts's `StorefrontProfile`/
 * `StorefrontThemeConfig` (which decide visual/structural CHOICES: preset,
 * hero mode, section order) and from storefront-templates.ts (which decides
 * which PAGES exist). This module is the one place actual owner-authored
 * storefront COPY lives: a hero headline/subheadline, a real "about" story,
 * and a short list of real differentiators.
 *
 * Deliberately a small, CLOSED schema — there is no `testimonials` field, no
 * `customerCount`, no "founded in" field. That's not an oversight: this
 * codebase has a repeated, deliberate discipline against fabricated social
 * proof (storefront-recommendations.ts never frames "no reviews yet" as a
 * flaw; the SEO module only ever emits AggregateRating from real reviews).
 * A field that COULD hold an invented stat is a field someone (or an AI)
 * will eventually put a fabricated stat in — so those fields simply don't
 * exist here. Real testimonials stay exclusively on ReviewsSection's real
 * customer-review data; this module never duplicates that.
 *
 * Same merge-only `Business.settings` JSON pattern as capabilities.ts/
 * storefront-theme.ts — a new top-level `storefrontContent` settings key,
 * sibling to `storefront`/`delivery`/`payment`/`ordering`/`capabilities`,
 * never a full overwrite.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import type { BusinessCapability } from './capabilities'

export interface StorefrontHeroContent {
  /** A short kicker line shown above the business name in the hero — e.g. "Johannesburg's favourite kota spot." Never a fabricated claim; owner/AI-authored. */
  headline?: string
  /** Replaces the hero's description paragraph (which otherwise falls back to Business.description) with a punchier, hero-specific line. */
  subheadline?: string
}

export interface StorefrontAboutContent {
  /** A real, multi-sentence story — longer and richer than the single-line Business.description, which stays the short tagline used in cards/SEO. */
  body?: string
}

export interface StorefrontHighlightsContent {
  /** Short, real differentiators ("Same-day delivery in Soweto," "20 years in the trade") — never a count or date the business hasn't actually told us. */
  items: string[]
}

export interface StorefrontProcessStep {
  title: string
  body: string
}

export interface StorefrontContent {
  version: 1
  hero: StorefrontHeroContent
  about: StorefrontAboutContent
  highlights: StorefrontHighlightsContent
  /** "How it works" in the owner's words, up to five steps — shown by the portfolio composition (Tab 7). Empty for everyone until written. */
  process: StorefrontProcessStep[]
}

export const MAX_HEADLINE_LENGTH = 80
export const MAX_SUBHEADLINE_LENGTH = 160
export const MAX_ABOUT_BODY_LENGTH = 600
export const MAX_HIGHLIGHT_ITEM_LENGTH = 80
export const MAX_HIGHLIGHT_ITEMS = 4
export const MAX_PROCESS_STEPS = 5
export const MAX_PROCESS_TITLE_LENGTH = 60
export const MAX_PROCESS_BODY_LENGTH = 200

const DEFAULT_STOREFRONT_CONTENT: StorefrontContent = {
  version: 1,
  hero: {},
  about: {},
  highlights: { items: [] },
  process: [],
}

function sanitizeProcess(raw: unknown): StorefrontProcessStep[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((step) => {
      if (!step || typeof step !== 'object') return null
      const title = cleanString((step as { title?: unknown }).title, MAX_PROCESS_TITLE_LENGTH)
      const body = cleanString((step as { body?: unknown }).body, MAX_PROCESS_BODY_LENGTH)
      return title && body ? { title, body } : null
    })
    .filter((step): step is StorefrontProcessStep => step !== null)
    .slice(0, MAX_PROCESS_STEPS)
}

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : undefined
}

function sanitizeHero(raw: unknown): StorefrontHeroContent {
  if (!raw || typeof raw !== 'object') return {}
  const h = raw as Partial<StorefrontHeroContent>
  return {
    headline: cleanString(h.headline, MAX_HEADLINE_LENGTH),
    subheadline: cleanString(h.subheadline, MAX_SUBHEADLINE_LENGTH),
  }
}

function sanitizeAbout(raw: unknown): StorefrontAboutContent {
  if (!raw || typeof raw !== 'object') return {}
  const a = raw as Partial<StorefrontAboutContent>
  return { body: cleanString(a.body, MAX_ABOUT_BODY_LENGTH) }
}

function sanitizeHighlights(raw: unknown): StorefrontHighlightsContent {
  if (!raw || typeof raw !== 'object') return { items: [] }
  const rawItems = (raw as { items?: unknown }).items
  if (!Array.isArray(rawItems)) return { items: [] }
  const items = rawItems
    .map((item) => cleanString(item, MAX_HIGHLIGHT_ITEM_LENGTH))
    .filter((item): item is string => !!item)
    .slice(0, MAX_HIGHLIGHT_ITEMS)
  return { items }
}

/**
 * Strictly validates an AI-generated content blob before it's ever shown to
 * an owner for review — mirrors validateGeneratedPages's discipline
 * (storefront-templates.ts): reuses the exact same sanitizers getStorefront
 * Content applies to real stored data, so a generated blob can never be
 * "more trusted" than hand-typed input. Returns null only when raw isn't an
 * object at all (a genuinely broken response) OR every field sanitized away
 * to nothing — an empty-everywhere result isn't a useful generation, and
 * the caller should fall back to the rules provider rather than show an
 * owner a blank review screen.
 */
export function validateGeneratedContent(raw: unknown): StorefrontContent | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { hero?: unknown; about?: unknown; highlights?: unknown }
  const content: StorefrontContent = {
    version: 1,
    hero: sanitizeHero(r.hero),
    about: sanitizeAbout(r.about),
    highlights: sanitizeHighlights(r.highlights),
    // The AI never writes the owner's "how it works" steps.
    process: [],
  }
  const isEmpty = !content.hero.headline && !content.hero.subheadline && !content.about.body && content.highlights.items.length === 0
  return isEmpty ? null : content
}

/** Never throws — malformed/legacy/missing settings.storefrontContent all resolve to the empty default, same discipline as getStorefrontConfig. Every section that reads this falls back to its own pre-existing behaviour when a field is absent (see AboutSection/StorefrontHero), so a business that has set none of this renders exactly as it did before this module existed. */
export function getStorefrontContent(business: { settings: unknown }): StorefrontContent {
  const settings = (business.settings ?? {}) as { storefrontContent?: unknown }
  const raw = settings.storefrontContent as { hero?: unknown; about?: unknown; highlights?: unknown; process?: unknown } | undefined
  if (!raw || typeof raw !== 'object') return DEFAULT_STOREFRONT_CONTENT
  return {
    version: 1,
    hero: sanitizeHero(raw.hero),
    about: sanitizeAbout(raw.about),
    highlights: sanitizeHighlights(raw.highlights),
    process: sanitizeProcess(raw.process),
  }
}

/** Merge-only, mirroring setDeliverySettings/setStorefrontConfig's exact read-modify-write pattern — hero/about/highlights are merged independently so a partial update to one never wipes the others, and every unrelated settings key survives untouched. Sanitizes on write too (not just on read) so stored data is never relied upon to already be clean. */
export async function setStorefrontContent(
  businessId: string,
  input: { hero?: Partial<StorefrontHeroContent>; about?: Partial<StorefrontAboutContent>; highlights?: { items?: string[] }; process?: StorefrontProcessStep[] },
): Promise<void> {
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { settings: true } })
  const settings = (business.settings ?? {}) as Record<string, unknown>
  const current = getStorefrontContent(business)
  const next: StorefrontContent = {
    version: 1,
    hero: input.hero ? sanitizeHero({ ...current.hero, ...input.hero }) : current.hero,
    about: input.about ? sanitizeAbout({ ...current.about, ...input.about }) : current.about,
    highlights: input.highlights ? sanitizeHighlights({ ...current.highlights, ...input.highlights }) : current.highlights,
    process: input.process ? sanitizeProcess(input.process) : current.process,
  }
  await prisma.business.update({
    where: { id: businessId },
    data: { settings: { ...settings, storefrontContent: next } as unknown as Prisma.InputJsonValue },
  })
}

export interface TrustBarFact {
  label: string
}

/**
 * The ONLY source of trust-bar content — every fact here is structurally
 * real (derived from capabilities/contact info the business has actually
 * configured), never a number or claim nobody verified. Omits entirely
 * (returns []) when nothing real applies, same "omit, don't fabricate"
 * discipline as storefront-recommendations.ts.
 */
export function computeTrustBarFacts(
  capabilities: Set<BusinessCapability>,
  business: { whatsapp?: string | null },
): TrustBarFact[] {
  const facts: TrustBarFact[] = []
  if (capabilities.has('DELIVERY')) facts.push({ label: 'Delivery available' })
  if (capabilities.has('PICKUP')) facts.push({ label: 'Collection available' })
  if (capabilities.has('BOOKINGS')) facts.push({ label: 'Book online' })
  if (business.whatsapp) facts.push({ label: 'Order via WhatsApp' })
  if (capabilities.has('LOYALTY')) facts.push({ label: 'Loyalty rewards' })
  return facts
}
