/**
 * The deterministic half of the pipeline:
 *
 *   facts → vertical → template → goal → pages → sections → call to action
 *         → brand → (rules) content → SEO
 *
 * Everything that decides what a customer can DO on the storefront is
 * decided here, in code, from the business's real capabilities — never by
 * the model. The AI (copywriter.ts) may only adjust words and style within
 * the choices this planner allows.
 *
 * Also produces a complete, factual, rules-only spec, so a model outage or a
 * rejected model answer still yields a usable storefront. Pure.
 */

import type { BusinessCategory } from '@prisma/client'
import { categoryLabel } from '@/lib/business-categories'
import { getAvailablePrimaryActions, type PrimaryCustomerAction, type StorefrontGoal, type StorefrontPresetId } from '@/modules/tenant/storefront-theme'
import { capabilitySet, contactFields, type StorefrontFacts } from './facts'
import { defaultCtaLabel, HOME_SECTIONS, SPEC_LIMITS, SPEC_VERSION, type HomeSectionId, type SpecPage, type SpecTemplate, type StorefrontSpec, type Vertical } from './spec'
import { TEMPLATE_IDS, chooseTemplateId, getTemplate, templateFitsBusiness, type TemplateFitInput, type TemplateId } from './templates'
import { defaultSitePages, type SiteSpec } from './pages'
import { getBusinessExperience } from '@/modules/tenant/business-experience'
import { getWorkflow, primaryWorkflow, workflowLeadsOverBooking } from '@/modules/storefront-workflows/workflows'

/** Same defaults the Business model applies, used when a business never set its own colours. */
export const PLATFORM_DEFAULT_COLOURS = { primary: '#E8A020', accent: '#F59E0B' } as const

const CATEGORY_VERTICAL: Partial<Record<BusinessCategory, Vertical>> = {
  FOOD_VENDOR: 'FOOD',
  TUCK_SHOP: 'FOOD',
  SALON: 'SALON',
  HAIR_BRAIDER: 'SALON',
  NAIL_TECHNICIAN: 'SALON',
  RETAIL_STORE: 'RETAIL',
  CAR_WASH: 'SERVICES',
  MECHANIC: 'SERVICES',
  EVENTS: 'SERVICES',
  CHILDCARE: 'SERVICES',
  LAUNDRY: 'SERVICES',
}

const VERTICAL_PRESET: Record<Vertical, StorefrontPresetId> = {
  FOOD: 'WARM',
  SALON: 'PREMIUM',
  RETAIL: 'MODERN',
  SERVICES: 'BOLD',
  MIXED: 'CALM',
}

/** Category first; for OTHER, what the business actually lists. */
export function classifyVertical(facts: StorefrontFacts): Vertical {
  const mapped = CATEGORY_VERTICAL[facts.category]
  if (mapped) return mapped
  const hasProducts = facts.products.count > 0
  const hasServices = facts.services.count > 0
  if (hasProducts && hasServices) return 'MIXED'
  if (hasServices) return 'SERVICES'
  if (hasProducts) return 'RETAIL'
  return 'MIXED'
}

/**
 * The live template that serves this vertical — constrained by capability:
 * the booking template needs services, the catalogue template needs products.
 */
export function chooseTemplate(vertical: Vertical, facts: StorefrontFacts): SpecTemplate {
  const caps = capabilitySet(facts)
  const canBook = caps.has('SERVICES')
  const canShop = caps.has('PRODUCTS')
  const prefersBooking =
    vertical === 'SALON' || vertical === 'SERVICES' || (vertical === 'MIXED' && facts.services.count > facts.products.count)
  if (prefersBooking && canBook) return 'BOOKING'
  if (canShop) return 'PRODUCT'
  if (canBook) return 'BOOKING'
  return 'PRODUCT'
}

/** The goals this business can actually pursue, most valuable first. */
export function achievableGoals(facts: StorefrontFacts, template: SpecTemplate): StorefrontGoal[] {
  const caps = capabilitySet(facts)
  const goals: StorefrontGoal[] = []
  const primary = primaryWorkflow(facts.workflows)
  if (template === 'PRODUCT' && caps.has('PRODUCTS') && caps.has('ORDERS') && facts.products.count > 0) goals.push('ORDERS')
  // A quote or dated enquiry outranks booking by the hour (see the audit); a pickup or callback sits below it.
  if (primary && workflowLeadsOverBooking(primary)) goals.push('ENQUIRIES')
  if (template === 'BOOKING' && caps.has('SERVICES') && caps.has('BOOKINGS') && facts.services.count > 0) goals.push('BOOKINGS')
  if (primary && !workflowLeadsOverBooking(primary)) goals.push('ENQUIRIES')
  if (facts.contact.whatsapp) goals.push('WHATSAPP_LEADS')
  if (facts.contact.address) goals.push('FOOT_TRAFFIC')
  goals.push('BRAND_ONLY')
  return goals
}

export function chooseGoal(facts: StorefrontFacts, template: SpecTemplate): StorefrontGoal {
  const goals = achievableGoals(facts, template)
  // The owner's own stated goal wins whenever it's achievable.
  if (facts.profile.goal && goals.includes(facts.profile.goal)) return facts.profile.goal
  return goals[0]
}

const GOAL_ACTION: Record<StorefrontGoal, PrimaryCustomerAction> = {
  ORDERS: 'ORDER',
  BOOKINGS: 'BOOK',
  ENQUIRIES: 'ENQUIRE',
  WHATSAPP_LEADS: 'WHATSAPP',
  FOOT_TRAFFIC: 'VISIT',
  BRAND_ONLY: 'BROWSE',
}

/**
 * Every call to action this business could honestly offer on this template
 * — and, for a library template, only the actions its CTA hierarchy allows,
 * in that template's priority order.
 */
export function allowedActions(facts: StorefrontFacts, template: SpecTemplate, templateId: TemplateId | null = null): PrimaryCustomerAction[] {
  const possible = getAvailablePrimaryActions(capabilitySet(facts), contactFields(facts), facts.workflows).filter((action) => {
    // Booking anchors to the services section, which only the booking layout has.
    if (action === 'BOOK') return template === 'BOOKING' && facts.services.count > 0 && templateId !== 'SERVICES_LEAD'
    if (action === 'ORDER') return facts.products.count > 0
    return true
  })
  if (!templateId) return possible
  return getTemplate(templateId).cta.primary.filter((action) => possible.includes(action))
}

export function templateFitInput(facts: StorefrontFacts): TemplateFitInput {
  return {
    capabilities: capabilitySet(facts),
    contact: { whatsapp: facts.contact.whatsapp, phone: facts.contact.phone },
    productCount: facts.products.count,
    serviceCount: facts.services.count,
    workflows: facts.workflows,
  }
}

export function chooseAction(facts: StorefrontFacts, template: SpecTemplate, goal: StorefrontGoal, templateId: TemplateId | null = null): PrimaryCustomerAction {
  const wanted = GOAL_ACTION[goal]
  const allowed = allowedActions(facts, template, templateId)
  return allowed.includes(wanted) ? wanted : allowed[0] ?? 'BROWSE'
}

/** The words of the business's primary workflow button ("Get a quote"), for defaultCtaLabel. */
export function enquiryLabel(facts: StorefrontFacts): string | null {
  const primary = primaryWorkflow(facts.workflows)
  return primary ? getWorkflow(primary).ctaLabel : null
}

export function choosePages(facts: StorefrontFacts): SpecPage[] {
  const pages: SpecPage[] = ['HOME']
  if (capabilitySet(facts).has('PRODUCTS')) pages.push('SHOP')
  pages.push('ABOUT', 'CONTACT')
  return pages
}

export function defaultSections(facts: StorefrontFacts, templateId: TemplateId | null = null): StorefrontSpec['home']['sections'] {
  const order: HomeSectionId[] = templateId ? [...getTemplate(templateId).sections.defaultOrder] : [...HOME_SECTIONS]
  return order.map((id) => ({ id, visible: id === 'REVIEWS' ? facts.reviewCount > 0 : true }))
}

/**
 * Fact-derived text (names, descriptions) is the business's own, but it
 * still has to pass the spec's safety rules: drop links, markup and braces
 * rather than fail the whole storefront over them.
 */
export function scrubText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/[<>{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function clip(raw: string, max: number): string {
  const text = scrubText(raw)
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2)).trim()}…`
}

function place(facts: StorefrontFacts): string | null {
  return facts.location.suburb || facts.location.city
}

/** Factual copy from the facts alone — never a claim the business didn't make. */
export function rulesContent(facts: StorefrontFacts, template: SpecTemplate): StorefrontSpec['content'] {
  const caps = capabilitySet(facts)
  const where = place(facts)
  const kind = categoryLabel(facts.category).toLowerCase()

  const headline =
    template === 'BOOKING' && caps.has('BOOKINGS') && facts.services.count > 0
      ? `Book with ${facts.name}`
      : caps.has('ORDERS') && facts.products.count > 0
        ? `Order from ${facts.name}`
        : facts.name

  const sublineParts = [where ? `${categoryLabel(facts.category)} in ${where}.` : `${categoryLabel(facts.category)}.`]
  if (caps.has('ORDERS') && facts.products.count > 0) sublineParts.push(facts.deliveryEnabled ? 'Order online for collection or delivery.' : 'Order online and collect.')
  else if (caps.has('BOOKINGS') && facts.services.count > 0) sublineParts.push('Book your appointment online.')

  const catalogue = template === 'BOOKING' ? facts.services : facts.products
  const about =
    facts.description ||
    `${facts.name} is a ${kind} business${where ? ` in ${where}` : ''}.` +
      (catalogue.sampleNames.length > 0 ? ` Offering ${catalogue.sampleNames.slice(0, 3).join(', ')} and more.` : '')

  const highlights: string[] = []
  if (caps.has('ORDERS') && facts.products.count > 0) highlights.push('Order online')
  if (facts.deliveryEnabled) highlights.push('Delivery available')
  if (caps.has('BOOKINGS') && facts.services.count > 0) highlights.push('Book online')
  if (facts.contact.whatsapp) highlights.push('Chat to us on WhatsApp')

  return {
    heroHeadline: clip(headline, SPEC_LIMITS.headline),
    heroSubline: clip(sublineParts.join(' '), SPEC_LIMITS.subline),
    aboutBody: clip(about, SPEC_LIMITS.about),
    highlights: highlights.slice(0, SPEC_LIMITS.highlights),
  }
}

export function rulesSeo(facts: StorefrontFacts): StorefrontSpec['seo'] {
  const where = place(facts)
  const title = clip(`${facts.name} — ${categoryLabel(facts.category)}${where ? ` in ${where}` : ''}`, SPEC_LIMITS.seoTitle)
  const description = clip(
    facts.description || `${facts.name}, ${categoryLabel(facts.category).toLowerCase()}${where ? ` in ${where}` : ''}. See what's on offer and get in touch.`,
    SPEC_LIMITS.seoDescription,
  )
  return { title, description }
}

/** The owner's own colours if they set any; otherwise the platform defaults. */
export function brandColours(facts: StorefrontFacts): { primaryColor: string; accentColor: string } {
  return {
    primaryColor: facts.brand.primaryColor || PLATFORM_DEFAULT_COLOURS.primary,
    accentColor: facts.brand.accentColor || PLATFORM_DEFAULT_COLOURS.accent,
  }
}

export function ownerSetColours(facts: StorefrontFacts): boolean {
  const { primaryColor, accentColor } = brandColours(facts)
  return primaryColor.toUpperCase() !== PLATFORM_DEFAULT_COLOURS.primary || accentColor.toUpperCase() !== PLATFORM_DEFAULT_COLOURS.accent
}

export interface StorefrontPlan {
  vertical: Vertical
  /** The library template, or null for the classic Shopfront. */
  templateId: TemplateId | null
  /** Library templates this business could use today — what the AI may pick from. */
  availableTemplateIds: TemplateId[]
  template: SpecTemplate
  goal: StorefrontGoal
  pages: SpecPage[]
  allowedActions: PrimaryCustomerAction[]
}

export function planStorefront(facts: StorefrontFacts, mode: 'ASSIST' | 'GENERATE'): StorefrontPlan {
  const vertical = classifyVertical(facts)
  const fit = templateFitInput(facts)
  const availableTemplateIds = TEMPLATE_IDS.filter((id) => templateFitsBusiness(id, fit))

  // Level A keeps today's layout and template (if it still fits); Level B chooses.
  const templateId =
    mode === 'ASSIST'
      ? facts.current.templateId && availableTemplateIds.includes(facts.current.templateId) ? facts.current.templateId : null
      : chooseTemplateId(vertical, fit)
  const template = templateId ? getTemplate(templateId).base : mode === 'ASSIST' ? facts.current.template : chooseTemplate(vertical, facts)
  const goal = chooseGoal(facts, template)
  return {
    vertical,
    templateId,
    availableTemplateIds,
    template,
    goal,
    pages: choosePages(facts),
    allowedActions: allowedActions(facts, template, templateId),
  }
}

/**
 * Puts a spec on a library template (or back on the classic Shopfront,
 * templateId null), re-deriving everything the template governs: base
 * layout, section order, default style (unless the owner chose one) and —
 * if the current main button isn't in the template's hierarchy — the main
 * button. The ONE implementation of a template switch, used by both the AI
 * merge and the merchant's editor.
 */
export function applyTemplate(spec: StorefrontSpec, facts: StorefrontFacts, templateId: TemplateId | null): StorefrontSpec {
  const next: StorefrontSpec = structuredClone(spec)
  next.templateId = templateId
  next.template = templateId ? getTemplate(templateId).base : chooseTemplate(classifyVertical(facts), facts)
  if (templateId && !facts.profile.feeling) next.theme.presetId = getTemplate(templateId).composition.defaultPreset
  next.home.sections = defaultSections(facts, templateId)
  if (!allowedActions(facts, next.template, templateId).includes(next.cta.action)) {
    next.cta.action = chooseAction(facts, next.template, next.strategy.goal, templateId)
    next.cta.label = defaultCtaLabel(next.cta.action, next.template, enquiryLabel(facts))
  }
  return next
}

/**
 * The website pages a spec starts from: whatever the owner has published,
 * else the defaults for this kind of business. Pages are never generated —
 * both levels (assist and generate) keep them exactly as they are.
 */
export function currentSite(facts: StorefrontFacts): SiteSpec {
  if (facts.current.site) return structuredClone(facts.current.site)
  return {
    pages: defaultSitePages({
      category: facts.category,
      capabilities: capabilitySet(facts),
      variant: facts.current.template,
      catalogLabel: getBusinessExperience(facts.category).catalogLabel,
      workflows: facts.workflows,
    }),
  }
}

/** A complete, valid, factual storefront without any model involved. */
export function buildRulesSpec(facts: StorefrontFacts, mode: 'ASSIST' | 'GENERATE'): StorefrontSpec {
  const plan = planStorefront(facts, mode)
  const action = chooseAction(facts, plan.template, plan.goal, plan.templateId)
  const current = facts.current.content
  const rules = rulesContent(facts, plan.template)

  // Level A keeps any copy the owner already wrote and only fills gaps.
  const content =
    mode === 'ASSIST'
      ? {
          heroHeadline: current.hero.headline || rules.heroHeadline,
          heroSubline: current.hero.subheadline || rules.heroSubline,
          aboutBody: current.about.body || rules.aboutBody,
          highlights: current.highlights.items.length > 0 ? current.highlights.items.slice(0, SPEC_LIMITS.highlights) : rules.highlights,
        }
      : rules

  return {
    version: SPEC_VERSION,
    strategy: {
      vertical: plan.vertical,
      goal: plan.goal,
      audience: null,
      rationale: `A ${plan.template === 'BOOKING' ? 'booking-first' : 'catalogue-first'} storefront, built from what ${facts.name} actually offers.`,
    },
    template: plan.template,
    templateId: plan.templateId,
    pages: plan.pages,
    home: { sections: defaultSections(facts, plan.templateId) },
    content,
    cta: { action, label: defaultCtaLabel(action, plan.template, enquiryLabel(facts)) },
    theme: {
      presetId: facts.profile.feeling ?? (plan.templateId ? getTemplate(plan.templateId).composition.defaultPreset : VERTICAL_PRESET[plan.vertical]),
      ...brandColours(facts),
    },
    seo: rulesSeo(facts),
    site: currentSite(facts),
  }
}
