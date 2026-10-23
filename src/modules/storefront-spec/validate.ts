/**
 * Storefront spec validation — deterministic, pure, the gate between any
 * spec (AI, rules, or a merchant's edit) and publishing.
 *
 *   errors   — block publishing (broken, unsafe, or impossible for this business)
 *   warnings — publishable, but the merchant should know (accessibility,
 *              phone layout, SEO, thin sections)
 *   missing  — business information that would make the storefront better,
 *              each with where to fix it
 *
 * Re-run at publish time against the business's CURRENT facts: a spec that
 * was valid when drafted can become invalid if capabilities change.
 */

import { contrastRatio, parseHexColor, resolveSafePair } from '@/lib/storefront-colors'
import { getAvailablePrimaryActions } from '@/modules/tenant/storefront-theme'
import { capabilitySet, contactFields, type StorefrontFacts } from './facts'
import { templateFits } from './layout'
import { parseSpec, type StorefrontSpec } from './spec'
import { getTemplate, templateMisfits } from './templates'
import { templateFitInput } from './planner'
import { pageHasContent, pageIsServable, type PageContentFacts } from './pages'

/** What each page kind needs to have something to show, from the facts. */
export function pageContentFacts(facts: StorefrontFacts): PageContentFacts {
  return {
    productCount: facts.products.count,
    serviceCount: facts.services.count,
    imageCount: facts.imageCount,
    reviewCount: facts.reviewCount,
    hasAbout: Boolean(facts.description || facts.current.content.about.body),
    hasContact: facts.contact.phone || facts.contact.whatsapp || facts.contact.email || facts.contact.address,
    workflows: facts.workflows,
  }
}

export interface SpecIssue {
  code: string
  message: string
  field?: string
  /** Where in the dashboard the merchant can fix it. */
  fixHref?: string
}

export interface ValidationReport {
  ok: boolean
  errors: SpecIssue[]
  warnings: SpecIssue[]
  missing: SpecIssue[]
}

/** Comfortable on a ~360px phone at the hero's type size before it wraps past three lines. */
const MOBILE_HEADLINE = 50
const MOBILE_CTA = 18
const LONGEST_WORD = 22
const PLACEHOLDER = /lorem ipsum|\btodo\b|\btbd\b|\[[^\]]*\]|xxx|your business name|insert /i
const GENERIC_CTA = /^(click here|submit|go|here|more)$/i

export function validateSpec(raw: unknown, facts: StorefrontFacts): ValidationReport {
  const errors: SpecIssue[] = []
  const warnings: SpecIssue[] = []
  const missing = missingInformation(facts)

  const parsed = parseSpec(raw)
  if (!parsed.ok) {
    for (const message of parsed.errors) errors.push({ code: 'SCHEMA', message })
    return { ok: false, errors, warnings, missing }
  }
  const spec = parsed.spec
  const caps = capabilitySet(facts)

  // --- Template & pages fit the business -----------------------------------
  const neither = !caps.has('PRODUCTS') && !caps.has('SERVICES')
  if (!templateFits(spec.template, caps) && !neither) {
    errors.push({
      code: 'TEMPLATE_UNSUPPORTED',
      field: 'template',
      message: spec.template === 'BOOKING' ? 'The booking layout needs services switched on.' : 'The catalogue layout needs products switched on.',
    })
  }
  if (spec.pages.includes('SHOP') && !caps.has('PRODUCTS')) {
    errors.push({ code: 'PAGE_UNSUPPORTED', field: 'pages', message: 'A Shop page needs products switched on.' })
  }

  // --- Website pages (pages.ts) ------------------------------------------------
  if (spec.site) {
    const contentFacts = pageContentFacts(facts)
    for (const page of spec.site.pages) {
      if (page.kind === 'HOME') continue
      if (!pageIsServable(page, { capabilities: caps, workflows: facts.workflows })) {
        if (page.kind === 'ACTION') {
          // A workflow page whose workflow is off or not in the plan simply doesn't show — publishable, worth knowing.
          warnings.push({
            code: 'WORKFLOW_UNAVAILABLE',
            field: `site.${page.id}`,
            message: `"${page.title}" stays hidden until that request type is switched on and included in your plan.`,
            fixHref: '/dashboard/storefront/actions',
          })
          continue
        }
        errors.push({
          code: 'PAGE_UNSUPPORTED',
          field: `site.${page.id}`,
          message: page.id === 'CATALOGUE_SERVICES' ? `The ${page.title} page needs services switched on.` : `The ${page.title} page needs products switched on.`,
          fixHref: '/dashboard/storefront/pages',
        })
        continue
      }
      if (page.visible && !pageHasContent(page, contentFacts)) {
        warnings.push({
          code: 'EMPTY_PAGE',
          field: `site.${page.id}`,
          message:
            page.kind === 'POLICY' || page.kind === 'CUSTOM'
              ? `"${page.title}" has nothing written yet, so it stays hidden until it does.`
              : `"${page.title}" has nothing to show yet, so it stays out of the menu for now.`,
          fixHref: `/dashboard/storefront/pages/${page.id}`,
        })
      }
      for (const section of page.sections) {
        const words = section.type === 'TEXT' ? [section.heading ?? '', section.body] : section.type === 'FAQ' ? section.items.flatMap((i) => [i.q, i.a]) : []
        if (words.some((text) => PLACEHOLDER.test(text))) {
          errors.push({ code: 'PLACEHOLDER_TEXT', field: `site.${page.id}`, message: `"${page.title}" still has placeholder text.`, fixHref: `/dashboard/storefront/pages/${page.id}` })
          break
        }
      }
    }
    if (!spec.site.pages.some((p) => p.kind === 'CONTACT' && p.visible)) {
      warnings.push({ code: 'NO_CONTACT_PAGE', field: 'site', message: 'Without a Contact page customers have to hunt for your details.', fixHref: '/dashboard/storefront/pages' })
    }
  }

  // --- Library template: its own rules ------------------------------------
  const template = spec.templateId ? getTemplate(spec.templateId) : null
  if (template) {
    if (template.base !== spec.template) {
      errors.push({ code: 'TEMPLATE_BASE_MISMATCH', field: 'templateId', message: `${template.name} uses the ${template.base === 'BOOKING' ? 'services' : 'catalogue'} layout.` })
    }
    for (const problem of templateMisfits(template.id, templateFitInput(facts))) {
      errors.push({ code: 'TEMPLATE_UNSUPPORTED', field: 'templateId', message: problem })
    }
    if (!template.cta.primary.includes(spec.cta.action)) {
      errors.push({
        code: 'CTA_NOT_IN_TEMPLATE',
        field: 'cta.action',
        message: `${template.name} can't lead with that button — choose ${template.cta.primary.map((a) => a.toLowerCase()).join(', ')}.`,
      })
    }
    for (const page of template.pages.required) {
      if (!spec.pages.includes(page)) errors.push({ code: 'PAGE_REQUIRED', field: 'pages', message: `${template.name} needs a ${page.toLowerCase()} page.` })
    }
    for (const required of template.sections.required) {
      if (!spec.home.sections.find((s) => s.id === required)?.visible) {
        errors.push({ code: 'SECTION_REQUIRED', field: 'home.sections', message: `${template.name} is built around this section, so it can't be hidden.` })
      }
    }
    for (const pinned of template.sections.pinned) {
      const want = template.sections.defaultOrder.indexOf(pinned)
      if (spec.home.sections.findIndex((s) => s.id === pinned) !== want) {
        warnings.push({ code: 'SECTION_MOVED', field: 'home.sections', message: `${template.name} works best with that section in position ${want + 1}.` })
      }
    }
    const items = template.base === 'BOOKING' ? facts.services : facts.products
    if (items.count < template.content.minCatalogueItems) {
      warnings.push({ code: 'TEMPLATE_EMPTY', field: 'templateId', message: `${template.name} shows your ${template.base === 'BOOKING' ? 'services' : 'menu'} first, but none are listed yet — customers will see a "still setting up" message.`, fixHref: '/dashboard/catalog' })
    }
    if (template.content.aboutRecommended && !spec.content.aboutBody && !facts.description) {
      warnings.push({ code: 'TEMPLATE_ABOUT', field: 'content.aboutBody', message: `${template.name} reads best with a short "about you".` })
    }
    if (template.imagery.itemImagesMatter && items.count > items.withImages) {
      warnings.push({ code: 'TEMPLATE_IMAGES', message: `${template.name}: ${template.imagery.items}`, fixHref: '/dashboard/catalog' })
    }
  }

  // --- Call to action is real ------------------------------------------------
  const available = getAvailablePrimaryActions(caps, contactFields(facts), facts.workflows)
  if (!available.includes(spec.cta.action)) {
    errors.push({ code: 'CTA_UNAVAILABLE', field: 'cta.action', message: `"${spec.cta.label}" asks customers to ${spec.cta.action.toLowerCase()}, which this business can't take yet.` })
  }
  if (spec.cta.action === 'ORDER' && facts.products.count === 0) {
    errors.push({ code: 'CTA_NOTHING_TO_ORDER', field: 'cta.action', message: 'The main button asks customers to order, but no products are listed.', fixHref: '/dashboard/catalog' })
  }
  if (spec.cta.action === 'BOOK' && spec.template !== 'BOOKING') {
    errors.push({ code: 'CTA_TARGET_MISSING', field: 'cta.action', message: 'Booking needs the services-and-booking layout.' })
  }
  if (spec.cta.action === 'BOOK' && facts.services.count === 0) {
    errors.push({ code: 'CTA_NOTHING_TO_BOOK', field: 'cta.action', message: 'The main button asks customers to book, but no services are listed.', fixHref: '/dashboard/catalog' })
  }
  const catalogue = spec.home.sections.find((s) => s.id === 'CATALOGUE')
  if ((spec.cta.action === 'BOOK' || spec.cta.action === 'ORDER') && catalogue && !catalogue.visible) {
    errors.push({ code: 'CTA_SECTION_HIDDEN', field: 'home.sections', message: 'The main button leads to your catalogue, so the catalogue section has to stay visible.' })
  }
  if (GENERIC_CTA.test(spec.cta.label.trim())) {
    warnings.push({ code: 'CTA_VAGUE', field: 'cta.label', message: 'Say what the button does — e.g. "Order now" or "Book a slot".' })
  }

  // --- Content: present, honest-looking, no placeholders ---------------------
  const words = [spec.content.heroHeadline, spec.content.heroSubline, spec.content.aboutBody, ...spec.content.highlights, spec.cta.label, spec.seo.title, spec.seo.description]
  if (words.some((text) => text && PLACEHOLDER.test(text))) {
    errors.push({ code: 'PLACEHOLDER_TEXT', message: 'Some text still looks like a placeholder. Replace it with real words before publishing.' })
  }
  if (new Set(spec.content.highlights.map((h) => h.toLowerCase())).size !== spec.content.highlights.length) {
    warnings.push({ code: 'DUPLICATE_HIGHLIGHT', field: 'content.highlights', message: 'Two highlights say the same thing.' })
  }

  // --- Sections that would render empty or broken ----------------------------
  const visible = new Set(spec.home.sections.filter((s) => s.visible).map((s) => s.id))
  if (visible.has('REVIEWS') && facts.reviewCount === 0) {
    warnings.push({ code: 'EMPTY_REVIEWS', field: 'home.sections', message: 'The reviews section stays hidden until you have a published review.' })
  }
  if (visible.has('CATALOGUE') && facts.products.count === 0 && facts.services.count === 0) {
    warnings.push({ code: 'EMPTY_CATALOGUE', field: 'home.sections', message: 'Your catalogue is empty, so customers will see a "still setting up" message.', fixHref: '/dashboard/catalog' })
  }
  if (visible.has('ABOUT') && !spec.content.aboutBody && !facts.description) {
    warnings.push({ code: 'EMPTY_ABOUT', field: 'content.aboutBody', message: 'The about section has nothing to say yet.' })
  }
  if (visible.size <= 1) {
    warnings.push({ code: 'THIN_HOME', field: 'home.sections', message: 'Your home page shows very little below the top banner.' })
  }

  // --- Accessibility -----------------------------------------------------------
  for (const [field, hex] of [['theme.primaryColor', spec.theme.primaryColor], ['theme.accentColor', spec.theme.accentColor]] as const) {
    if (resolveSafePair(hex).adjusted) {
      warnings.push({ code: 'COLOUR_ADJUSTED', field, message: `${hex} is too mid-toned for readable text, so buttons in this colour will be shaded slightly darker or lighter.` })
    }
  }
  const p = parseHexColor(spec.theme.primaryColor)
  const a = parseHexColor(spec.theme.accentColor)
  if (p && a && contrastRatio(p, a) < 1.3) {
    warnings.push({ code: 'COLOURS_TOO_SIMILAR', field: 'theme', message: 'Your two brand colours are very similar, so main and secondary buttons will be hard to tell apart.' })
  }
  if (spec.content.heroHeadline === spec.content.heroHeadline.toUpperCase() && /[A-Z]{6,}/.test(spec.content.heroHeadline)) {
    warnings.push({ code: 'ALL_CAPS', field: 'content.heroHeadline', message: 'All-capital headlines are harder to read, especially for screen readers.' })
  }

  // --- Phone and desktop layout ------------------------------------------------
  // A template's own hero sets how much fits (a compact hero fits less).
  const headlineMax = template?.content.mobileHeadlineMax ?? MOBILE_HEADLINE
  if (spec.content.heroHeadline.length > headlineMax) {
    warnings.push({ code: 'MOBILE_HEADLINE_LONG', field: 'content.heroHeadline', message: `Headlines over ${headlineMax} characters wrap onto many lines on a phone.` })
  }
  if (spec.cta.label.length > MOBILE_CTA) {
    warnings.push({ code: 'MOBILE_CTA_LONG', field: 'cta.label', message: `Button text over ${MOBILE_CTA} characters may wrap on a phone.` })
  }
  if (words.some((text) => text?.split(/\s+/).some((word) => word.length > LONGEST_WORD))) {
    warnings.push({ code: 'MOBILE_LONG_WORD', message: `A word over ${LONGEST_WORD} characters can overflow a phone screen.` })
  }

  // --- SEO -----------------------------------------------------------------
  if (!spec.seo.title.toLowerCase().includes(facts.name.toLowerCase().slice(0, 20))) {
    warnings.push({ code: 'SEO_TITLE_NO_NAME', field: 'seo.title', message: 'Search engines show this title — include your business name.' })
  }
  if (spec.seo.description.length < 50) {
    warnings.push({ code: 'SEO_DESCRIPTION_SHORT', field: 'seo.description', message: 'A search description of 70–160 characters gets more clicks.' })
  }

  return { ok: errors.length === 0, errors, warnings, missing }
}

/** What the business could add to get a better storefront — independent of any spec. */
export function missingInformation(facts: StorefrontFacts): SpecIssue[] {
  const issues: SpecIssue[] = []
  if (!facts.brand.hasLogo) issues.push({ code: 'NO_LOGO', message: 'Add your logo so customers recognise you.', fixHref: '/dashboard/storefront/design' })
  if (!facts.brand.hasBanner) issues.push({ code: 'NO_COVER_IMAGE', message: 'Add a cover photo — storefronts with a real photo feel more trustworthy.', fixHref: '/dashboard/storefront/design' })
  if (!facts.description) issues.push({ code: 'NO_DESCRIPTION', message: 'Add a short description of your business.', fixHref: '/dashboard/settings' })
  if (!facts.hoursConfigured) issues.push({ code: 'NO_HOURS', message: 'Add your opening hours.', fixHref: '/dashboard/settings' })
  if (!facts.contact.phone && !facts.contact.whatsapp && !facts.contact.email) {
    issues.push({ code: 'NO_CONTACT', message: 'Add a phone number, WhatsApp or email so customers can reach you.', fixHref: '/dashboard/settings' })
  }
  if (!facts.contact.address) issues.push({ code: 'NO_LOCATION', message: 'Add your area or address so local customers can find you.', fixHref: '/dashboard/settings' })
  const productGap = facts.products.count - facts.products.withImages
  if (productGap > 0) issues.push({ code: 'PRODUCT_IMAGES', message: `${productGap} product${productGap === 1 ? ' has' : 's have'} no photo.`, fixHref: '/dashboard/catalog' })
  const serviceGap = facts.services.count - facts.services.withImages
  if (serviceGap > 0) issues.push({ code: 'SERVICE_IMAGES', message: `${serviceGap} service${serviceGap === 1 ? ' has' : 's have'} no photo.`, fixHref: '/dashboard/catalog' })
  if (facts.products.count === 0 && facts.services.count === 0) {
    issues.push({ code: 'NO_CATALOGUE', message: 'List at least one product or service.', fixHref: '/dashboard/catalog' })
  }
  return issues
}

/** A spec that passed validation, typed. */
export function assertPublishable(raw: unknown, facts: StorefrontFacts): { spec: StorefrontSpec; report: ValidationReport } {
  const report = validateSpec(raw, facts)
  const parsed = parseSpec(raw)
  if (!report.ok || !parsed.ok) throw new SpecNotPublishableError(report)
  return { spec: parsed.spec, report }
}

export class SpecNotPublishableError extends Error {
  constructor(readonly report: ValidationReport) {
    super(report.errors[0]?.message ?? 'This storefront draft has problems that need fixing first.')
    this.name = 'SpecNotPublishableError'
  }
}
