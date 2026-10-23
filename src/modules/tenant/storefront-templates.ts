/**
 * Storefront templates — pure data, no Prisma import, same discipline as
 * storefront-presets.ts. A template is WHICH PAGES exist for a storefront
 * and orthogonal to the visual presets (storefront-presets.ts), which stay
 * deciding typography/radius/colour untouched, AND orthogonal to
 * profile.sectionEmphasis (storefront-theme.ts's resolveSectionOrder),
 * which stays deciding the order of sections WITHIN the home page. A
 * template only ever adds/removes standalone pages beyond home — it never
 * changes what home itself renders, so picking a template can't interact
 * with a business's existing section-order choice.
 *
 * CLASSIC is the safe default, byte-for-byte today's single-page
 * storefront. The four vertical templates below match the same 4-way
 * category split already established in CATEGORY_DEFAULT_PRESET
 * (storefront-theme.ts) and vertical-demo-data.ts on the marketing site —
 * a continuation of that existing grouping, not a parallel one.
 */

import type { BusinessCategory } from '@prisma/client'

export type StorefrontTemplateId = 'CLASSIC' | 'FOOD_MENU' | 'SALON_BOOKING' | 'RETAIL_CATALOGUE' | 'SERVICES_TRUST'

export type StorefrontPageId = 'HOME' | 'ABOUT' | 'GALLERY' | 'CONTACT'

export interface StorefrontTemplate {
  /** A plain string, not StorefrontTemplateId — the one dynamically-built GENERATED_TEMPLATE_ID template (see resolveStorefrontTemplate) isn't one of the 5 static, pickable ids. */
  id: string
  label: string
  description: string
  /**
   * Categories this template is a good fit for — read by the Design
   * Wizard's template picker (as the initial suggestion, never a forced
   * choice) and by the feature-recommendation engine to surface "a
   * template built for your kind of business" prompts. Empty means "no
   * specific fit" rather than "fits everything"; CLASSIC is the universal
   * fallback via resolveStorefrontTemplate, not via this list.
   */
  categoryFit: BusinessCategory[]
  /** Which storefront pages this template exposes. Every other page route guards itself with notFound() when its id isn't in this list (see A2). */
  pages: StorefrontPageId[]
}

export const STOREFRONT_PAGE_LABELS: Record<StorefrontPageId, string> = {
  HOME: 'Home',
  ABOUT: 'About',
  GALLERY: 'Gallery',
  CONTACT: 'Contact',
}

export const STOREFRONT_TEMPLATES: Record<StorefrontTemplateId, StorefrontTemplate> = {
  CLASSIC: {
    id: 'CLASSIC',
    label: 'Classic',
    description: 'A single, focused page — your catalogue front and centre.',
    categoryFit: [],
    pages: ['HOME'],
  },
  FOOD_MENU: {
    id: 'FOOD_MENU',
    label: 'Food & Menu',
    description: 'A photo gallery of your dishes, plus a dedicated hours & location page.',
    categoryFit: ['FOOD_VENDOR'],
    pages: ['HOME', 'GALLERY', 'CONTACT'],
  },
  SALON_BOOKING: {
    id: 'SALON_BOOKING',
    label: 'Salon & Booking',
    description: 'A portfolio gallery of your work, plus hours & location for booking.',
    categoryFit: ['SALON', 'HAIR_BRAIDER', 'NAIL_TECHNICIAN'],
    pages: ['HOME', 'GALLERY', 'CONTACT'],
  },
  RETAIL_CATALOGUE: {
    id: 'RETAIL_CATALOGUE',
    label: 'Retail Catalogue',
    description: 'A photo gallery of your products, plus a page to tell your story.',
    categoryFit: ['RETAIL_STORE', 'TUCK_SHOP'],
    pages: ['HOME', 'GALLERY', 'ABOUT'],
  },
  SERVICES_TRUST: {
    id: 'SERVICES_TRUST',
    label: 'Services & Trust',
    description: 'A page to build trust with your story, plus easy hours & location.',
    categoryFit: ['CAR_WASH', 'MECHANIC', 'EVENTS', 'CHILDCARE', 'LAUNDRY'],
    pages: ['HOME', 'ABOUT', 'CONTACT'],
  },
}

const TEMPLATE_IDS: StorefrontTemplateId[] = ['CLASSIC', 'FOOD_MENU', 'SALON_BOOKING', 'RETAIL_CATALOGUE', 'SERVICES_TRUST']
const DEFAULT_TEMPLATE_ID: StorefrontTemplateId = 'CLASSIC'

/**
 * Sentinel activeTemplateId value meaning "read the page list from
 * BusinessProfile.generatedTemplate instead of the static registry above"
 * — see template-generation-provider.ts (A4) and resolveStorefrontTemplate
 * below. Not one of StorefrontTemplateId's 5 concrete values: it's never a
 * pickable card in the wizard grid, only ever reached via the "none of
 * these fit me" generation flow.
 */
export const GENERATED_TEMPLATE_ID = 'GENERATED'

const ALL_PAGE_IDS: StorefrontPageId[] = ['HOME', 'ABOUT', 'GALLERY', 'CONTACT']

/**
 * Strictly validates a generated-template JSON blob before it's ever
 * rendered — mirrors sanitizeTheme's discipline (storefront-theme.ts): any
 * value outside the known StorefrontPageId enum is dropped rather than
 * trusted, and a completely malformed/empty blob returns null rather than
 * an empty or garbage page list. HOME is always included even if the
 * source data omitted it — every storefront needs a front door.
 */
export function validateGeneratedPages(raw: unknown): StorefrontPageId[] | null {
  if (!raw || typeof raw !== 'object') return null
  const rawPages = (raw as { pages?: unknown }).pages
  if (!Array.isArray(rawPages)) return null
  const valid = rawPages.filter((p): p is StorefrontPageId => typeof p === 'string' && ALL_PAGE_IDS.includes(p as StorefrontPageId))
  const deduped = Array.from(new Set(valid))
  if (!deduped.includes('HOME')) deduped.unshift('HOME')
  return deduped.length > 0 ? deduped : null
}

/**
 * Never throws — an unrecognised or missing activeTemplateId (a stale
 * generated-template reference, a template retired later, legacy data)
 * always resolves to CLASSIC rather than breaking a storefront. Every
 * BusinessProfile row already has an explicit, non-null activeTemplateId
 * (the M2 migration's own DEFAULT 'CLASSIC' backfilled every existing row,
 * and new rows get the same DB default) — so in practice this only ever
 * changes what a business sees once the wizard's template step is used to
 * save a different id. There is deliberately no category-based fallback
 * TIER here: that would be unreachable dead code given the DB default
 * above. Category-based suggestion instead happens once, client-side, the
 * first time the wizard's template step renders — see
 * suggestTemplateForCategory below.
 */
export function resolveStorefrontTemplate(business: {
  activeTemplateId?: string | null
  generatedTemplate?: unknown
}): StorefrontTemplate {
  const id = business.activeTemplateId
  if (id === GENERATED_TEMPLATE_ID) {
    const pages = validateGeneratedPages(business.generatedTemplate)
    if (pages) {
      return {
        id: GENERATED_TEMPLATE_ID,
        label: 'Custom',
        description: 'A page set generated for your business.',
        categoryFit: [],
        pages,
      }
    }
    // GENERATED with no valid generatedTemplate JSON (write ordering bug, hand-edited data) — never break the storefront.
    return STOREFRONT_TEMPLATES[DEFAULT_TEMPLATE_ID]
  }
  if (id && TEMPLATE_IDS.includes(id as StorefrontTemplateId)) {
    return STOREFRONT_TEMPLATES[id as StorefrontTemplateId]
  }
  return STOREFRONT_TEMPLATES[DEFAULT_TEMPLATE_ID]
}

export function isValidTemplateId(id: string): id is StorefrontTemplateId {
  return TEMPLATE_IDS.includes(id as StorefrontTemplateId)
}

/** setActiveTemplateId's write-path guard accepts this in addition to the 5 static ids — GENERATED is only ever written alongside a validated generatedTemplate blob, in the same call (see acceptGeneratedTemplate). */
export function isValidActiveTemplateId(id: string): boolean {
  return id === GENERATED_TEMPLATE_ID || isValidTemplateId(id)
}

/**
 * Which template to pre-select the first time a business opens the Design
 * Wizard's template step — never overrides a saved choice (the wizard only
 * calls this for its OWN initial UI state, not as a render-time fallback;
 * see resolveStorefrontTemplate's own comment on why a read-time category
 * fallback would be dead code). Falls through to CLASSIC for OTHER or any
 * category without a matching template, same "no opinion" behaviour
 * CATEGORY_DEFAULT_PRESET already has for presets.
 */
export function suggestTemplateForCategory(category: BusinessCategory): StorefrontTemplateId {
  for (const id of TEMPLATE_IDS) {
    if (STOREFRONT_TEMPLATES[id].categoryFit.includes(category)) return id
  }
  return DEFAULT_TEMPLATE_ID
}
