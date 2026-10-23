/**
 * Owner-controlled storefront pages — the page model behind a business's
 * website: which pages exist, what each is called, where it sits in the
 * nav and footer, and which validated sections it is built from.
 *
 * Still a controlled template, never a page builder: an owner picks from a
 * closed set of page kinds and section types and fills text fields. No
 * HTML, no CSS, no links (the spec's safe-text rules apply to every word).
 *
 * Storage: `spec.site` on a storefront revision; published to
 * `Business.settings.storefrontPages` by project.ts. A business that has
 * never published pages gets `defaultSitePages` — the same pages every
 * Shopfront already had (Home, Shop/Menu/Services, About, Contact) plus
 * Gallery, Reviews and the policy pages, which stay out of the way until
 * they have something to show.
 *
 * Pure: zod + types only, no Prisma, no React.
 */

import { z } from 'zod'
import type { BusinessCategory } from '@prisma/client'
import type { BusinessCapability } from '@/modules/tenant/capabilities'
import { specText } from './spec-text'
import { WORKFLOWS, WORKFLOW_IDS, WORKFLOW_SLUGS, isWorkflowId, type WorkflowId } from '@/modules/storefront-workflows/workflows'
import { GALLERY_LAYOUTS } from './layouts'

/** ACTION = a workflow page: a quote, enquiry, pickup or callback form (storefront-workflows/workflows.ts). */
export const PAGE_KINDS = ['HOME', 'CATALOGUE', 'ABOUT', 'CONTACT', 'GALLERY', 'REVIEWS', 'ACTION', 'POLICY', 'CUSTOM'] as const
export type PageKind = (typeof PAGE_KINDS)[number]

/** Section types a non-home page may be built from. Home keeps its own section model (spec.home). */
export const PAGE_SECTION_TYPES = ['TEXT', 'FAQ', 'ABOUT', 'HIGHLIGHTS', 'CONTACT', 'HOURS', 'GALLERY', 'REVIEWS', 'CATALOGUE', 'TRUST_BAR', 'PRIVACY_POINTER', 'ACTION'] as const
export type PageSectionType = (typeof PAGE_SECTION_TYPES)[number]

export const PAGE_LIMITS = {
  pages: 16,
  title: 40,
  slug: 40,
  heading: 80,
  body: 4000,
  faqItems: 12,
  question: 160,
  answer: 800,
  sectionsPerPage: 8,
  seoTitle: 60,
  seoDescription: 160,
} as const

/**
 * Slugs a page may never take: every storefront route that already exists
 * or belongs to another tab (checkout, order, account are Tab 3's), plus
 * platform paths that a tenant host rewrites under the storefront.
 */
export const RESERVED_PAGE_SLUGS: ReadonlySet<string> = new Set([
  'shop', 'menu', 'services', 'about', 'contact', 'gallery', 'reviews',
  ...WORKFLOW_SLUGS,
  'basket', 'cart', 'checkout', 'configure', 'product', 'order', 'orders', 'pay', 'account', 'login', 'register', 'join',
  'api', 'dashboard', 'admin', 'platform-admin', 'preview', 'store', 'r', 'discover', 'terms', 'privacy',
  'sitemap.xml', 'robots.txt', 'favicon.ico', '_next', 'static',
])

/** Slugs the built-in page kinds own; a page of that kind always sits there. */
export const BUILT_IN_SLUGS = {
  HOME: '',
  CATALOGUE_PRODUCTS: 'shop',
  CATALOGUE_SERVICES: 'services',
  ABOUT: 'about',
  CONTACT: 'contact',
  GALLERY: 'gallery',
  REVIEWS: 'reviews',
} as const

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Multi-paragraph owner text: same safety rules as every other spec word, newlines allowed. */
export function longText(max: number) {
  return z
    .string()
    .transform((value) => value.replace(/\r\n?/g, '\n').trim())
    .pipe(
      z
        .string()
        .min(1, 'must not be empty')
        .max(max, `must be ${max} characters or fewer`)
        .refine((value) => !/[<>{}]|javascript:|https?:\/\//i.test(value), 'must not contain markup, braces or links'),
    )
}

export const pageSlug = z
  .string()
  .trim()
  .toLowerCase()
  .max(PAGE_LIMITS.slug)
  .refine((value) => value === '' || SLUG.test(value), 'use lowercase letters, numbers and single dashes')

const TextSection = z.object({ type: z.literal('TEXT'), heading: specText(PAGE_LIMITS.heading).nullable(), body: longText(PAGE_LIMITS.body) }).strict()
const FaqSection = z
  .object({
    type: z.literal('FAQ'),
    items: z.array(z.object({ q: specText(PAGE_LIMITS.question), a: longText(PAGE_LIMITS.answer) }).strict()).min(1).max(PAGE_LIMITS.faqItems),
  })
  .strict()
const plain = <T extends PageSectionType>(type: T) => z.object({ type: z.literal(type) }).strict()
/** A request form: which workflow it submits to. */
const ActionSection = z.object({ type: z.literal('ACTION'), workflow: z.enum(WORKFLOW_IDS) }).strict()

/** Sections with a layout choice (layouts.ts). Absent = the default look. */
const GallerySection = z.object({ type: z.literal('GALLERY'), layout: z.enum(GALLERY_LAYOUTS).optional() }).strict()
const ReviewsSection = z.object({ type: z.literal('REVIEWS'), layout: z.enum(['LIST', 'QUOTE']).optional() }).strict()
const CatalogueSection = z.object({ type: z.literal('CATALOGUE'), layout: z.enum(['GRID', 'LIST']).optional() }).strict()

export const PageSectionSchema = z.discriminatedUnion('type', [
  TextSection,
  FaqSection,
  ActionSection,
  GallerySection,
  ReviewsSection,
  CatalogueSection,
  plain('ABOUT'),
  plain('HIGHLIGHTS'),
  plain('CONTACT'),
  plain('HOURS'),
  plain('TRUST_BAR'),
  plain('PRIVACY_POINTER'),
])

/** The layout options a page section offers, for the editor. */
export function sectionLayoutOptions(type: PageSectionType): readonly string[] {
  switch (type) {
    case 'GALLERY':
      return GALLERY_LAYOUTS
    case 'REVIEWS':
      return ['LIST', 'QUOTE']
    case 'CATALOGUE':
      return ['GRID', 'LIST']
    default:
      return []
  }
}
export type PageSection = z.infer<typeof PageSectionSchema>

export const SitePageSchema = z
  .object({
    /** Stable key: the kind for built-ins (POLICY_* for policies), `page-…` for custom pages. */
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/i),
    kind: z.enum(PAGE_KINDS),
    slug: pageSlug,
    title: specText(PAGE_LIMITS.title),
    /** The page can be opened at all. */
    visible: z.boolean(),
    /** Listed in the top navigation (array order = nav order). */
    inNav: z.boolean(),
    /** Listed in the footer (policy pages live here). */
    inFooter: z.boolean(),
    sections: z.array(PageSectionSchema).max(PAGE_LIMITS.sectionsPerPage),
    /** The owner's own search listing for this page; absent = title + the business's one-liner (storefront-seo.ts). */
    seo: z.object({ title: specText(PAGE_LIMITS.seoTitle).optional(), description: specText(PAGE_LIMITS.seoDescription).optional() }).strict().optional(),
  })
  .strict()
export type SitePage = z.infer<typeof SitePageSchema>

export const SiteSchema = z
  .object({ pages: z.array(SitePageSchema).min(1).max(PAGE_LIMITS.pages) })
  .strict()
  .superRefine((site, ctx) => {
    const homes = site.pages.filter((p) => p.kind === 'HOME')
    if (homes.length !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pages'], message: 'must have exactly one home page' })
    const ids = new Set<string>()
    const slugs = new Set<string>()
    site.pages.forEach((page, i) => {
      if (ids.has(page.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pages', i, 'id'], message: 'page id repeated' })
      ids.add(page.id)
      if (page.kind === 'HOME') {
        if (page.slug !== '') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pages', i, 'slug'], message: 'home has no slug' })
        return
      }
      if (page.slug === '') ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pages', i, 'slug'], message: 'needs a web address' })
      if (slugs.has(page.slug)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pages', i, 'slug'], message: `another page already uses /${page.slug}` })
      slugs.add(page.slug)
      const ownsReserved = builtInSlugFor(page) === page.slug
      if (!ownsReserved && RESERVED_PAGE_SLUGS.has(page.slug)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pages', i, 'slug'], message: `/${page.slug} is reserved` })
      }
      if (page.kind !== 'POLICY' && page.kind !== 'CUSTOM' && ownsReserved === false) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pages', i, 'slug'], message: `${page.kind.toLowerCase()} pages keep their own address` })
      }
    })
  })
export type SiteSpec = z.infer<typeof SiteSchema>

/** The address a built-in page kind owns, or null when the owner may choose. */
export function builtInSlugFor(page: Pick<SitePage, 'kind' | 'id'>): string | null {
  switch (page.kind) {
    case 'HOME':
      return ''
    case 'CATALOGUE':
      return page.id === 'CATALOGUE_SERVICES' ? BUILT_IN_SLUGS.CATALOGUE_SERVICES : BUILT_IN_SLUGS.CATALOGUE_PRODUCTS
    case 'ABOUT':
      return BUILT_IN_SLUGS.ABOUT
    case 'CONTACT':
      return BUILT_IN_SLUGS.CONTACT
    case 'GALLERY':
      return BUILT_IN_SLUGS.GALLERY
    case 'REVIEWS':
      return BUILT_IN_SLUGS.REVIEWS
    case 'ACTION': {
      const workflow = actionPageWorkflow(page)
      return workflow ? WORKFLOWS[workflow].slug : null
    }
    default:
      return null
  }
}

/** ACTION pages are keyed `ACTION_<WORKFLOW>`; the workflow is read back from the id. */
export function actionPageWorkflow(page: Pick<SitePage, 'id'>): WorkflowId | null {
  const raw = page.id.replace(/^ACTION_/, '')
  return isWorkflowId(raw) ? raw : null
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export interface SiteDefaultsInput {
  category: BusinessCategory
  capabilities: Set<BusinessCapability>
  /** The live storefront variant (shopfront-eligibility.ts). */
  variant: 'PRODUCT' | 'BOOKING' | 'LEGACY'
  /** Nav label for the product catalogue (business-experience.ts). */
  catalogLabel: string
  /** Workflows the business can run today — capability AND plan (storefront-workflows/workflows.ts). */
  workflows: readonly WorkflowId[]
}

const POLICY_IDS = { returns: 'POLICY_RETURNS', delivery: 'POLICY_DELIVERY', cancellations: 'POLICY_CANCELLATIONS', privacy: 'POLICY_PRIVACY' } as const

/** The nav word for the product catalogue page: "Menu" for food, "Parts" for a mechanic, "Shop" otherwise. */
export function catalogueNavTitle(catalogLabel: string): string {
  return catalogLabel === 'Products' ? 'Shop' : catalogLabel
}

/**
 * The pages a business gets before its owner has changed anything. Same
 * pages the Shopfront already linked, plus Gallery, Reviews and policies.
 * Policy pages start empty, so they are not reachable until written.
 */
export function defaultSitePages(input: SiteDefaultsInput): SitePage[] {
  const { capabilities } = input
  const pages: SitePage[] = [{ id: 'HOME', kind: 'HOME', slug: '', title: 'Home', visible: true, inNav: true, inFooter: false, sections: [] }]

  if (input.variant === 'BOOKING' && capabilities.has('SERVICES')) {
    pages.push({ id: 'CATALOGUE_SERVICES', kind: 'CATALOGUE', slug: 'services', title: 'Services', visible: true, inNav: true, inFooter: false, sections: [{ type: 'CATALOGUE' }] })
  }
  if (capabilities.has('PRODUCTS')) {
    pages.push({
      id: 'CATALOGUE_PRODUCTS',
      kind: 'CATALOGUE',
      slug: 'shop',
      title: catalogueNavTitle(input.catalogLabel),
      visible: true,
      inNav: true,
      inFooter: false,
      sections: [{ type: 'CATALOGUE' }],
    })
  }
  if (input.variant !== 'BOOKING' && capabilities.has('SERVICES') && !pages.some((p) => p.id === 'CATALOGUE_SERVICES')) {
    pages.push({ id: 'CATALOGUE_SERVICES', kind: 'CATALOGUE', slug: 'services', title: 'Services', visible: true, inNav: true, inFooter: false, sections: [{ type: 'CATALOGUE' }] })
  }

  // Request pages, in workflow priority order, right after the catalogue:
  // "Get a quote" is the point of a mechanic's website.
  for (const workflow of WORKFLOW_IDS) {
    if (!input.workflows.includes(workflow)) continue
    const w = WORKFLOWS[workflow]
    pages.push({ id: `ACTION_${workflow}`, kind: 'ACTION', slug: w.slug, title: w.title, visible: true, inNav: true, inFooter: false, sections: [{ type: 'ACTION', workflow }] })
  }

  pages.push(
    { id: 'ABOUT', kind: 'ABOUT', slug: 'about', title: 'About', visible: true, inNav: true, inFooter: true, sections: [{ type: 'ABOUT' }, { type: 'HIGHLIGHTS' }] },
    { id: 'GALLERY', kind: 'GALLERY', slug: 'gallery', title: 'Gallery', visible: true, inNav: true, inFooter: false, sections: [{ type: 'GALLERY' }] },
    { id: 'REVIEWS', kind: 'REVIEWS', slug: 'reviews', title: 'Reviews', visible: true, inNav: true, inFooter: false, sections: [{ type: 'REVIEWS' }] },
    { id: 'CONTACT', kind: 'CONTACT', slug: 'contact', title: 'Contact', visible: true, inNav: true, inFooter: true, sections: [{ type: 'CONTACT' }, { type: 'HOURS' }] },
  )

  // Policies: the owner writes these. Empty until then (see pageHasContent).
  if (capabilities.has('ORDERS') && capabilities.has('PRODUCTS')) {
    pages.push({ id: POLICY_IDS.returns, kind: 'POLICY', slug: 'returns', title: 'Returns and refunds', visible: true, inNav: false, inFooter: true, sections: [] })
    pages.push({ id: POLICY_IDS.delivery, kind: 'POLICY', slug: 'delivery', title: 'Delivery and collection', visible: true, inNav: false, inFooter: true, sections: [] })
  }
  if (capabilities.has('BOOKINGS') && capabilities.has('SERVICES')) {
    pages.push({ id: POLICY_IDS.cancellations, kind: 'POLICY', slug: 'cancellations', title: 'Bookings and cancellations', visible: true, inNav: false, inFooter: true, sections: [] })
  }
  pages.push({ id: POLICY_IDS.privacy, kind: 'POLICY', slug: 'your-privacy', title: 'Your privacy', visible: true, inNav: false, inFooter: true, sections: [{ type: 'PRIVACY_POINTER' }] })

  return pages
}

// ---------------------------------------------------------------------------
// Reading what is published
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The published pages, re-validated; null when none were ever published or they no longer parse. Never throws. */
export function getPublishedSite(business: { settings: unknown }): SiteSpec | null {
  const settings = isRecord(business.settings) ? business.settings : {}
  const raw = settings.storefrontPages
  if (!isRecord(raw) || raw.version !== 1) return null
  const parsed = SiteSchema.safeParse({ pages: raw.pages })
  return parsed.success ? parsed.data : null
}

/**
 * The pages this storefront renders right now: the published set, or the
 * defaults. Either way every page is re-checked against what the business
 * can do today — a Shop page never shows for a business that switched
 * products off, and a policy page with nothing written stays hidden.
 */
export function getStorefrontPages(business: { settings: unknown }, defaults: SiteDefaultsInput): SitePage[] {
  const published = getPublishedSite(business)
  const pages = published ? published.pages : defaultSitePages(defaults)
  return pages.filter((page) => pageIsServable(page, defaults))
}

/** Capability (and, for request pages, plan) check — whether this kind of page can exist for the business today. */
export function pageIsServable(page: SitePage, input: Pick<SiteDefaultsInput, 'capabilities' | 'workflows'>): boolean {
  if (page.kind === 'ACTION') {
    const workflow = actionPageWorkflow(page)
    return workflow !== null && input.workflows.includes(workflow)
  }
  if (page.kind !== 'CATALOGUE') return true
  return page.id === 'CATALOGUE_SERVICES' ? input.capabilities.has('SERVICES') : input.capabilities.has('PRODUCTS')
}

export interface PageContentFacts {
  productCount: number
  serviceCount: number
  imageCount: number
  reviewCount: number
  hasAbout: boolean
  hasContact: boolean
  /** Workflows the business can run today — an ACTION section without its workflow shows nothing. */
  workflows: readonly WorkflowId[]
}

/**
 * Whether a page would show anything. Pages that would render empty are
 * left out of nav, footer and sitemap, and open as "not found" — an honest
 * empty state, not a blank page with a heading.
 */
export function pageHasContent(page: SitePage, facts: PageContentFacts): boolean {
  if (page.kind === 'HOME') return true
  return page.sections.some((section) => sectionHasContent(page, section, facts))
}

export function sectionHasContent(page: Pick<SitePage, 'id'>, section: PageSection, facts: PageContentFacts): boolean {
  switch (section.type) {
    case 'TEXT':
    case 'FAQ':
    case 'PRIVACY_POINTER':
    case 'TRUST_BAR':
      return true
    case 'ABOUT':
    case 'HIGHLIGHTS':
      return facts.hasAbout
    case 'CONTACT':
    case 'HOURS':
      return facts.hasContact
    case 'GALLERY':
      return facts.imageCount > 0
    case 'REVIEWS':
      return facts.reviewCount > 0
    case 'CATALOGUE':
      return page.id === 'CATALOGUE_SERVICES' ? facts.serviceCount > 0 : facts.productCount > 0
    case 'ACTION':
      return facts.workflows.includes(section.workflow)
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export interface NavItem {
  id: string
  label: string
  href: string
}

export function pageHref(page: Pick<SitePage, 'kind' | 'slug'>, basePath: string): string {
  if (page.kind === 'HOME') return basePath || '/'
  return `${basePath}/${page.slug}`
}

/** Top navigation, in page order — only pages that are visible and have something to show. */
export function resolveNavItems(pages: SitePage[], basePath: string, facts: PageContentFacts): NavItem[] {
  return pages.filter((p) => p.visible && p.inNav && pageHasContent(p, facts)).map((p) => ({ id: p.id, label: p.title, href: pageHref(p, basePath) }))
}

/** Footer links: policy pages and anything else the owner put there. Home is never a footer link. */
export function resolveFooterItems(pages: SitePage[], basePath: string, facts: PageContentFacts): NavItem[] {
  return pages
    .filter((p) => p.kind !== 'HOME' && p.visible && p.inFooter && pageHasContent(p, facts))
    .map((p) => ({ id: p.id, label: p.title, href: pageHref(p, basePath) }))
}

export function findPageBySlug(pages: SitePage[], slug: string): SitePage | null {
  return pages.find((p) => p.kind !== 'HOME' && p.slug === slug) ?? null
}

/** Section types an owner may add to a page of this kind. The core section of a built-in page is fixed. */
export function addableSectionTypes(kind: PageKind): PageSectionType[] {
  switch (kind) {
    case 'HOME':
      return []
    case 'CATALOGUE':
      return ['TEXT', 'FAQ', 'TRUST_BAR', 'ACTION']
    case 'ACTION':
      return ['TEXT', 'FAQ', 'TRUST_BAR', 'GALLERY', 'REVIEWS']
    case 'POLICY':
      return ['TEXT', 'FAQ']
    case 'CUSTOM':
      return ['TEXT', 'FAQ', 'GALLERY', 'REVIEWS', 'HOURS', 'CONTACT', 'HIGHLIGHTS', 'TRUST_BAR', 'ACTION']
    default:
      return ['TEXT', 'FAQ', 'HOURS', 'GALLERY', 'REVIEWS', 'HIGHLIGHTS', 'TRUST_BAR']
  }
}

/** The one section a built-in page is for — it can't be removed, only joined by others. */
export function coreSectionType(kind: PageKind): PageSectionType | null {
  switch (kind) {
    case 'CATALOGUE':
      return 'CATALOGUE'
    case 'ABOUT':
      return 'ABOUT'
    case 'CONTACT':
      return 'CONTACT'
    case 'GALLERY':
      return 'GALLERY'
    case 'REVIEWS':
      return 'REVIEWS'
    case 'ACTION':
      return 'ACTION'
    default:
      return null
  }
}

export const PAGE_SECTION_LABELS: Record<PageSectionType, string> = {
  ACTION: 'Request form',
  TEXT: 'Text',
  FAQ: 'Questions and answers',
  ABOUT: 'About you',
  HIGHLIGHTS: 'Highlights',
  CONTACT: 'Contact details',
  HOURS: 'Opening hours',
  GALLERY: 'Photo gallery',
  REVIEWS: 'Customer reviews',
  CATALOGUE: 'Products or services',
  TRUST_BAR: 'Quick facts bar',
  PRIVACY_POINTER: 'Privacy notice link',
}

/** A fresh custom page with one empty-ish text section the owner fills in. */
export function newCustomPage(title: string, slug: string): SitePage {
  return {
    id: `page-${slug}`,
    kind: 'CUSTOM',
    slug,
    title,
    visible: false,
    inNav: true,
    inFooter: false,
    sections: [],
  }
}
