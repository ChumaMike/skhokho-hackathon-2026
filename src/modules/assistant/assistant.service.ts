/**
 * Assistant Service (read-only)
 *
 * Answers a team member's question from THEIR view of the business: each
 * area is read only when their role could see it on the dashboard anyway
 * (the same permission the matching page checks), so the buddy can never
 * tell kitchen staff what only the owner may see. Customer data comes
 * through the existing pairwise-safe MemberRow shape (display_name /
 * short_code — never a raw phone or global customer id). No writes: this
 * only ever reads, whichever provider answers.
 */

import { actorCan, type StaffActor } from '@/lib/auth/guards'
import { getRegulars, getLapsed, listMembers } from '@/modules/customers/customer.service'
import { listOrders } from '@/modules/orders/order.service'
import { listUpcomingAppointments } from '@/modules/appointments/appointment.service'
import { formatZAR } from '@/lib/utils'
import { answerWithFallback, answerWithTools, externalAssistantEnabled, ruleBasedProvider, type AssistantContext, type AssistantSource } from './llm-provider'
import { getBusinessEntitlements } from '@/modules/billing/subscription.service'
import { hasFeature } from '@/modules/billing/entitlements'
import { detectContentIntent, runTool, toolDefinitions, ToolRefusedError } from './tools'
import { AiCallError } from '@/lib/ai/anthropic'
import { gatherBuddySnapshot } from './buddy-snapshot'
import { buildBriefing } from './briefing'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** The context one person may be answered from. Exported for tests. */
export async function buildAssistantContext(actor: StaffActor, now: Date = new Date()): Promise<AssistantContext> {
  const businessId = actor.tenantId
  const canCustomers = actorCan(actor, ['canManageCustomers', 'canIssueLoyalty'])
  const canOrders = actorCan(actor, 'canManageOrders')
  const canBookings = actorCan(actor, ['canReadBookings', 'canManageBookings'])

  const [snapshot, members, regulars, lapsed, orders, upcoming] = await Promise.all([
    gatherBuddySnapshot(actor, now),
    canCustomers ? listMembers(businessId, { limit: 500 }) : null,
    canCustomers ? getRegulars(businessId, 5) : null,
    canCustomers ? getLapsed(businessId, 30) : null,
    canOrders ? listOrders(businessId, { dateFrom: new Date(now.getTime() - WEEK_MS), perPage: 100 }) : null,
    canBookings ? listUpcomingAppointments(businessId, { limit: 10 }) : null,
  ])

  const briefing = buildBriefing(snapshot, actor)
  return {
    businessName: snapshot.businessName,
    businessId,
    actorStaffId: actor.staffId,
    briefing: [...briefing.attention, ...briefing.highlights].map((l) => l.text),
    customers:
      members && regulars && lapsed
        ? {
            total: members.length,
            regulars: regulars.map((m) => ({ name: m.display_name ?? m.short_code, stamps: m.stamps })),
            lapsed: lapsed.map((m) => ({ name: m.display_name ?? m.short_code, lastSeen: m.last_seen })),
          }
        : undefined,
    ordersThisWeek: orders
      ? { count: orders.total, total: formatZAR(orders.orders.reduce((sum, o) => sum + Number(o.total), 0)) }
      : undefined,
    upcomingAppointments: upcoming
      ? upcoming.map((a) => ({
          customerName: a.membership?.displayName ?? a.membership?.shortCode ?? 'a customer',
          serviceName: a.service?.name ?? 'a service',
          startTime: a.startTime,
        }))
      : undefined,
  }
}

export interface AssistantAnswer {
  text: string
  source: AssistantSource | 'tool'
  href?: string
}

/**
 * One assistant, many internal capabilities. A clear content request is
 * routed to a tool by rules (works without any external model); otherwise
 * the model answers and may REQUEST a tool, which only runs if tools.ts
 * allows it for this person and plan. Everything else is the read-only
 * answer path. A refused tool is explained, never silently dropped.
 */
export async function askAssistant(actor: StaffActor, question: string, now: Date = new Date()): Promise<AssistantAnswer> {
  const entitlements = await getBusinessEntitlements(actor.tenantId, now)
  const offerTools = actorCan(actor, 'canManageContent') && hasFeature(entitlements, 'content_studio')

  const intent = offerTools ? detectContentIntent(question) : null
  if (intent) {
    try {
      const r = await runTool(actor, entitlements, intent.name, intent.input, now)
      return { text: r.reply, source: 'tool', href: r.href }
    } catch (e) {
      if (e instanceof ToolRefusedError || e instanceof AiCallError) return { text: e.message, source: 'tool' }
      throw e
    }
  }

  const context = await buildAssistantContext(actor, now)
  if (offerTools && externalAssistantEnabled()) {
    try {
      const { text, toolUse } = await answerWithTools(question, context, toolDefinitions())
      if (toolUse) {
        try {
          const r = await runTool(actor, entitlements, toolUse.name, toolUse.input, now)
          return { text: [text, r.reply].filter(Boolean).join('\n\n'), source: 'tool', href: r.href }
        } catch (e) {
          if (e instanceof ToolRefusedError || e instanceof AiCallError) return { text: [text, e.message].filter(Boolean).join('\n\n'), source: 'tool' }
          throw e
        }
      }
      if (text) return { text, source: 'model' }
    } catch (err) {
      console.error('[assistant] live provider failed, using rules answer:', err instanceof Error ? err.name : err)
    }
    return { text: await ruleBasedProvider.answer(question, context), source: 'rules' }
  }
  return answerWithFallback(question, context)
}
