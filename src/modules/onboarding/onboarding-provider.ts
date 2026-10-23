import type { BusinessCategory } from '@prisma/client'
import { categoryLabel } from '@/lib/business-categories'
import { QUESTIONS, answerText, type Answers } from './questions'
import { externalAiEnabled } from '@/lib/ai/external-ai'
import { actorFrom, callModel, type AiMeta } from '@/lib/ai/anthropic'

/**
 * Onboarding Provider
 *
 * Same two-provider shape as the dashboard assistant (see
 * modules/assistant/llm-provider.ts): a deterministic rules provider by
 * default, a real Claude call when ANTHROPIC_API_KEY is set, chosen by env
 * var rather than by a code change. No SDK — the Messages API is one fetch.
 *
 * The rules provider is NOT a placeholder. The brief it writes is the real
 * product of the owner's answers, and the page plan it derives is the same
 * plan the live model is asked to work from. A business that onboards
 * without a key set still gets a usable storefront brief; the model makes it
 * read better and catches nuance in their free text — it doesn't supply the
 * substance from nothing.
 */

export interface BriefContext {
  businessName: string
  category: BusinessCategory
  answers: Answers
  /** Accounting only — never placed in the prompt. */
  meta?: AiMeta
}

export type BriefSourceKind = 'rules' | 'model'

export interface OnboardingProvider {
  readonly source: BriefSourceKind
  writeBrief(ctx: BriefContext): Promise<string>
}

/** A storefront page we'd build, and the answer that justified it. */
export interface PlannedPage {
  page: string
  because: string
}

/**
 * Derives the page plan from the answers. Deliberately rules-based even when
 * a model is available: which pages exist is a product decision with real
 * consequences (an "Order online" page we can't actually fulfil is worse
 * than no page), so it stays deterministic and reviewable. The model is
 * asked to write *around* this plan, never to invent it.
 */
export function planPages(answers: Answers): PlannedPage[] {
  const goals = answerText(answers, 'goal').toLowerCase()
  const where = answerText(answers, 'where').toLowerCase()
  const reach = answerText(answers, 'ordering').toLowerCase()

  const pages: PlannedPage[] = [
    { page: 'Home', because: 'Every storefront needs a front door that says who you are.' },
  ]

  if (goals.includes('prices') || goals.includes('orders')) {
    pages.push({ page: 'What we sell (with prices)', because: 'You said showing prices matters.' })
  }
  if (goals.includes('take orders')) {
    pages.push({ page: 'Order online', because: 'You want the site to take orders for you.' })
  }
  if (goals.includes('take bookings')) {
    pages.push({ page: 'Book a time', because: 'You want the site to take bookings.' })
  }
  if (where.includes('shop') || where.includes('salon') || goals.includes('where i am')) {
    pages.push({
      page: 'Find us',
      because: 'Customers come to you, so they need directions and hours.',
    })
  }
  if (where.includes('deliver') || where.includes('travel')) {
    pages.push({
      page: 'Delivery & areas we cover',
      because: 'You go to the customer, so the site must set that expectation.',
    })
  }
  if (goals.includes('professional') || goals.includes('outside my area')) {
    pages.push({
      page: 'About / our work',
      because: 'You want to look established to someone who has never met you.',
    })
  }
  if (goals.includes('customer list')) {
    pages.push({ page: 'Join our list', because: 'You want to build a customer list you own.' })
  }
  if (reach.includes('whatsapp')) {
    pages.push({
      page: 'WhatsApp button on every page',
      because: 'WhatsApp is already how your customers reach you.',
    })
  }

  return pages
}

function answeredLines(answers: Answers): string[] {
  return QUESTIONS.map((q) => {
    const a = answerText(answers, q.id)
    return a ? `- ${q.prompt} ${a}` : null
  }).filter((l): l is string => l !== null)
}

/**
 * Builds the brief from the answers alone — plain prose plus the page plan,
 * in the same warm South African English the rest of the product uses.
 */
function buildRulesBrief(ctx: BriefContext): string {
  const { businessName, category, answers } = ctx
  const sells = answerText(answers, 'sells')
  const where = answerText(answers, 'where')
  const reach = answerText(answers, 'ordering')
  const busy = answerText(answers, 'busy')
  const pain = answerText(answers, 'bottleneck')

  const out: string[] = []
  out.push(`## ${businessName}`)
  out.push('')
  out.push(
    `${businessName} is a ${categoryLabel(category).toLowerCase()} business` +
      (sells ? ` selling ${sells.toLowerCase()}` : '') +
      (where ? `, working like this: ${where.toLowerCase()}` : '') +
      '.',
  )
  if (reach) {
    out.push('')
    out.push(`Customers reach them today through ${reach.toLowerCase()}.`)
  }
  if (busy) {
    out.push('')
    out.push(`Busiest: ${busy.toLowerCase()}.`)
  }
  if (pain) {
    out.push('')
    out.push(`The parts of the job they want help with: ${pain.toLowerCase()}.`)
  }

  out.push('')
  out.push('### Pages to build')
  out.push('')
  for (const p of planPages(answers)) {
    out.push(`- ${p.page} — ${p.because}`)
  }

  out.push('')
  out.push('### Their answers')
  out.push('')
  out.push(...answeredLines(answers))

  return out.join('\n')
}

const rulesProvider: OnboardingProvider = {
  source: 'rules',
  async writeBrief(ctx) {
    return buildRulesBrief(ctx)
  },
}

function buildSystemPrompt(ctx: BriefContext): string {
  const plan = planPages(ctx.answers)
    .map((p) => `- ${p.page} (because: ${p.because})`)
    .join('\n')

  return [
    `You are writing an internal build brief for Skhokho, a South African platform that builds storefront websites for small businesses.`,
    `A shop owner has just answered a short onboarding interview. Turn their answers into a brief that another AI will use to generate their website.`,
    ``,
    `Business name: ${ctx.businessName}`,
    `Category: ${categoryLabel(ctx.category)}`,
    ``,
    `Their answers:`,
    ...answeredLines(ctx.answers),
    ``,
    `The page plan has already been decided — do not add, remove or rename pages:`,
    plan,
    ``,
    `Write markdown with exactly these sections, in this order:`,
    `## ${ctx.businessName}`,
    `(2-4 sentences describing the business in plain words, as a person would describe it out loud)`,
    `### What they sell`,
    `### How customers reach them`,
    `### What to solve for them`,
    `(tie this directly to the annoyances they named)`,
    `### Pages to build`,
    `(the plan above, each with one line on what goes on that page for THIS business)`,
    ``,
    `Rules: plain, warm South African English, no jargon, no marketing fluff. Use only what they told you — never invent products, prices, areas or opening hours. If something wasn't answered, leave it out rather than guessing. Currency is ZAR written as R 1 234.56.`,
  ].join('\n')
}

const anthropicProvider: OnboardingProvider = {
  source: 'model',
  async writeBrief(ctx) {
    const result = await callModel({
      feature: 'ai_business_buddy',
      capability: 'onboarding.brief',
      businessId: ctx.meta?.businessId ?? null,
      actor: actorFrom(ctx.meta),
      model: process.env.ANTHROPIC_ONBOARDING_MODEL || undefined,
      maxTokens: 1200,
      system: buildSystemPrompt(ctx),
      messages: [{ role: 'user', content: 'Write the brief now.' }],
    })
    if (!result.text) throw new Error('Brief request returned no text')
    return result.text
  },
}

export function getOnboardingProvider(): OnboardingProvider {
  return externalAiEnabled() ? anthropicProvider : rulesProvider
}

/**
 * Writes the brief, falling back to the rules provider if the live call fails
 * for any reason. The interview is the last step of a registration flow — a
 * model outage must never be the thing that blocks someone from finishing
 * onboarding, and the rules brief is good enough to build from.
 */
export async function writeBriefWithFallback(
  ctx: BriefContext,
): Promise<{ brief: string; source: BriefSourceKind }> {
  const provider = getOnboardingProvider()
  try {
    return { brief: await provider.writeBrief(ctx), source: provider.source }
  } catch (err) {
    console.error('[onboarding] brief generation failed, using rules brief:', err)
    return { brief: await rulesProvider.writeBrief(ctx), source: 'rules' }
  }
}
