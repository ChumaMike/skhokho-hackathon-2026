/**
 * Business Category Classifier — Phase 4 of the post-release upgrade plan.
 *
 * Same shape as src/modules/assistant/llm-provider.ts's provider pair: a
 * free rules-based classifier (default) and a real Claude call, selected
 * purely by whether ANTHROPIC_API_KEY is set. No SDK dependency — same
 * bare fetch() to the Messages API. Swapping from rules to live is an env
 * var, not a code change.
 *
 * Purpose: `/join` already has a required category dropdown (all 12
 * BusinessCategory values) plus an optional free-text "What do you do?"
 * field that today is stored on Business.description and never inspected
 * (confirmed by grep across the codebase before writing this). When an
 * owner picks "Something else" (OTHER) and types a description, this
 * module suggests a real category from that text — fixing the reported
 * bug where an "Other" business typed as food never got Menu terminology
 * or Food capabilities, because nothing ever looked at what they typed.
 *
 * SAFETY: this runs on the business-registration path. A classification
 * failure (network error, bad key, malformed response, rate limit) must
 * NEVER block signup — every call site must treat a null result exactly
 * like "stay OTHER", never surface an error to the owner.
 */

import type { BusinessCategory } from '@prisma/client'
import { externalAiEnabled } from '@/lib/ai/external-ai'
import { callModel } from '@/lib/ai/anthropic'

export type ClassificationSource = 'rules' | 'model'

export interface CategoryClassification {
  category: BusinessCategory
  source: ClassificationSource
}

export interface CategoryClassifier {
  readonly source: ClassificationSource
  classify(description: string): Promise<BusinessCategory | null>
}

/** The 12 real enum values (prisma/schema.prisma) — never return anything else. */
const VALID_CATEGORIES: readonly BusinessCategory[] = [
  'SALON', 'FOOD_VENDOR', 'CAR_WASH', 'RETAIL_STORE', 'TUCK_SHOP', 'MECHANIC',
  'HAIR_BRAIDER', 'NAIL_TECHNICIAN', 'EVENTS', 'CHILDCARE', 'LAUNDRY', 'OTHER',
]

/**
 * Checked in this order deliberately — narrower/more specific categories
 * before the broader ones they could otherwise be swallowed by (e.g.
 * HAIR_BRAIDER and NAIL_TECHNICIAN before the general SALON catch-all;
 * MECHANIC/CAR_WASH before RETAIL_STORE's generic "shop"/"sell" terms).
 * This is the free fallback used when ANTHROPIC_API_KEY isn't set — good
 * enough to beat staying OTHER, not trying to be perfect; the model
 * provider below is the accurate path.
 */
const KEYWORD_RULES: readonly [RegExp, BusinessCategory][] = [
  [/\b(mechanic|panel\s?beat|gearbox|engine\s?repair|tyre|tire|auto\s?electric|car\s?repair|workshop)\b/i, 'MECHANIC'],
  [/\b(car\s?wash|valet|car\s?detail)/i, 'CAR_WASH'],
  [/\b(braid|braiding|cornrow|weave|dreadlock|loc(s)?\b)/i, 'HAIR_BRAIDER'],
  [/\b(nail(s)?|manicure|pedicure|acrylic|gel\s?nail)/i, 'NAIL_TECHNICIAN'],
  [/\b(salon|hairdress|hair\s?styl|relax(er)?|blow\s?dry|barber)/i, 'SALON'],
  [/\b(kota|shisanyama|braai|takeaway|take-away|restaurant|kitchen|catering|caterer|bakery|bake(r|s)?\b|chef|cook(ing)?|meal(s)?\b|food)/i, 'FOOD_VENDOR'],
  [/\b(spaza|tuck\s?shop|convenience\s?store|airtime|snack(s)?\b)/i, 'TUCK_SHOP'],
  [/\b(laundry|laundromat|dry\s?clean|ironing|wash\s?and\s?fold|washing\s?service)/i, 'LAUNDRY'],
  [/\b(creche|crèche|daycare|day\s?care|babysit|aftercare|nanny)/i, 'CHILDCARE'],
  [/\b(event(s)?\b|party\s?plan|wedding\s?plan|decor|mc\s?hire|dj\s?hire)/i, 'EVENTS'],
  [/\b(shop|store|boutique|retail|sell(ing)?\b|clothing|goods)/i, 'RETAIL_STORE'],
]

const rulesBasedClassifier: CategoryClassifier = {
  source: 'rules',
  async classify(description) {
    for (const [pattern, category] of KEYWORD_RULES) {
      if (pattern.test(description)) return category
    }
    return null
  },
}

function buildClassifierPrompt(description: string): string {
  return [
    `Classify this South African small business into exactly ONE of these categories, based on the owner's own description of what they do:`,
    VALID_CATEGORIES.filter((c) => c !== 'OTHER').join(', '),
    ``,
    `Owner's description: "${description}"`,
    ``,
    `Reply with ONLY the single matching category name from the list above, in uppercase, nothing else. If genuinely nothing fits, reply OTHER.`,
  ].join('\n')
}

const anthropicClassifier: CategoryClassifier = {
  source: 'model',
  async classify(description) {
    // No business exists yet: platform-internal (unmetered) call, recorded without a business id.
    const result = await callModel({
      feature: 'ai_business_buddy',
      capability: 'signup.classify',
      businessId: null,
      actor: { type: 'SYSTEM' },
      metered: false,
      model: process.env.ANTHROPIC_ASSISTANT_MODEL || undefined,
      maxTokens: 20,
      system: 'You classify South African small businesses into one category.',
      messages: [{ role: 'user', content: buildClassifierPrompt(description) }],
    })
    const raw = result.text.trim().toUpperCase()
    if (!raw) throw new Error('Unexpected classifier response shape')

    // Strict allowlist match — never trust the model to have returned a
    // real enum value verbatim; anything else resolves to null (§ safety
    // note above: unclassifiable must behave exactly like "stay OTHER").
    const match = VALID_CATEGORIES.find((c) => c === raw)
    return match ?? null
  },
}

export function getCategoryClassifier(): CategoryClassifier {
  return externalAiEnabled() ? anthropicClassifier : rulesBasedClassifier
}

/**
 * The one entry point callers should use — wraps classification in a
 * try/catch so a network error, bad key, or malformed response can NEVER
 * throw into a caller on the registration path. Returns null (never
 * throws) on any failure; callers should treat null exactly like "no
 * suggestion available, leave the category as the owner picked it."
 */
export async function classifyBusinessCategory(description: string): Promise<CategoryClassification | null> {
  const trimmed = description.trim()
  if (!trimmed) return null

  const classifier = getCategoryClassifier()
  try {
    const category = await classifier.classify(trimmed)
    if (!category || category === 'OTHER') return null
    return { category, source: classifier.source }
  } catch (e) {
    console.error('[category-classifier] classification failed, leaving category unchanged:', e instanceof Error ? e.message : e)
    return null
  }
}
