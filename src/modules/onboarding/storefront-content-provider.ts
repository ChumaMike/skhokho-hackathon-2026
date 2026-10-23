import type { BusinessCategory } from '@prisma/client'
import { categoryLabel } from '@/lib/business-categories'
import { validateGeneratedContent, type StorefrontContent } from '@/modules/tenant/storefront-content'
import type { StorefrontVoiceTone } from '@/modules/tenant/storefront-theme'
import { externalAiEnabled } from '@/lib/ai/external-ai'
import { actorFrom, callModel, type AiMeta } from '@/lib/ai/anthropic'

/**
 * Storefront Content Generation Provider (Phase 2) — same two-provider
 * shape as template-generation-provider.ts (which this file sits directly
 * alongside): a deterministic rules provider by default, a real Claude call
 * when ANTHROPIC_API_KEY is set. No SDK — the Messages API is one fetch,
 * same house style as every other provider in this codebase.
 *
 * The model's ONLY job is filling in StorefrontContent's three small,
 * closed fields (hero headline/subheadline, about body, up to 4
 * highlights) — it never generates markup, never invents a page type, and
 * — critically — can never express a fabricated stat even if it tried,
 * because the schema itself has no field for one (see storefront-
 * content.ts's own doc comment). Every response is re-validated with
 * validateGeneratedContent before ever reaching an owner's review screen,
 * same discipline template-generation-provider.ts already applies to page
 * lists via validateGeneratedPages.
 */

export interface ContentGenerationContext {
  businessName: string
  category: BusinessCategory
  /** Accounting only — never placed in the prompt. */
  meta?: AiMeta
  /** BusinessProfile.brief, if the onboarding interview produced one — optional, same as template-generation-provider.ts. */
  brief?: string | null
  /** Same shape/provenance as TemplateGenerationContext.catalogueSummary — reused, not duplicated. */
  catalogueSummary?: { productCount: number; serviceCount: number; sampleNames: string[] }
  /** StorefrontProfile.voiceTone, if the owner picked one in the Design Wizard — previously captured and never read anywhere (confirmed: storefront-theme.ts's own doc comment called it "never read by any copy-rendering code"). Only the model path uses it; the rules path has no voice to apply a tone to. */
  voiceTone?: StorefrontVoiceTone
  /** StorefrontProfile.differentiator, if the owner wrote one — same previously-dead-field story as voiceTone. Real, owner-authored grounding (same trust level as `brief`), never a model invention. */
  differentiator?: string
}

export type ContentGenerationSourceKind = 'rules' | 'model'

export interface ContentGenerationProvider {
  readonly source: ContentGenerationSourceKind
  generateContent(ctx: ContentGenerationContext): Promise<StorefrontContent>
}

/**
 * Deliberately conservative: only ever states what's structurally true
 * (the business's name, category, and real catalogue counts if any) —
 * never a marketing claim, since nothing in `ctx` gives the rules path
 * grounds to invent one. hero/highlights stay empty rather than guess;
 * about.body is the one field where "a plain factual sentence" is safely
 * constructable without a model. This still makes the feature usable with
 * zero API key, same as template-generation-provider.ts's rules path.
 */
function buildRulesContent(ctx: ContentGenerationContext): StorefrontContent {
  const catalogue = ctx.catalogueSummary
  const catalogueClause =
    catalogue && (catalogue.productCount > 0 || catalogue.serviceCount > 0)
      ? ` Browse ${catalogue.productCount} product(s) and ${catalogue.serviceCount} service(s) below.`
      : ''
  return {
    version: 1,
    hero: {},
    about: { body: `${ctx.businessName} is a ${categoryLabel(ctx.category).toLowerCase()} business.${catalogueClause}` },
    highlights: { items: [] },
    process: [],
  }
}

const rulesProvider: ContentGenerationProvider = {
  source: 'rules',
  async generateContent(ctx) {
    return buildRulesContent(ctx)
  },
}

/** User-facing labels the Design Wizard itself already uses (StorefrontDesignWizard.tsx's VOICE_OPTIONS) — mirrored here rather than imported, since that array lives in a client component. */
const VOICE_TONE_INSTRUCTIONS: Record<StorefrontVoiceTone, string> = {
  FRIENDLY: 'a warm, friendly voice',
  PROFESSIONAL: 'a professional, polished voice',
  PLAYFUL: 'a playful, energetic voice',
  DIRECT: 'a direct, no-fuss voice',
}

/** Exported for direct unit testing, same reasoning as template-generation-provider.ts's buildSystemPrompt. */
export function buildSystemPrompt(ctx: ContentGenerationContext): string {
  const catalogue = ctx.catalogueSummary
  const catalogueLine =
    catalogue && (catalogue.productCount > 0 || catalogue.serviceCount > 0)
      ? `This business currently has ${catalogue.productCount} product(s) and ${catalogue.serviceCount} service(s) listed` +
        (catalogue.sampleNames.length > 0 ? `, including: ${catalogue.sampleNames.join(', ')}.` : '.')
      : `No catalogue data is available yet — this may be a brand-new business.`

  return [
    `You are writing real, honest website copy for a small business, for Skhokho, a South African platform that builds storefront websites for small businesses.`,
    ``,
    `Business name: ${ctx.businessName}`,
    `Category: ${categoryLabel(ctx.category)}`,
    ctx.brief ? `Business brief (from the owner's own onboarding interview):\n${ctx.brief}` : `No further brief is available — write from the name, category, and catalogue alone.`,
    catalogueLine,
    ctx.voiceTone ? `Write in ${VOICE_TONE_INSTRUCTIONS[ctx.voiceTone]} — the owner chose this tone for their storefront.` : null,
    ctx.differentiator ? `The owner told us what makes their business different, in their own words: "${ctx.differentiator}" — treat this as real, grounded context, not a suggestion to embellish.` : null,
    ``,
    `CRITICAL RULE: never invent a fact. Do not state a customer count, a founding date, an award, a number of years in business, or any claim not directly supported by the information above. If you have nothing grounded to say for a field, leave it out rather than guess — an honest gap is always better than a plausible-sounding invention. This is non-negotiable.`,
    ``,
    `Write:`,
    `- hero.headline: an optional short, punchy line (under 80 characters) that could sit above the business name. Omit if you have nothing grounded to say.`,
    `- hero.subheadline: an optional one-sentence line (under 160 characters) expanding on the headline.`,
    `- about.body: a real, multi-sentence paragraph (under 600 characters) telling customers who this business is and what they offer, grounded only in the information above.`,
    `- highlights.items: zero to 4 short, real differentiators (each under 80 characters) — only things actually supported by the brief or catalogue above (e.g. a real specialty, a real service offered). Never a fabricated stat.`,
    ``,
    `Reply with ONLY a JSON object, no other text, in exactly this shape (omit any field you have nothing grounded to write):`,
    `{"hero": {"headline": "...", "subheadline": "..."}, "about": {"body": "..."}, "highlights": {"items": ["...", "..."]}}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

/** Strips a markdown code fence if the model wrapped its JSON in one — same as template-generation-provider.ts. */
function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  return fenced ? fenced[1] : text
}

const anthropicProvider: ContentGenerationProvider = {
  source: 'model',
  async generateContent(ctx) {
    // Short timeout: this runs inside a server action the wizard is waiting on synchronously.
    const result = await callModel({
      feature: 'ai_business_buddy',
      capability: 'storefront.wizard_content',
      businessId: ctx.meta?.businessId ?? null,
      actor: actorFrom(ctx.meta),
      model: process.env.ANTHROPIC_CONTENT_GENERATION_MODEL || undefined,
      maxTokens: 500,
      timeoutMs: 8_000,
      system: buildSystemPrompt(ctx),
      messages: [{ role: 'user', content: 'Write the storefront content now.' }],
    })
    if (!result.text) throw new Error('Content generation request returned no text')
    const parsed: unknown = JSON.parse(stripCodeFence(result.text))
    const content = validateGeneratedContent(parsed)
    if (!content) throw new Error('Model returned an unparseable/empty content blob')
    return content
  },
}

export function getContentGenerationProvider(): ContentGenerationProvider {
  return externalAiEnabled() ? anthropicProvider : rulesProvider
}

/**
 * Generates storefront content, falling back to the rules provider if the
 * live call fails, times out, or returns something that doesn't validate —
 * same contract as template-generation-provider.ts's generatePagesWithFallback.
 * A model outage must never block an owner from getting usable content.
 */
export async function generateContentWithFallback(
  ctx: ContentGenerationContext,
): Promise<{ content: StorefrontContent; source: ContentGenerationSourceKind }> {
  const provider = getContentGenerationProvider()
  try {
    return { content: await provider.generateContent(ctx), source: provider.source }
  } catch (err) {
    console.error('[content-generation] content generation failed, using rules content:', err)
    return { content: await rulesProvider.generateContent(ctx), source: 'rules' }
  }
}
