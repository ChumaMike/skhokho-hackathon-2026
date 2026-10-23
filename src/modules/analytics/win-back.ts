/**
 * Win-back list — the customers whose own ordering rhythm says they are about
 * to stop coming, with something the owner can actually do about each one.
 *
 * Pure, like the forecast: it takes each customer's paid order dates and
 * returns the list, so the prediction is tested against fixtures and can be
 * explained on the page.
 *
 * The prediction is per customer, against their OWN pattern, not against one
 * rule for everybody. Someone who buys lunch every second day is slipping
 * after a week; someone who comes in monthly is not. A single business-wide
 * "30 days" cut-off (which is what `getLapsed` uses for the simpler customers
 * list) would flag the monthly customers who are perfectly fine and miss the
 * daily customers who have actually gone.
 *
 * Privacy: a customer is identified here by `memberships.public_id` and their
 * first name or short code. The global Skhokho id never appears, and a phone
 * number is used only where the customer themselves left a contact number on
 * a delivery order with this business — the one place a business is already
 * shown one (see `order_deliveries.contact_phone`).
 */

import { normalisePhone, isValidZaMobile } from '@/lib/za-phone'
import { formatCents, whatsappLink } from '@/lib/utils'

/** One customer's paid trading history with this business. */
export interface CustomerOrderHistory {
  /** `memberships.public_id` — the pairwise id this business may see. */
  publicId: string
  /** The short code the business uses out loud. */
  shortCode: string
  displayName: string | null
  /** Dates of paid orders, oldest first, ISO `YYYY-MM-DD`. */
  orderDates: readonly string[]
  /** What this customer has paid, in cents. */
  spentCents: number
  /**
   * Contact number from their most recent DELIVERY order, if they left one.
   * Null for every collection-only customer — which is most of them.
   */
  contactPhone: string | null
}

export type WinBackStatus = 'slipping' | 'overdue' | 'gone'

export interface WinBackCustomer {
  publicId: string
  shortCode: string
  /** First name, or the short code when the business never took a name. */
  name: string
  lastOrder: string
  daysSince: number
  /** Their own usual gap between orders; null when they have only ordered once. */
  typicalGapDays: number | null
  /** The gap this prediction was measured against (theirs, or the shop's). */
  measuredAgainstDays: number
  orders: number
  spentCents: number
  spentDisplay: string
  status: WinBackStatus
  /** What to do about them, in one sentence. */
  action: string
  /** Pre-filled WhatsApp message, or null when there is no number to use. */
  whatsappUrl: string | null
  /** Why there is no link, so an owner is not left wondering. */
  contactNote: string | null
}

export interface WinBackList {
  customers: WinBackCustomer[]
  counts: Record<WinBackStatus, number>
  /** What the flagged customers have spent here — what is at risk. */
  atRiskCents: number
  atRiskDisplay: string
  /** The shop's own median gap, used for customers who only ordered once. */
  businessGapDays: number | null
  /** Customers with a paid order who were looked at. */
  consideredCount: number
  /** How the list was worked out, for the page. */
  method: string[]
}

/**
 * Grace on a customer's own rhythm before they are called slipping. Someone
 * who orders every ten days is not slipping on day eleven.
 */
export const GRACE = 1.2

/** Beyond this multiple of their usual gap, a customer is overdue. */
export const OVERDUE_AT = 2

/** Beyond this multiple — or 90 days — treat them as gone, not slipping. */
export const GONE_AT = 4
export const GONE_DAYS = 90

/**
 * Nobody is flagged inside a week. A daily customer who missed two days is
 * not a win-back case, and a list that said so would be ignored within a day.
 *
 * This floor lifts the WHOLE scale for frequent customers, rather than only
 * the first band (see `thresholdsFor`). Applied as a bare minimum it would
 * make the slipping and overdue bands unreachable for anyone whose usual gap
 * is short: a customer who orders every second day would go from fine on day
 * six to gone on day eight, which is not a thing to say about someone who
 * might just have been away for a week.
 */
export const MIN_DAYS_SINCE = 7

/** When a customer has ordered once and the shop has no pattern either. */
export const FALLBACK_GAP_DAYS = 30

/** How many to show. A list longer than this is not worked through. */
export const DEFAULT_LIMIT = 20

const DAY_MS = 86_400_000

function utcDay(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime()
}

function daysBetween(fromIso: string, to: Date): number {
  const toMidnight = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.max(0, Math.round((toMidnight - utcDay(fromIso)) / DAY_MS))
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle]! : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
}

/** Days between consecutive paid orders, oldest first. */
export function orderGaps(orderDates: readonly string[]): number[] {
  const sorted = [...orderDates].sort()
  const gaps: number[] = []
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(Math.round((utcDay(sorted[i]!) - utcDay(sorted[i - 1]!)) / DAY_MS))
  }
  return gaps
}

/** First name only — the business already sees this name on its own orders. */
export function firstName(displayName: string | null, shortCode: string): string {
  const trimmed = (displayName ?? '').trim()
  if (!trimmed) return shortCode
  return trimmed.split(/\s+/)[0]!
}

/**
 * The three day-counts for one customer's usual gap. The slipping line is
 * their gap plus grace, never inside a week; the other two keep their
 * distance from it, so the bands stay in proportion however often this
 * customer orders. A daily customer is slipping at a week, overdue at about
 * twelve days and gone at about three weeks; a monthly customer is slipping at
 * thirty-six days and gone after ninety.
 */
export function thresholdsFor(gap: number): { slippingAt: number; overdueAt: number; goneAt: number } {
  const slippingAt = Math.max(MIN_DAYS_SINCE, gap * GRACE)
  return {
    slippingAt,
    overdueAt: slippingAt * (OVERDUE_AT / GRACE),
    goneAt: Math.min(GONE_DAYS, slippingAt * (GONE_AT / GRACE)),
  }
}

function statusOf(daysSince: number, gap: number): WinBackStatus | null {
  const { slippingAt, overdueAt, goneAt } = thresholdsFor(gap)
  if (daysSince >= goneAt || daysSince > GONE_DAYS) return 'gone'
  if (daysSince >= overdueAt) return 'overdue'
  if (daysSince >= slippingAt) return 'slipping'
  return null
}

function actionFor(customer: {
  status: WinBackStatus
  daysSince: number
  typicalGapDays: number | null
  spentDisplay: string
}): string {
  const usual = customer.typicalGapDays
  switch (customer.status) {
    case 'slipping':
      return usual
        ? `Usually in every ${usual} ${usual === 1 ? 'day' : 'days'}, and it has been ${customer.daysSince}. A quick message about today's special is often all it takes.`
        : `It has been ${customer.daysSince} days since their first and only order. Ask them how it was and tell them what is fresh today.`
    case 'overdue':
      return usual
        ? `Well past their usual ${usual} ${usual === 1 ? 'day' : 'days'} — ${customer.daysSince} days now. Worth a message naming something they have ordered before.`
        : `${customer.daysSince} days since their only order. One friendly message, with a reason to come back today.`
    case 'gone':
      return `No order in ${customer.daysSince} days, and they spent ${customer.spentDisplay} here. Worth one last friendly message, then leave them be.`
  }
}

function messageFor(businessName: string, customer: { name: string; status: WinBackStatus }): string {
  const greeting = `Hi ${customer.name}, it's ${businessName}.`
  if (customer.status === 'gone') {
    return `${greeting} It's been a long while — we'd love to see you again. Pop in or order any time, we'll look after you.`
  }
  return `${greeting} We haven't seen you in a bit and wanted to check in. Can we put something together for you today?`
}

const STATUS_ORDER: Record<WinBackStatus, number> = { slipping: 0, overdue: 1, gone: 2 }

/**
 * Who to win back, best bet first.
 *
 * Order is deliberate: the customers still winnable come before the ones
 * already gone, and within each group the biggest spenders first — an owner
 * with ten minutes should spend them on the people most likely to come back
 * and worth the most when they do.
 */
export function buildWinBackList(
  customers: readonly CustomerOrderHistory[],
  opts: { today?: Date; businessName?: string; limit?: number } = {},
): WinBackList {
  const today = opts.today ?? new Date()
  const businessName = opts.businessName ?? 'your shop'
  const limit = opts.limit ?? DEFAULT_LIMIT

  const withOrders = customers.filter((customer) => customer.orderDates.length > 0)

  // The shop's own rhythm, from the customers who have a rhythm — the
  // yardstick for anyone who has only ordered once.
  const perCustomerGap = new Map<string, number | null>()
  const allGaps: number[] = []
  for (const customer of withOrders) {
    const gap = median(orderGaps(customer.orderDates))
    perCustomerGap.set(customer.publicId, gap)
    if (gap !== null && gap > 0) allGaps.push(gap)
  }
  const businessGapDays = median(allGaps)

  const flagged: WinBackCustomer[] = []
  for (const customer of withOrders) {
    const sorted = [...customer.orderDates].sort()
    const lastOrder = sorted[sorted.length - 1]!
    const daysSince = daysBetween(lastOrder, today)
    const typicalGapDays = perCustomerGap.get(customer.publicId) ?? null
    // Their own gap when they have one; otherwise the shop's; otherwise a
    // month, which is the cut-off the simpler customers list already uses.
    const measuredAgainstDays = Math.max(1, typicalGapDays || businessGapDays || FALLBACK_GAP_DAYS)
    const status = statusOf(daysSince, measuredAgainstDays)
    if (!status) continue

    const name = firstName(customer.displayName, customer.shortCode)
    const spentDisplay = formatCents(customer.spentCents)
    const action = actionFor({ status, daysSince, typicalGapDays, spentDisplay })
    // A WhatsApp link to a landline is a dead end dressed up as an action, so
    // the number has to be a mobile before one is offered — the same check
    // customer.service makes before it will register a number at all.
    const messageable = customer.contactPhone !== null && isValidZaMobile(normalisePhone(customer.contactPhone))
    const whatsappUrl = messageable ? whatsappLink(customer.contactPhone, messageFor(businessName, { name, status })) : null

    flagged.push({
      publicId: customer.publicId,
      shortCode: customer.shortCode,
      name,
      lastOrder,
      daysSince,
      typicalGapDays,
      measuredAgainstDays,
      orders: customer.orderDates.length,
      spentCents: customer.spentCents,
      spentDisplay,
      status,
      action,
      whatsappUrl,
      contactNote: whatsappUrl
        ? null
        : customer.contactPhone
          ? 'That contact number is not a mobile we can message.'
          : 'No contact number on file — they have only collected, so ask for them by short code.',
    })
  }

  flagged.sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.spentCents - a.spentCents || a.publicId.localeCompare(b.publicId),
  )

  const shown = flagged.slice(0, limit)
  const atRiskCents = flagged.reduce((sum, customer) => sum + customer.spentCents, 0)

  return {
    customers: shown,
    counts: {
      slipping: flagged.filter((customer) => customer.status === 'slipping').length,
      overdue: flagged.filter((customer) => customer.status === 'overdue').length,
      gone: flagged.filter((customer) => customer.status === 'gone').length,
    },
    atRiskCents,
    atRiskDisplay: formatCents(atRiskCents),
    businessGapDays,
    consideredCount: withOrders.length,
    method: methodLines({ businessGapDays, considered: withOrders.length, flagged: flagged.length, shown: shown.length }),
  }
}

function methodLines(input: { businessGapDays: number | null; considered: number; flagged: number; shown: number }): string[] {
  const lines = [
    'Each customer is measured against their OWN pattern: the usual number of days between their paid orders. Someone who orders every second day is slipping after a week; someone who orders monthly is not.',
    `Slipping starts at ${GRACE} times their usual gap, overdue at ${OVERDUE_AT} times, and past ${GONE_AT} times — or ${GONE_DAYS} days, whichever comes first — they are counted as gone. Nobody is listed inside ${MIN_DAYS_SINCE} days, and for a customer who orders very often the whole scale moves out with that, so nobody is written off after one quiet week.`,
  ]
  lines.push(
    input.businessGapDays
      ? `A customer who has only ordered once is measured against your shop's usual gap of ${input.businessGapDays} ${input.businessGapDays === 1 ? 'day' : 'days'}.`
      : `A customer who has only ordered once is measured against ${FALLBACK_GAP_DAYS} days, until your shop has a pattern of its own.`,
  )
  lines.push(
    `${input.considered} ${input.considered === 1 ? 'customer has' : 'customers have'} paid for an order; ${input.flagged} ${input.flagged === 1 ? 'is' : 'are'} on this list${input.shown < input.flagged ? `, and the top ${input.shown} are shown` : ''}.`,
  )
  lines.push('Paid orders only, and only orders placed with you.')
  return lines
}
