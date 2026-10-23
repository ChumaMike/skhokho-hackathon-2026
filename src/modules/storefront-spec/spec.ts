/**
 * The Storefront Specification — the ONLY thing the Storefront Intelligence
 * Engine produces. Structured intent, never code: no HTML, CSS, React, URLs
 * or scripts. Skhokho's own Shopfront renderer turns it into a page.
 *
 * Every field maps onto something the live renderer actually honours
 * (see layout.ts / project.ts). A knob the renderer would ignore is not in
 * here — the merchant must be able to trust that what they approve is what
 * customers see.
 *
 * Pure: zod + types only, no Prisma.
 */

import { z } from 'zod'
import { parseHexColor } from '@/lib/storefront-colors'
import type { PrimaryCustomerAction, StorefrontGoal, StorefrontPresetId } from '@/modules/tenant/storefront-theme'
import { TEMPLATE_IDS } from './templates'
import { SiteSchema } from './pages'
import { specText } from './spec-text'
import { allowedLayouts, isLayoutAllowed } from './layouts'

export { specText, UNSAFE_TEXT } from './spec-text'

export const SPEC_VERSION = 1

/** Storefront families the planner reasons about. */
export const VERTICALS = ['FOOD', 'SALON', 'RETAIL', 'SERVICES', 'MIXED'] as const
export type Vertical = (typeof VERTICALS)[number]

/** The live Shopfront variants: catalogue-first, or services + booking first. */
export const SPEC_TEMPLATES = ['PRODUCT', 'BOOKING'] as const
export type SpecTemplate = (typeof SPEC_TEMPLATES)[number]

export const SPEC_PAGES = ['HOME', 'SHOP', 'ABOUT', 'CONTACT'] as const
export type SpecPage = (typeof SPEC_PAGES)[number]

/**
 * The home page's re-orderable middle. The hero is always first and contact
 * always last — structural, not configurable — so commerce and contact are
 * never lost.
 */
export const HOME_SECTIONS = ['TRUST_BAR', 'CATALOGUE', 'ABOUT', 'REVIEWS'] as const
export type HomeSectionId = (typeof HOME_SECTIONS)[number]

export const SPEC_GOALS = ['ORDERS', 'BOOKINGS', 'ENQUIRIES', 'WHATSAPP_LEADS', 'FOOT_TRAFFIC', 'BRAND_ONLY'] as const satisfies readonly StorefrontGoal[]
export const SPEC_ACTIONS = ['ORDER', 'BOOK', 'ENQUIRE', 'WHATSAPP', 'CALL', 'VISIT', 'BROWSE', 'LOYALTY'] as const satisfies readonly PrimaryCustomerAction[]
export const SPEC_PRESETS = ['BOLD', 'WARM', 'MODERN', 'PREMIUM', 'PLAYFUL', 'CALM'] as const satisfies readonly StorefrontPresetId[]

export const SPEC_LIMITS = {
  headline: 80,
  subline: 160,
  about: 600,
  highlight: 80,
  highlights: 4,
  ctaLabel: 24,
  seoTitle: 60,
  seoDescription: 160,
  audience: 120,
  rationale: 280,
  suggestion: 140,
  suggestions: 3,
  processTitle: 60,
  processBody: 200,
  processSteps: 5,
} as const

export const hexColour = z.string().refine((value) => parseHexColor(value) !== null, 'must be a hex colour like #9A5A0A')

export const StorefrontSpecSchema = z
  .object({
    version: z.literal(SPEC_VERSION),
    strategy: z
      .object({
        vertical: z.enum(VERTICALS),
        goal: z.enum(SPEC_GOALS),
        audience: specText(SPEC_LIMITS.audience).nullable(),
        rationale: specText(SPEC_LIMITS.rationale),
        /** AI-recommended improvements, shown to the merchant — never applied automatically. */
        suggestions: z.array(specText(SPEC_LIMITS.suggestion)).max(SPEC_LIMITS.suggestions).optional(),
      })
      .strict(),
    template: z.enum(SPEC_TEMPLATES),
    /** A library template (templates.ts) composing `template`, or null for the classic Shopfront. Optional so v1 specs saved before the library still parse. */
    templateId: z.enum(TEMPLATE_IDS).nullable().optional(),
    pages: z.array(z.enum(SPEC_PAGES)).min(1).max(SPEC_PAGES.length),
    home: z
      .object({
        sections: z
          .array(
            z
              .object({
                id: z.enum(HOME_SECTIONS),
                visible: z.boolean(),
                /** A per-section layout (layouts.ts); absent = the template's default composition. Checked against the base below. */
                layout: z.string().max(20).optional(),
              })
              .strict(),
          )
          .length(HOME_SECTIONS.length, `must list each of ${HOME_SECTIONS.join(', ')} exactly once`),
      })
      .strict(),
    content: z
      .object({
        heroHeadline: specText(SPEC_LIMITS.headline),
        heroSubline: specText(SPEC_LIMITS.subline).nullable(),
        aboutBody: specText(SPEC_LIMITS.about).nullable(),
        highlights: z.array(specText(SPEC_LIMITS.highlight)).max(SPEC_LIMITS.highlights),
        /** "How it works" steps, the owner's own (SERVICE_PORTFOLIO shows them). Optional so older specs parse. */
        process: z.array(z.object({ title: specText(SPEC_LIMITS.processTitle), body: specText(SPEC_LIMITS.processBody) }).strict()).max(SPEC_LIMITS.processSteps).optional(),
      })
      .strict(),
    cta: z.object({ action: z.enum(SPEC_ACTIONS), label: specText(SPEC_LIMITS.ctaLabel) }).strict(),
    theme: z.object({ presetId: z.enum(SPEC_PRESETS), primaryColor: hexColour, accentColor: hexColour }).strict(),
    seo: z.object({ title: specText(SPEC_LIMITS.seoTitle), description: specText(SPEC_LIMITS.seoDescription) }).strict(),
    /**
     * The owner's website pages (pages.ts). Optional so every revision saved
     * before pages existed still parses; the planner always fills it in, and
     * the AI never writes it — pages are the owner's, words and all.
     */
    site: SiteSchema.optional(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const ids = spec.home.sections.map((s) => s.id)
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['home', 'sections'], message: 'must not repeat a section' })
    }
    if (new Set(spec.pages).size !== spec.pages.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pages'], message: 'must not repeat a page' })
    }
    if (!spec.pages.includes('HOME')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pages'], message: 'must include HOME' })
    }
    spec.home.sections.forEach((section, i) => {
      if (section.layout !== undefined && !isLayoutAllowed(section.id, spec.template, section.layout)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['home', 'sections', i, 'layout'],
          message: `${section.id} can be ${allowedLayouts(section.id, spec.template).join(', ')} on this layout`,
        })
      }
    })
  })

export type StorefrontSpec = z.infer<typeof StorefrontSpecSchema>

export type SpecParseResult = { ok: true; spec: StorefrontSpec } | { ok: false; errors: string[] }

/** Parse anything (AI output, stored JSON, an edit) into a spec, or say exactly why not. */
export function parseSpec(raw: unknown): SpecParseResult {
  const result = StorefrontSpecSchema.safeParse(raw)
  if (result.success) return { ok: true, spec: result.data }
  return { ok: false, errors: result.error.issues.map((issue) => `${issue.path.join('.') || 'spec'}: ${issue.message}`) }
}

/**
 * The renderer's default label for each action — also the planner's.
 * ENQUIRE takes its words from the business's primary workflow ("Get a
 * quote", "Enquire now", …); without one it reads "Get in touch".
 */
export function defaultCtaLabel(action: PrimaryCustomerAction, template: SpecTemplate, enquiryLabel?: string | null): string {
  switch (action) {
    case 'ORDER':
      return 'Order now'
    case 'BOOK':
      return 'Book now'
    case 'ENQUIRE':
      return enquiryLabel || 'Get in touch'
    case 'WHATSAPP':
      return 'Chat on WhatsApp'
    case 'CALL':
      return 'Call us'
    case 'VISIT':
      return 'Find us'
    case 'LOYALTY':
      return 'Join for rewards'
    case 'BROWSE':
    default:
      return template === 'BOOKING' ? 'See our services' : 'Shop the collection'
  }
}
