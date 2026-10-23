/**
 * Assistant Provider
 *
 * Two providers behind one interface: a rules-based provider (default) and
 * a real Claude call, selected purely by whether ANTHROPIC_API_KEY is set.
 * No SDK dependency — the Anthropic Messages API is a single fetch, and this
 * only ever sends one short message per question, so pulling in the full SDK
 * isn't worth the bundle weight. Swapping from stub to live is an env var,
 * not a code change.
 */

import { externalAiEnabled } from '@/lib/ai/external-ai'
import { callModel, type ModelTool } from '@/lib/ai/anthropic'

export interface AssistantContext {
  businessName: string
  /** Accounting only — never placed in the prompt. */
  businessId?: string
  actorStaffId?: string
  /**
   * Each area is present only when the asking person's role may see it
   * (assistant.service builds this from their permissions). A missing area
   * is answered with "your role doesn't include that", never guessed at.
   */
  customers?: {
    total: number
    regulars: { name: string; stamps: number }[]
    lapsed: { name: string; lastSeen: Date }[]
  }
  ordersThisWeek?: { count: number; total: string }
  upcomingAppointments?: { customerName: string; serviceName: string; startTime: Date }[]
  /** Today's briefing lines (already permission-scoped). */
  briefing: string[]
  /**
   * Cash-flow forecast: the next four weeks, already turned into sentences by
   * `@/modules/analytics/forecast-advice`. Present only when the asking person
   * may view analytics AND the plan includes the sales overview. Business
   * figures only — no customer appears in it.
   */
  forecast?: { nextWeek: string; fourWeeks: string; lines: string[] }
}

export const NOT_IN_ROLE = (what: string) => `Your role doesn't include ${what} — ask the business owner if you need it.`

/**
 * A forecast needs the plan (sales overview) AND the permission, so one answer
 * covers both rather than guessing which is missing and telling someone
 * something untrue about their own account.
 */
export const NO_FORECAST =
  "I can't work out a forecast for you — that needs the sales overview on your plan and permission to view analytics. The business owner can check both."

export type AssistantSource = 'rules' | 'model'

export interface AssistantProvider {
  readonly source: AssistantSource
  answer(question: string, context: AssistantContext): Promise<string>
}

function formatWhen(d: Date): string {
  return d.toLocaleString('en-ZA', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * Pattern-matches the question against the things it can actually
 * answer, using the real data gathered by assistant.service — never a
 * generic "I can help with that!" placeholder. Honest about what it is: a
 * fallback names itself as a preview rather than pretending to understand
 * an unmatched question, matching this app's existing rule against claiming
 * capabilities that aren't real (see StatsSection, ComparisonSection).
 */
export const ruleBasedProvider: AssistantProvider = {
  source: 'rules',
  async answer(question, ctx) {
    const q = question.toLowerCase()

    // Cash-flow forecast. This sits FIRST on purpose: the briefing case below
    // matches a bare "next", so "what does next week look like?" would never
    // reach a forecast case appended at the end. The pattern is narrow enough
    // ("next week", not "next") to leave the other cases exactly as they were.
    if (/forecast|cash.?flow|next (week|month|four weeks)|coming (weeks|month)|predict|how much will|busiest day|slow(est)? days?/.test(q)) {
      const f = ctx.forecast
      if (!f) return NO_FORECAST
      return f.lines.join(' ')
    }

    if (/attention|today|next|should i|what.?s (up|happening)|briefing|summary|how are we/.test(q)) {
      return ctx.briefing.length > 0 ? ctx.briefing.join(' ') : `Nothing needs you right now.`
    }

    if (/lapsed|slipping|stopped|haven.?t (been|come)|not (seen|come)|missing|gone quiet/.test(q)) {
      const c = ctx.customers
      if (!c) return NOT_IN_ROLE('customer details')
      if (c.total === 0) {
        return `You don't have any customers yet — once someone's registered, I can tell you who's slipping.`
      }
      if (c.lapsed.length === 0) {
        return `Nobody's lapsed right now — everyone on your customer list has been in within the last 30 days.`
      }
      const shown = c.lapsed.slice(0, 5).map((m) => m.name).join(', ')
      const rest = c.lapsed.length > 5 ? `, and ${c.lapsed.length - 5} more` : ''
      return `${c.lapsed.length} customer${c.lapsed.length === 1 ? '' : 's'} haven't been in for 30+ days: ${shown}${rest}.`
    }

    if (/regular|loyal|best|top|favou?rite/.test(q)) {
      const c = ctx.customers
      if (!c) return NOT_IN_ROLE('customer details')
      if (c.regulars.length === 0) {
        return `No customers with stamps yet — give your first one to get this started.`
      }
      const list = c.regulars.map((m) => `${m.name} (${m.stamps} stamps)`).join(', ')
      return `Your top regulars by stamps: ${list}.`
    }

    if (/order|sale|sold|revenue|money|takings|earn/.test(q)) {
      const o = ctx.ordersThisWeek
      if (!o) return NOT_IN_ROLE('orders and sales')
      return `This week: ${o.count} order${o.count === 1 ? '' : 's'}, totalling ${o.total}.`
    }

    if (/appointment|booking|upcoming|schedule|calendar/.test(q)) {
      const a = ctx.upcomingAppointments
      if (!a) return NOT_IN_ROLE('bookings')
      if (a.length === 0) {
        return `Nothing booked right now.`
      }
      const list = a
        .slice(0, 5)
        .map((x) => `${x.customerName} — ${x.serviceName} (${formatWhen(x.startTime)})`)
        .join('; ')
      return `Coming up: ${list}.`
    }

    return `I can tell you what needs attention today${ctx.customers ? ', who your regulars are and who has lapsed' : ''}${ctx.ordersThisWeek ? ", this week's orders" : ''}${ctx.forecast ? ' and what the next four weeks look like' : ''}${ctx.upcomingAppointments ? ' and upcoming bookings' : ''} — try asking one of those. (Answered from your own data by built-in rules — no outside AI service sees it.)`
  },
}

export function buildAssistantSystemPrompt(ctx: AssistantContext): string {
  const withheld = [
    ctx.customers ? null : 'customer details',
    ctx.ordersThisWeek ? null : 'orders and sales',
    ctx.upcomingAppointments ? null : 'bookings',
  ].filter(Boolean)
  return [
    `You are Ask Skhokho, the assistant inside the Skhokho dashboard for ${ctx.businessName}, a South African small business.`,
    `Answer only using the data below. Be concise, plain warm South African English, no jargon. If the data doesn't answer the question, say so honestly instead of guessing.`,
    `You cannot change anything yourself and must never say you have. If the person asks for marketing content, a campaign or product wording, use the matching tool when one is offered; otherwise say it is done from Content & Marketing. Suggested changes always appear for the person to preview and apply — they decide.`,
    withheld.length
      ? `This team member's role does not include: ${withheld.join(', ')}. If asked about those, say their role doesn't include it and suggest asking the business owner. Never guess or estimate them.`
      : null,
    ``,
    `Today: ${ctx.briefing.join(' ') || 'nothing needs attention.'}`,
    ctx.customers ? `Total customers: ${ctx.customers.total}` : null,
    ctx.customers ? `Top regulars by stamps: ${ctx.customers.regulars.map((m) => `${m.name} (${m.stamps})`).join(', ') || 'none yet'}` : null,
    ctx.customers ? `Lapsed 30+ days: ${ctx.customers.lapsed.map((m) => m.name).join(', ') || 'none'}` : null,
    ctx.ordersThisWeek ? `This week's orders: ${ctx.ordersThisWeek.count}, totalling ${ctx.ordersThisWeek.total}` : null,
    // The forecast is already worked out and worded by the rules path; the
    // model may repeat it but must never produce a different number.
    ctx.forecast
      ? `Cash-flow forecast (worked out from this business's own paid orders — quote these figures, never your own): next week about ${ctx.forecast.nextWeek}, the next four weeks about ${ctx.forecast.fourWeeks}. ${ctx.forecast.lines.join(' ')}`
      : null,
    ctx.upcomingAppointments
      ? `Upcoming bookings: ${ctx.upcomingAppointments.map((a) => `${a.customerName} — ${a.serviceName} (${formatWhen(a.startTime)})`).join('; ') || 'none'}`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

/**
 * Data minimisation for the external model (B10): customer names never leave
 * the server. Each one is replaced by a neutral label ("Customer 1") in the
 * context AND in the question, and the labels are swapped back locally in
 * the answer. Business data (the business's own name, counts, totals) is
 * sent as-is.
 */
export function pseudonymiseForModel(question: string, ctx: AssistantContext) {
  const labels = new Map<string, string>()
  const label = (name: string) => {
    const key = name.trim()
    if (!key) return name
    if (!labels.has(key)) labels.set(key, `Customer ${labels.size + 1}`)
    return labels.get(key)!
  }
  const safeCtx: AssistantContext = {
    ...ctx,
    customers: ctx.customers && {
      total: ctx.customers.total,
      regulars: ctx.customers.regulars.map((m) => ({ ...m, name: label(m.name) })),
      lapsed: ctx.customers.lapsed.map((m) => ({ ...m, name: label(m.name) })),
    },
    upcomingAppointments: ctx.upcomingAppointments?.map((a) => ({ ...a, customerName: label(a.customerName) })),
  }
  // Longest names first, so "Thandi M" is replaced before "Thandi".
  const known = [...labels.entries()].sort((a, b) => b[0].length - a[0].length)
  let safeQuestion = question
  for (const [name, tag] of known) safeQuestion = safeQuestion.split(name).join(tag)
  const restore = (text: string) => {
    let out = text
    // Highest numbers first, so "Customer 12" is restored before "Customer 1".
    for (const [name, tag] of [...labels.entries()].sort((a, b) => b[1].length - a[1].length || b[1].localeCompare(a[1]))) {
      out = out.split(tag).join(name)
    }
    return out
  }
  return { question: safeQuestion, ctx: safeCtx, restore }
}

/**
 * Whether the Business Buddy may use the external model at all. OFF unless
 * explicitly enabled (BUDDY_EXTERNAL_AI=enabled) AND a key is configured —
 * until the legal/POPIA boundary for cross-border AI processing is approved,
 * the buddy answers from local rules only.
 */
export function externalAssistantEnabled(): boolean {
  return externalAiEnabled()
}

const anthropicProvider: AssistantProvider = {
  source: 'model',
  async answer(rawQuestion, rawCtx) {
    const { question, ctx, restore } = pseudonymiseForModel(rawQuestion, rawCtx)
    // Every external call goes through the accounted wrapper (gate, plan, allowance, rate limit, usage row).
    const result = await callModel({
      feature: 'ai_business_buddy',
      capability: 'assistant.chat',
      businessId: rawCtx.businessId ?? null,
      actor: rawCtx.actorStaffId ? { type: 'STAFF', id: rawCtx.actorStaffId } : { type: 'SYSTEM' },
      model: process.env.ANTHROPIC_ASSISTANT_MODEL || undefined,
      maxTokens: 400,
      system: buildAssistantSystemPrompt(ctx),
      messages: [{ role: 'user', content: question }],
    })
    if (!result.text) throw new Error('Unexpected assistant response shape')
    return restore(result.text)
  },
}

/**
 * The model answer with tools on offer. Returns either text or the tool the
 * model asked for — the CALLER decides whether that tool may run (tools.ts);
 * nothing here executes anything.
 */
export async function answerWithTools(
  rawQuestion: string,
  rawCtx: AssistantContext,
  tools: ModelTool[],
): Promise<{ text: string; toolUse: { name: string; input: unknown } | null }> {
  const { question, ctx, restore } = pseudonymiseForModel(rawQuestion, rawCtx)
  const result = await callModel({
    feature: 'ai_business_buddy',
    capability: 'assistant.chat',
    businessId: rawCtx.businessId ?? null,
    actor: rawCtx.actorStaffId ? { type: 'STAFF', id: rawCtx.actorStaffId } : { type: 'SYSTEM' },
    model: process.env.ANTHROPIC_ASSISTANT_MODEL || undefined,
    maxTokens: 500,
    system: buildAssistantSystemPrompt(ctx),
    messages: [{ role: 'user', content: question }],
    tools,
  })
  const toolUse = result.toolUses[0] ? { name: result.toolUses[0].name, input: result.toolUses[0].input } : null
  return { text: restore(result.text), toolUse }
}

export function getAssistantProvider(): AssistantProvider {
  return externalAssistantEnabled() ? anthropicProvider : ruleBasedProvider
}

/**
 * Answers, falling back to the rules provider if the live call fails.
 *
 * Provider selection above keys off the *presence* of ANTHROPIC_API_KEY, not
 * its validity — so a revoked, expired or mistyped key doesn't quietly
 * degrade this feature, it breaks it: the 401 propagates out of the route
 * and the owner gets an error where they previously got a useful
 * rules-based answer. Falling back restores the pre-key behaviour for every
 * failure mode of the call (bad key, rate limit, outage, timeout).
 *
 * This stays honest rather than pretending a model answered: the returned
 * `source` is what actually produced the text, and AssistantChat already
 * badges a 'rules' answer as rules-based, so a fallback answer is labelled
 * exactly like any other rules answer.
 */
export async function answerWithFallback(
  question: string,
  context: AssistantContext,
): Promise<{ text: string; source: AssistantSource }> {
  const provider = getAssistantProvider()
  try {
    return { text: await provider.answer(question, context), source: provider.source }
  } catch (err) {
    console.error('[assistant] live provider failed, using rules answer:', err)
    return { text: await ruleBasedProvider.answer(question, context), source: ruleBasedProvider.source }
  }
}
