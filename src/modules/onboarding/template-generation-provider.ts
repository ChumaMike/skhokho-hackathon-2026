import type { BusinessCategory } from '@prisma/client'
import { categoryLabel } from '@/lib/business-categories'
import { suggestTemplateForCategory, STOREFRONT_TEMPLATES, validateGeneratedPages, type StorefrontPageId } from '@/modules/tenant/storefront-templates'
import { externalAiEnabled } from '@/lib/ai/external-ai'
import { actorFrom, callModel, type AiMeta } from '@/lib/ai/anthropic'

/**
 * Template Generation Provider (A4) — same two-provider shape as
 * onboarding-provider.ts's writeBriefWithFallback and the dashboard
 * assistant's llm-provider.ts: a deterministic rules provider by default, a
 * real Claude call when ANTHROPIC_API_KEY is set, chosen by env var. No SDK
 * — the Messages API is one fetch.
 *
 * The model's ONLY job is arranging which of the four known page types
 * (HOME/ABOUT/GALLERY/CONTACT) a business's storefront should have — it
 * never generates markup, copy, or a new page type. That keeps the output
 * space small enough to validate strictly (validateGeneratedPages) and
 * means a malformed/hallucinated response degrades to the rules provider
 * rather than ever rendering something unvetted.
 */

export interface TemplateGenerationContext {
  businessName: string
  category: BusinessCategory
  /** Accounting only — never placed in the prompt. */
  meta?: AiMeta
  /** BusinessProfile.brief, if the onboarding interview produced one — optional, a business can reach this without ever having done the interview. */
  brief?: string | null
  /**
   * A small, pre-summarized snapshot of what the business actually sells
   * today — optional, and absent for a brand-new business with no catalogue
   * yet (behaviour then is unchanged: name + category + brief only). Never
   * raw DB rows: the caller (generateStorefrontTemplate) is responsible for
   * capping sampleNames before this reaches the prompt, same "small, bounded
   * input" discipline buildSystemPrompt already applies to brief.
   */
  catalogueSummary?: { productCount: number; serviceCount: number; sampleNames: string[] }
}

export type TemplateGenerationSourceKind = 'rules' | 'model'

export interface TemplateGenerationProvider {
  readonly source: TemplateGenerationSourceKind
  generatePages(ctx: TemplateGenerationContext): Promise<StorefrontPageId[]>
}

/**
 * Picks the closest built-in template's page set by category — not a
 * placeholder. A business whose category has no dedicated template (OTHER,
 * or any category not yet mapped) still gets a real, considered page set:
 * suggestTemplateForCategory's own CLASSIC fallback, which is HOME-only —
 * the same safe default every other unmatched category already gets.
 */
function buildRulesPages(ctx: TemplateGenerationContext): StorefrontPageId[] {
  const templateId = suggestTemplateForCategory(ctx.category)
  return STOREFRONT_TEMPLATES[templateId].pages
}

const rulesProvider: TemplateGenerationProvider = {
  source: 'rules',
  async generatePages(ctx) {
    return buildRulesPages(ctx)
  },
}

/** Exported for direct unit testing — the prompt itself is the thing worth asserting on, not just its downstream effect on a mocked model call. */
export function buildSystemPrompt(ctx: TemplateGenerationContext): string {
  const catalogue = ctx.catalogueSummary
  const catalogueLine =
    catalogue && (catalogue.productCount > 0 || catalogue.serviceCount > 0)
      ? `This business currently has ${catalogue.productCount} product(s) and ${catalogue.serviceCount} service(s) listed` +
        (catalogue.sampleNames.length > 0 ? `, including: ${catalogue.sampleNames.join(', ')}.` : '.')
      : null

  return [
    `You are choosing which pages a small business's storefront website should have, for Skhokho, a South African platform that builds storefront websites for small businesses.`,
    ``,
    `Business name: ${ctx.businessName}`,
    `Category: ${categoryLabel(ctx.category)}`,
    ctx.brief ? `Business brief:\n${ctx.brief}` : `No further brief is available — decide from the name and category alone.`,
    catalogueLine ?? `No catalogue data is available yet — this may be a brand-new business.`,
    ``,
    `Every storefront always has a Home page (it already shows their products/services) — you are choosing which OTHER pages to ADD, from exactly these four page types and no others:`,
    `- ABOUT: a page telling the business's story — good for a business that benefits from building trust before a customer buys.`,
    `- GALLERY: a photo gallery of their work/products/dishes — good for a visually-driven business.`,
    `- CONTACT: a dedicated hours & location page with a directions link — good for a business customers need to visit or book with.`,
    ``,
    `Reply with ONLY a JSON object, no other text, in exactly this shape:`,
    `{"pages": ["HOME", ...]}`,
    `Include HOME plus zero to three of ABOUT/GALLERY/CONTACT — whichever genuinely fit this business, not all of them by default.`,
  ].join('\n')
}

/** Strips a markdown code fence if the model wrapped its JSON in one, despite the system prompt asking for raw JSON — cheap, common model behaviour, not worth a retry loop over. */
function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  return fenced ? fenced[1] : text
}

const anthropicProvider: TemplateGenerationProvider = {
  source: 'model',
  async generatePages(ctx) {
    // Short timeout: an interactive button click waits on this; rules take over on failure.
    const result = await callModel({
      feature: 'ai_business_buddy',
      capability: 'storefront.template_pages',
      businessId: ctx.meta?.businessId ?? null,
      actor: actorFrom(ctx.meta),
      model: process.env.ANTHROPIC_TEMPLATE_GENERATION_MODEL || undefined,
      maxTokens: 200,
      timeoutMs: 8_000,
      system: buildSystemPrompt(ctx),
      messages: [{ role: 'user', content: 'Choose the pages now.' }],
    })
    if (!result.text) throw new Error('Template generation request returned no text')
    const parsed: unknown = JSON.parse(stripCodeFence(result.text))
    const pages = validateGeneratedPages(parsed)
    if (!pages) throw new Error('Model returned an unparseable/invalid page list')
    return pages
  },
}

export function getTemplateGenerationProvider(): TemplateGenerationProvider {
  return externalAiEnabled() ? anthropicProvider : rulesProvider
}

/**
 * Generates the page list, falling back to the rules provider if the live
 * call fails, times out, or returns something that doesn't validate. The
 * wizard's "none of these fit me" button is waiting on this synchronously —
 * a model outage must never be the thing that blocks a business from
 * getting a usable storefront.
 */
export async function generatePagesWithFallback(
  ctx: TemplateGenerationContext,
): Promise<{ pages: StorefrontPageId[]; source: TemplateGenerationSourceKind }> {
  const provider = getTemplateGenerationProvider()
  try {
    return { pages: await provider.generatePages(ctx), source: provider.source }
  } catch (err) {
    console.error('[template-generation] page generation failed, using rules pages:', err)
    return { pages: await rulesProvider.generatePages(ctx), source: 'rules' }
  }
}
