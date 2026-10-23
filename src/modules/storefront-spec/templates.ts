/**
 * The storefront template library — controlled design systems, not page
 * builders. A template fixes a business's page architecture, section
 * hierarchy, call-to-action hierarchy and visual composition on top of the
 * existing Shopfront renderer, theme tokens and colours. Merchants and the
 * AI choose a template and fill its slots; nobody edits HTML or CSS.
 *
 * Three foundations, one per vertical family where a specific composition
 * clearly beats the generic shopfront:
 *
 *   FOOD_MENU      — menu-first: a compact hero, then the whole menu as a
 *                    scannable categorised list, a basket bar on phones.
 *   SALON_BOOKING  — services + booking: services with price and duration,
 *                    each bookable in place.
 *   SERVICES_LEAD  — service-first, lead/contact: for service businesses
 *                    that don't take online bookings — every service is one
 *                    tap from a WhatsApp or phone enquiry.
 *
 * Retail and anything that fits none of these keep the classic Shopfront
 * (templateId null). MIXED businesses get whichever of these their actual
 * catalogue and capabilities fit best (see chooseTemplateId).
 *
 * Pure: no Prisma, no React.
 */

import type { BusinessCapability } from '@/modules/tenant/capabilities'
import type { PrimaryCustomerAction, StorefrontPresetId } from '@/modules/tenant/storefront-theme'
import type { HomeSectionId, SpecPage, SpecTemplate, Vertical } from './spec'
import { primaryWorkflow, workflowLeadsOverBooking, type WorkflowId } from '@/modules/storefront-workflows/workflows'

export const TEMPLATE_IDS = ['FOOD_MENU', 'SALON_BOOKING', 'SERVICES_LEAD', 'RETAIL_GRID', 'SERVICE_PORTFOLIO'] as const
export type TemplateId = (typeof TEMPLATE_IDS)[number]

/**
 * How the CATALOGUE section is composed — each is a renderer component.
 * RETAIL_GRID = collections (categories) as the way in, filters, featured;
 * SERVICE_PORTFOLIO = photo-forward services, a work gallery, the owner's
 * "how it works" steps, real reviews, and the request form as the way out.
 */
export type CatalogueDisplay = 'MENU_LIST' | 'SERVICE_BOOKING' | 'SERVICE_ENQUIRY' | 'RETAIL_GRID' | 'SERVICE_PORTFOLIO'

export interface StorefrontTemplateDefinition {
  id: TemplateId
  name: string
  summary: string
  /** Verticals this template is designed for. */
  verticals: Vertical[]
  /** The Shopfront variant it composes (nav, page shells). */
  base: SpecTemplate

  /** Page architecture. HOME is always present. */
  pages: { required: SpecPage[]; optional: SpecPage[] }

  /** Section hierarchy on the home page (hero first, contact last are structural). */
  sections: {
    defaultOrder: HomeSectionId[]
    /** Never hidden by anyone — the template doesn't work without them. */
    required: HomeSectionId[]
    /** Fixed position: these stay where the template puts them. */
    pinned: HomeSectionId[]
  }

  /** CTA hierarchy: which actions may be the main button, in priority order. */
  cta: { primary: PrimaryCustomerAction[]; secondary: PrimaryCustomerAction[] }

  /** Business capabilities the template needs to work at all. */
  requires: { capabilities: BusinessCapability[]; anyContact?: ('whatsapp' | 'phone')[] }

  /** Content requirements. */
  content: {
    minCatalogueItems: number
    /** Headline length that fits this hero on a ~360px phone. */
    mobileHeadlineMax: number
    aboutRecommended: boolean
  }

  /** Visual composition — maps to renderer props, using the existing tokens and primitives. */
  composition: {
    hero: 'COMPACT' | 'TALL'
    catalogue: CatalogueDisplay
    defaultPreset: StorefrontPresetId
    /** A floating basket/total bar on phones. */
    stickyOrderBar: boolean
  }

  /** Responsive behaviour, as rendered (documented here, implemented in the components' CSS). */
  responsive: { mobile: string; desktop: string }

  /** What imagery the template wants, for the merchant's to-do list. */
  imagery: { hero: string; items: string; itemImagesMatter: boolean }
}

// The two step-4 compositions are assigned below the first three so the
// literal stays readable; the Record type still requires all five.
export const STOREFRONT_TEMPLATE_LIBRARY: Record<TemplateId, StorefrontTemplateDefinition> = {
  RETAIL_GRID: null as unknown as StorefrontTemplateDefinition,
  SERVICE_PORTFOLIO: null as unknown as StorefrontTemplateDefinition,
  FOOD_MENU: {
    id: 'FOOD_MENU',
    name: 'Menu first',
    summary: 'A short banner, then your whole menu — grouped, scannable and orderable in one tap.',
    verticals: ['FOOD'],
    base: 'PRODUCT',
    pages: { required: ['HOME', 'SHOP', 'CONTACT'], optional: ['ABOUT'] },
    sections: { defaultOrder: ['CATALOGUE', 'TRUST_BAR', 'ABOUT', 'REVIEWS'], required: ['CATALOGUE'], pinned: ['CATALOGUE'] },
    cta: { primary: ['ORDER', 'WHATSAPP', 'CALL'], secondary: ['WHATSAPP', 'CALL', 'VISIT'] },
    requires: { capabilities: ['PRODUCTS'] },
    content: { minCatalogueItems: 1, mobileHeadlineMax: 40, aboutRecommended: false },
    composition: { hero: 'COMPACT', catalogue: 'MENU_LIST', defaultPreset: 'WARM', stickyOrderBar: true },
    responsive: {
      mobile: 'Compact banner so the menu starts on the first screen; one column of menu rows; category chips scroll sideways; basket total pinned to the bottom.',
      desktop: 'Menu categories in two columns; banner stays short; basket total floats bottom-right.',
    },
    imagery: {
      hero: 'Optional — a wide photo of your food or counter. Without one, a clean colour banner is used.',
      items: 'Optional small square photos beside menu items. The menu reads well without them.',
      itemImagesMatter: false,
    },
  },

  SALON_BOOKING: {
    id: 'SALON_BOOKING',
    name: 'Services and booking',
    summary: 'Your services with prices and durations, each bookable right on the page.',
    verticals: ['SALON', 'SERVICES', 'MIXED'],
    base: 'BOOKING',
    pages: { required: ['HOME', 'ABOUT', 'CONTACT'], optional: ['SHOP'] },
    sections: { defaultOrder: ['TRUST_BAR', 'CATALOGUE', 'ABOUT', 'REVIEWS'], required: ['CATALOGUE'], pinned: [] },
    cta: { primary: ['BOOK', 'ENQUIRE', 'WHATSAPP', 'CALL'], secondary: ['WHATSAPP', 'CALL', 'VISIT', 'LOYALTY'] },
    requires: { capabilities: ['SERVICES', 'BOOKINGS'] },
    content: { minCatalogueItems: 1, mobileHeadlineMax: 50, aboutRecommended: true },
    composition: { hero: 'TALL', catalogue: 'SERVICE_BOOKING', defaultPreset: 'PREMIUM', stickyOrderBar: false },
    responsive: {
      mobile: 'Tall photo banner; services as full-width cards with the booking form beneath each.',
      desktop: 'Wide banner with centred navigation; services listed with booking alongside.',
    },
    imagery: {
      hero: 'Strongly recommended — a real photo of your work or your space.',
      items: 'Recommended — a photo per service helps customers choose.',
      itemImagesMatter: true,
    },
  },

  SERVICES_LEAD: {
    id: 'SERVICES_LEAD',
    name: 'Services and enquiries',
    summary: 'For services quoted or arranged by chat or phone: every service is one tap from asking you about it.',
    verticals: ['SERVICES', 'MIXED'],
    base: 'BOOKING',
    pages: { required: ['HOME', 'ABOUT', 'CONTACT'], optional: ['SHOP'] },
    sections: { defaultOrder: ['CATALOGUE', 'TRUST_BAR', 'ABOUT', 'REVIEWS'], required: ['CATALOGUE'], pinned: [] },
    cta: { primary: ['ENQUIRE', 'WHATSAPP', 'CALL'], secondary: ['CALL', 'WHATSAPP', 'VISIT'] },
    requires: { capabilities: ['SERVICES'], anyContact: ['whatsapp', 'phone'] },
    content: { minCatalogueItems: 1, mobileHeadlineMax: 50, aboutRecommended: true },
    composition: { hero: 'TALL', catalogue: 'SERVICE_ENQUIRY', defaultPreset: 'BOLD', stickyOrderBar: false },
    responsive: {
      mobile: 'Banner with one big "Chat on WhatsApp" or "Call us" button; service cards stacked, each with its own enquiry button.',
      desktop: 'Service cards in a grid of two or three; enquiry buttons stay visible on every card.',
    },
    imagery: {
      hero: 'Recommended — a photo of your work, premises or team.',
      items: 'Optional — before/after or work-in-progress photos per service.',
      itemImagesMatter: false,
    },
  },
}

STOREFRONT_TEMPLATE_LIBRARY.RETAIL_GRID = {
  id: 'RETAIL_GRID',
  name: 'Collections and featured',
  summary: 'Your range by collection, with filters and a featured row — the way a shop is browsed.',
  verticals: ['RETAIL', 'MIXED'],
  base: 'PRODUCT',
  pages: { required: ['HOME', 'SHOP', 'CONTACT'], optional: ['ABOUT'] },
  sections: { defaultOrder: ['CATALOGUE', 'TRUST_BAR', 'ABOUT', 'REVIEWS'], required: ['CATALOGUE'], pinned: ['CATALOGUE'] },
  cta: { primary: ['ORDER', 'WHATSAPP', 'CALL', 'VISIT'], secondary: ['WHATSAPP', 'CALL', 'VISIT', 'LOYALTY'] },
  requires: { capabilities: ['PRODUCTS'] },
  content: { minCatalogueItems: 3, mobileHeadlineMax: 50, aboutRecommended: false },
  composition: { hero: 'TALL', catalogue: 'RETAIL_GRID', defaultPreset: 'MODERN', stickyOrderBar: true },
  responsive: {
    mobile: 'Collections as a swipeable row of tiles under the banner, then a two-across featured grid; filters and search on the Shop page; basket total pinned to the bottom.',
    desktop: 'Collections as a tile row, featured items four across, the full range with filters on the Shop page.',
  },
  imagery: {
    hero: 'Recommended — a wide photo of your shop or your best pieces.',
    items: 'Each product needs a photo: a collection tile shows the first photo in it, and a card without a photo shows a letter.',
    itemImagesMatter: true,
  },
}

STOREFRONT_TEMPLATE_LIBRARY.SERVICE_PORTFOLIO = {
  id: 'SERVICE_PORTFOLIO',
  name: 'Portfolio and enquiries',
  summary: 'Your work in photos, how it works in a few steps, real reviews — and a request form as the way to reach you.',
  verticals: ['SERVICES', 'SALON', 'MIXED'],
  base: 'BOOKING',
  pages: { required: ['HOME', 'ABOUT', 'CONTACT'], optional: ['SHOP'] },
  sections: { defaultOrder: ['CATALOGUE', 'REVIEWS', 'ABOUT', 'TRUST_BAR'], required: ['CATALOGUE'], pinned: ['CATALOGUE'] },
  cta: { primary: ['ENQUIRE', 'WHATSAPP', 'CALL', 'BOOK'], secondary: ['WHATSAPP', 'CALL', 'VISIT'] },
  requires: { capabilities: ['SERVICES'], anyContact: ['whatsapp', 'phone'] },
  content: { minCatalogueItems: 1, mobileHeadlineMax: 50, aboutRecommended: true },
  composition: { hero: 'TALL', catalogue: 'SERVICE_PORTFOLIO', defaultPreset: 'BOLD', stickyOrderBar: false },
  responsive: {
    mobile: 'Tall photo banner; services as photo-first cards stacked; a work gallery (grid, or before-and-after pairs); your steps as a numbered list; one request button that stays in reach.',
    desktop: 'Services three across; the gallery four across or in pairs; steps side by side; the request form beside the services.',
  },
  imagery: {
    hero: 'Strongly recommended — your best piece of work.',
    items: 'A photo per service is what sells this layout. Upload before-and-after pairs in order to use the pairs gallery.',
    itemImagesMatter: true,
  },
}

export function getTemplate(id: TemplateId): StorefrontTemplateDefinition {
  return STOREFRONT_TEMPLATE_LIBRARY[id]
}

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && (TEMPLATE_IDS as readonly string[]).includes(value)
}

export interface TemplateFitInput {
  capabilities: Set<BusinessCapability>
  contact: { whatsapp: boolean; phone: boolean }
  productCount: number
  serviceCount: number
  /** Workflows the business can run today — a quote or dated enquiry steers SERVICES towards the portfolio. */
  workflows?: readonly WorkflowId[]
}

/** Every reason a template can't serve this business right now; empty = it fits. */
export function templateMisfits(id: TemplateId, input: TemplateFitInput): string[] {
  const t = getTemplate(id)
  const problems: string[] = []
  for (const capability of t.requires.capabilities) {
    if (!input.capabilities.has(capability)) problems.push(`${t.name} needs ${capability.toLowerCase()} switched on.`)
  }
  if (t.requires.anyContact && !t.requires.anyContact.some((channel) => input.contact[channel])) {
    problems.push(`${t.name} needs a WhatsApp or phone number for enquiries.`)
  }
  return problems
}

export function templateFitsBusiness(id: TemplateId, input: TemplateFitInput): boolean {
  return templateMisfits(id, input).length === 0
}

/**
 * The best-fitting template for a business, or null for the classic
 * Shopfront. Deterministic. MIXED ("adaptive") follows what the business
 * actually offers more of, and how customers can act on it.
 */
export function chooseTemplateId(vertical: Vertical, input: TemplateFitInput): TemplateId | null {
  const fits = (id: TemplateId) => templateFitsBusiness(id, input)
  const servicesLead = input.serviceCount > input.productCount
  // A business whose main request is a quote or a dated enquiry is shown
  // as a portfolio, not a diary (mechanics, events, childcare, laundry).
  const portfolioLed = workflowLeadsOverBooking(primaryWorkflow(input.workflows ?? []))

  const services = (): TemplateId | null => {
    if (portfolioLed && fits('SERVICE_PORTFOLIO')) return 'SERVICE_PORTFOLIO'
    if (fits('SALON_BOOKING')) return 'SALON_BOOKING'
    if (fits('SERVICES_LEAD')) return 'SERVICES_LEAD'
    return fits('SERVICE_PORTFOLIO') ? 'SERVICE_PORTFOLIO' : null
  }

  switch (vertical) {
    case 'FOOD':
      return fits('FOOD_MENU') ? 'FOOD_MENU' : null
    case 'SALON':
    case 'SERVICES':
      return services()
    case 'MIXED':
      if (servicesLead) return services() ?? (fits('RETAIL_GRID') ? 'RETAIL_GRID' : null)
      return fits('RETAIL_GRID') ? 'RETAIL_GRID' : null
    case 'RETAIL':
    default:
      return fits('RETAIL_GRID') ? 'RETAIL_GRID' : null
  }
}
