/**
 * The published layout — what the live Shopfront renderer reads from a
 * published StorefrontSpec (stored at Business.settings.storefrontLayout by
 * project.ts). Pure; no Prisma.
 *
 * A business with NO published layout renders exactly as before this
 * existed: fixed section order, the renderer's own default call to action.
 * Every value read back is re-checked against what the business can do
 * RIGHT NOW (capabilities change after publishing), so a stale layout can
 * never render a dead button or a section pointing at nothing.
 */

import type { BusinessCapability } from '@/modules/tenant/capabilities'
import { deriveDefaultPrimaryAction, resolvePrimaryAction, type PrimaryCustomerAction, type StorefrontThemeConfig } from '@/modules/tenant/storefront-theme'
import { getWorkflow, primaryWorkflow, type WorkflowId } from '@/modules/storefront-workflows/workflows'
import { HOME_SECTIONS, SPEC_ACTIONS, SPEC_TEMPLATES, defaultCtaLabel, type HomeSectionId, type SpecTemplate } from './spec'
import { getTemplate, isTemplateId, templateFitsBusiness, type StorefrontTemplateDefinition, type TemplateId } from './templates'
import { catalogueLayoutFor, defaultSectionLayout, isLayoutAllowed, type SectionLayout } from './layouts'
import { whatsappLink } from '@/lib/utils'

export interface StorefrontLayout {
  version: 1
  revisionId: string
  template: SpecTemplate
  /** A library template composing `template`, or null for the classic Shopfront. */
  templateId: TemplateId | null
  sections: { id: HomeSectionId; visible: boolean; layout?: SectionLayout }[]
  cta: { action: PrimaryCustomerAction; label: string }
  seo: { title: string; description: string }
}

const DEFAULT_SECTION_ORDER: HomeSectionId[] = [...HOME_SECTIONS]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The stored layout, sanitised, or null. Never throws. */
export function getStorefrontLayout(business: { settings: unknown }): StorefrontLayout | null {
  const settings = isRecord(business.settings) ? business.settings : {}
  const raw = settings.storefrontLayout
  if (!isRecord(raw) || raw.version !== 1 || typeof raw.revisionId !== 'string') return null
  if (!SPEC_TEMPLATES.includes(raw.template as SpecTemplate)) return null

  const template = raw.template as SpecTemplate
  const sections = Array.isArray(raw.sections)
    ? raw.sections
        .filter((s): s is { id: HomeSectionId; visible: boolean; layout?: unknown } => isRecord(s) && HOME_SECTIONS.includes(s.id as HomeSectionId) && typeof s.visible === 'boolean')
        // A layout the renderer doesn't have for this base is dropped, never rendered.
        .map((s) => ({ id: s.id, visible: s.visible, ...(isLayoutAllowed(s.id, template, s.layout) ? { layout: s.layout } : {}) }))
    : []
  // Any section missing from a stored layout is appended visible — a future
  // section never silently disappears from an old layout.
  const seen = new Set(sections.map((s) => s.id))
  const complete = [
    ...sections.filter((s, i) => sections.findIndex((t) => t.id === s.id) === i),
    ...DEFAULT_SECTION_ORDER.filter((id) => !seen.has(id)).map((id) => ({ id, visible: true })),
  ]

  const cta = isRecord(raw.cta) ? raw.cta : {}
  const seo = isRecord(raw.seo) ? raw.seo : {}
  if (!SPEC_ACTIONS.includes(cta.action as PrimaryCustomerAction) || typeof cta.label !== 'string') return null

  return {
    version: 1,
    revisionId: raw.revisionId,
    template: raw.template as SpecTemplate,
    templateId: isTemplateId(raw.templateId) && getTemplate(raw.templateId).base === raw.template ? raw.templateId : null,
    sections: complete,
    cta: { action: cta.action as PrimaryCustomerAction, label: cta.label.slice(0, 24) },
    seo: {
      title: typeof seo.title === 'string' ? seo.title.slice(0, 60) : '',
      description: typeof seo.description === 'string' ? seo.description.slice(0, 160) : '',
    },
  }
}

/**
 * Whether a template can serve this business at all: the booking template
 * needs services, the catalogue template needs products. A business with
 * neither keeps whatever its category default is.
 */
export function templateFits(template: SpecTemplate, capabilities: Set<BusinessCapability>): boolean {
  return template === 'BOOKING' ? capabilities.has('SERVICES') : capabilities.has('PRODUCTS')
}

type ContactFields = { whatsapp?: string | null; phone?: string | null; address?: string | null; suburb?: string | null; city?: string | null; slug: string }

/** Where each action goes on the Shopfront, for this template. ENQUIRE needs the primary workflow's page (null without one). */
export function ctaHref(action: PrimaryCustomerAction, template: SpecTemplate, business: ContactFields, basePath: string, enquirySlug: string | null = null): string | null {
  switch (action) {
    case 'ORDER':
      return `${basePath}/shop`
    case 'BOOK':
      return `${basePath}#services`
    case 'ENQUIRE':
      return enquirySlug ? `${basePath}/${enquirySlug}` : null
    case 'WHATSAPP':
      return whatsappLink(business.whatsapp)
    case 'CALL':
      return business.phone ? `tel:${business.phone}` : null
    case 'VISIT':
      return `${basePath}/contact`
    case 'LOYALTY':
      return `/r/${business.slug}`
    case 'BROWSE':
    default:
      return template === 'BOOKING' ? `${basePath}#services` : `${basePath}/shop`
  }
}

export interface HomeLayout {
  /**
   * The library template this home renders with — only when it still fits the
   * business today and matches the variant being rendered; otherwise null
   * (the classic composition).
   */
  template: StorefrontTemplateDefinition | null
  /** Visible middle sections, in order. */
  sections: HomeSectionId[]
  /** Per-section layouts (layouts.ts): the owner's explicit choice, else the template's composition, else the classic look. */
  layouts: Record<HomeSectionId, SectionLayout>
  /** Undefined = the renderer's own default call to action (pre-layout behaviour). */
  heroAction?: { label: string; href: string }
}

function resolveLayouts(template: SpecTemplate, definition: StorefrontTemplateDefinition | null, stored: StorefrontLayout['sections'] = []): Record<HomeSectionId, SectionLayout> {
  const explicit = new Map(stored.filter((s) => s.layout).map((s) => [s.id, s.layout as SectionLayout]))
  return {
    TRUST_BAR: explicit.get('TRUST_BAR') ?? defaultSectionLayout('TRUST_BAR'),
    CATALOGUE: explicit.get('CATALOGUE') ?? catalogueLayoutFor(definition?.composition.catalogue ?? null, template),
    ABOUT: explicit.get('ABOUT') ?? defaultSectionLayout('ABOUT'),
    REVIEWS: explicit.get('REVIEWS') ?? defaultSectionLayout('REVIEWS'),
  }
}

/**
 * What the Shopfront home renders, given the business's live state.
 * `fallbackAction` is the renderer's pre-layout default, kept for businesses
 * without a published layout so nothing changes for them.
 */
export function resolveHomeLayout(
  business: ContactFields & { settings: unknown },
  capabilities: Set<BusinessCapability>,
  template: SpecTemplate,
  basePath: string,
  fallbackAction?: { label: string; href: string },
  /** Workflows the business can run today (site.ts resolves them); decides whether ENQUIRE is a live button. */
  workflows: readonly WorkflowId[] = [],
): HomeLayout {
  const layout = getStorefrontLayout(business)
  const primary = primaryWorkflow(workflows)
  const enquiry = primary ? getWorkflow(primary) : null
  if (!layout) {
    // No published layout: the renderer's own default — unless the business's
    // default action is now a workflow (a mechanic with quotes on), in which
    // case the main button leads there rather than to a slot picker.
    const action = deriveDefaultPrimaryAction(capabilities, business, workflows)
    const href = action === 'ENQUIRE' && enquiry ? ctaHref(action, template, business, basePath, enquiry.slug) : null
    return { template: null, sections: [...DEFAULT_SECTION_ORDER], layouts: resolveLayouts(template, null), heroAction: href ? { label: enquiry!.ctaLabel, href } : fallbackAction }
  }

  const fit = { capabilities, contact: { whatsapp: Boolean(business.whatsapp), phone: Boolean(business.phone) }, productCount: 0, serviceCount: 0, workflows }
  const definition =
    layout.templateId && layout.template === template && templateFitsBusiness(layout.templateId, fit) ? getTemplate(layout.templateId) : null

  let sections = layout.sections.filter((s) => s.visible).map((s) => s.id)
  // A template's required sections are never hidden, whatever was stored.
  for (const required of definition?.sections.required ?? []) {
    if (!sections.includes(required)) sections = [required, ...sections]
  }

  // The published action, re-validated against today's capabilities and
  // contact details (resolvePrimaryAction is the one implementation of that
  // rule). If it no longer holds, fall back to the default action and label.
  const theme: StorefrontThemeConfig = { version: 1, presetId: 'WARM', heroMode: 'MINIMAL', primaryAction: layout.cta.action }
  const action = resolvePrimaryAction(theme, capabilities, business, workflows)
  const label = action === layout.cta.action ? layout.cta.label : defaultCtaLabel(action, template, enquiry?.ctaLabel)
  const href = ctaHref(action, template, business, basePath, enquiry?.slug ?? null)

  // A booking call to action points at the services section — never hide it.
  if (href?.endsWith('#services') && !sections.includes('CATALOGUE')) {
    sections = ['CATALOGUE', ...sections]
  }

  return { template: definition, sections, layouts: resolveLayouts(template, definition, layout.sections), heroAction: href ? { label, href } : fallbackAction }
}
