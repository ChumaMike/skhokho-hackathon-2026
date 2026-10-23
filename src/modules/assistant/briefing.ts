/**
 * EXPLAIN + RECOMMEND — the Business Buddy's daily briefing, from a
 * permission-scoped snapshot (buddy-snapshot.ts). Pure, so what each role
 * sees can be tested exactly.
 *
 *   What is happening?        → `highlights`
 *   What needs attention?     → `attention` (each links to the page that handles it)
 *   What should I do next?    → `recommendations` (a prepared action, or a link)
 *
 * A recommendation carries an action only when this person may perform it;
 * otherwise it says who can. High-risk work (refunds, orders, payments) is
 * only ever a link — the person does it on the normal page.
 */

import type { StaffActor } from '@/lib/auth/guards'
import { actorCan } from '@/lib/auth/guards'
import type { BuddySnapshot } from './buddy-snapshot'
import { ACTION_PERMISSION, type PrepareRequest } from './buddy-actions'

export interface BriefingLine {
  key: string
  text: string
  href?: string
}

export interface Recommendation {
  key: string
  text: string
  why?: string
  /** Present only when this person may do it — the client sends it to prepare. */
  action?: PrepareRequest
  href?: string
  /** Why there's no button, when there isn't. */
  blocked?: string
}

export interface Briefing {
  greeting: string
  attention: BriefingLine[]
  highlights: BriefingLine[]
  recommendations: Recommendation[]
  allClear: boolean
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function greetingFor(now: Date, businessName: string): string {
  const hour = (now.getUTCHours() + 2) % 24 // South Africa, UTC+2 all year
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  return `${part}, ${businessName}.`
}

const ASK_OWNER = 'Ask the business owner — your role can’t change this.'

export function buildBriefing(snapshot: BuddySnapshot, actor: StaffActor): Briefing {
  const attention: BriefingLine[] = []
  const highlights: BriefingLine[] = []
  const recommendations: Recommendation[] = []

  // --- What needs attention -------------------------------------------------
  const o = snapshot.orders
  if (o?.needsAttention) attention.push({ key: 'orders-new', text: `${plural(o.needsAttention, 'order needs', 'orders need')} attention.`, href: '/dashboard/orders' })
  if (o?.toPrepare) {
    attention.push({
      key: 'orders-prepare',
      text: `${plural(o.toPrepare, 'order', 'orders')} to prepare.`,
      href: actorCan(actor, 'canManageOrders') ? '/dashboard/orders' : '/dashboard/kitchen',
    })
  }
  if (o?.ready) attention.push({ key: 'orders-ready', text: `${plural(o.ready, 'order is', 'orders are')} ready and waiting.`, href: '/dashboard/orders' })
  if (snapshot.deliveries?.unassigned) {
    attention.push({ key: 'deliveries', text: `${plural(snapshot.deliveries.unassigned, 'delivery needs', 'deliveries need')} a driver.`, href: '/dashboard/deliveries' })
  }
  if (snapshot.refundsDue) {
    attention.push({
      key: 'refunds',
      text: `${plural(snapshot.refundsDue, 'customer payment needs', 'customer payments need')} a refund — the money arrived but couldn't be used for the order.`,
      href: '/dashboard/orders',
    })
  }
  if (snapshot.lowStock?.count) {
    const names = snapshot.lowStock.names.join(', ')
    attention.push({ key: 'stock', text: `${plural(snapshot.lowStock.count, 'item is', 'items are')} running low${names ? `: ${names}` : ''}.`, href: '/dashboard/catalog' })
  }
  for (const item of snapshot.readiness?.filter((i) => i.severity === 'WARNING') ?? []) {
    attention.push({ key: `ready-${item.key}`, text: `${item.title} — ${item.message}`, href: item.href })
  }

  // --- What is happening ----------------------------------------------------
  if (snapshot.bookings) {
    highlights.push({
      key: 'bookings',
      text: snapshot.bookings.today ? `${plural(snapshot.bookings.today, 'booking', 'bookings')} today.` : 'No bookings today yet.',
      href: '/dashboard/appointments',
    })
  }
  const top = snapshot.storefront?.topItem
  if (top) highlights.push({ key: 'top-item', text: `Your ${top.name} is receiving the most storefront engagement.`, href: '/dashboard/analytics' })
  if (snapshot.lapsedCustomers) {
    highlights.push({ key: 'lapsed', text: `${plural(snapshot.lapsedCustomers, 'customer hasn’t', 'customers haven’t')} been back in 30 days.`, href: '/dashboard/customers' })
  }

  // --- What to do next ------------------------------------------------------
  if (top && !top.isFeatured) {
    const can = actorCan(actor, ACTION_PERMISSION.FEATURE_ITEM)
    recommendations.push({
      key: 'feature-top-item',
      text: `Feature ${top.name} on your homepage.`,
      why: 'It’s what visitors look at most, so putting it up front makes it easier to order.',
      ...(can
        ? { action: { kind: 'FEATURE_ITEM', params: { itemType: top.kind, itemId: top.id, featured: true } } }
        : { blocked: ASK_OWNER }),
    })
  }
  if (snapshot.hasPublishedDesign === false && actorCan(actor, ACTION_PERMISSION.DRAFT_STOREFRONT)) {
    recommendations.push({
      key: 'draft-design',
      text: 'Let your buddy draft a storefront design for you to review.',
      why: 'It uses your real products and details — nothing goes live until you publish it.',
      action: { kind: 'DRAFT_STOREFRONT', params: { mode: 'GENERATE' } },
    })
  }
  if (snapshot.refundsDue) {
    recommendations.push({ key: 'refunds', text: 'Refund the customer in your PayFast account, then note it on the order.', href: '/dashboard/orders' })
  }
  if (o?.needsAttention) recommendations.push({ key: 'orders', text: 'Accept or decline your new orders so customers know where they stand.', href: '/dashboard/orders' })
  if (snapshot.lapsedCustomers && actorCan(actor, 'canManageCustomers')) {
    recommendations.push({ key: 'lapsed', text: 'Send a friendly WhatsApp to customers you haven’t seen in a while.', href: '/dashboard/customers' })
  }
  for (const item of snapshot.readiness?.filter((i) => i.severity === 'SUGGESTION').slice(0, 2) ?? []) {
    recommendations.push({ key: `ready-${item.key}`, text: item.title, why: item.message, href: item.href })
  }

  return {
    greeting: greetingFor(snapshot.now, snapshot.businessName),
    attention,
    highlights,
    recommendations: recommendations.slice(0, 4),
    allClear: attention.length === 0 && recommendations.length === 0,
  }
}
