/**
 * OBSERVE — what the Business Buddy may see, for one person.
 *
 * Every area is read only when that person's role could see it on the
 * dashboard anyway (the same permission the matching page checks); an area
 * they can't see is left `undefined`, so nothing downstream — the briefing,
 * the chat context, the model prompt — can ever mention it. The buddy gets
 * no privileges of its own.
 *
 * Privacy: counts and the business's own catalogue names only. No customer
 * names, phone numbers or addresses are read here at all.
 */

import { prisma } from '@/lib/prisma/client'
import { actorCan, type StaffActor } from '@/lib/auth/guards'
import { getBusinessEntitlements } from '@/modules/billing/subscription.service'
import { hasFeature } from '@/modules/billing/entitlements'
import { storefrontDay } from '@/modules/storefront-learning/events'
import { getBusinessReadiness } from './readiness.service'
import type { ReadinessItem } from './readiness'

const DAY_MS = 24 * 60 * 60 * 1000
const SAST_MS = 2 * 60 * 60 * 1000
/** Interactions an item needs before the buddy calls it the "most engaged". */
export const TOP_ITEM_MIN_INTERACTIONS = 5
const LAPSED_DAYS = 30

export interface BuddySnapshot {
  businessName: string
  now: Date
  /** canManageOrders sees everything; canPrepareOrders sees only what's to prepare. */
  orders?: { needsAttention?: number; toPrepare: number; ready?: number }
  deliveries?: { unassigned: number }
  bookings?: { today: number }
  refundsDue?: number
  lowStock?: { count: number; names: string[] }
  lapsedCustomers?: number
  storefront?: { visits: number; topItem: { kind: 'PRODUCT' | 'SERVICE'; id: string; name: string; isFeatured: boolean } | null }
  readiness?: ReadinessItem[]
  /** Whether the business has ever published a storefront design (canManageSettings only). */
  hasPublishedDesign?: boolean
}

/** Start/end of "today" in South Africa, as UTC instants. */
export function sastDayBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(storefrontDay(now).getTime() - SAST_MS)
  return { start, end: new Date(start.getTime() + DAY_MS) }
}

async function topStorefrontItem(businessId: string, now: Date) {
  const since = new Date(storefrontDay(now).getTime() - 29 * DAY_MS)
  const [visits, grouped] = await Promise.all([
    prisma.storefrontDailyStat.aggregate({ where: { businessId, day: { gte: since }, event: 'PAGE_VIEW' }, _sum: { count: true } }),
    prisma.storefrontDailyStat.groupBy({
      by: ['itemId'],
      where: { businessId, day: { gte: since }, itemId: { not: '' }, event: { in: ['PRODUCT_VIEW', 'ADD_TO_BASKET', 'ENQUIRY_CLICK'] } },
      _sum: { count: true },
    }),
  ])
  const ranked = grouped
    .map((g) => ({ id: g.itemId, n: g._sum.count ?? 0 }))
    .filter((g) => g.n >= TOP_ITEM_MIN_INTERACTIONS)
    .sort((a, b) => b.n - a.n)
    .slice(0, 5)
  let topItem: NonNullable<BuddySnapshot['storefront']>['topItem'] = null
  if (ranked.length) {
    const ids = ranked.map((r) => r.id)
    // Only this business's own, still-active items — a stale or foreign id is never named.
    const [products, services] = await Promise.all([
      prisma.product.findMany({ where: { businessId, id: { in: ids }, isActive: true }, select: { id: true, name: true, isFeatured: true } }),
      prisma.service.findMany({ where: { businessId, id: { in: ids }, isActive: true }, select: { id: true, name: true, isFeatured: true } }),
    ])
    for (const r of ranked) {
      const p = products.find((x) => x.id === r.id)
      const s = services.find((x) => x.id === r.id)
      if (p) topItem = { kind: 'PRODUCT', ...p }
      else if (s) topItem = { kind: 'SERVICE', ...s }
      if (topItem) break
    }
  }
  return { visits: visits._sum.count ?? 0, topItem }
}

export async function gatherBuddySnapshot(actor: StaffActor, now: Date = new Date()): Promise<BuddySnapshot> {
  const businessId = actor.tenantId
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true } })
  const snapshot: BuddySnapshot = { businessName: business.name, now }
  const { start, end } = sastDayBounds(now)
  const tasks: Promise<void>[] = []

  if (actorCan(actor, 'canManageOrders')) {
    tasks.push(
      prisma.order.groupBy({ by: ['status'], where: { businessId, status: { in: ['PENDING', 'CONFIRMED', 'PROCESSING', 'READY'] } }, _count: true }).then((rows) => {
        const n = (s: string) => rows.find((r) => r.status === s)?._count ?? 0
        snapshot.orders = { needsAttention: n('PENDING'), toPrepare: n('CONFIRMED') + n('PROCESSING'), ready: n('READY') }
      }),
    )
  } else if (actorCan(actor, 'canPrepareOrders')) {
    tasks.push(
      prisma.order.count({ where: { businessId, status: { in: ['CONFIRMED', 'PROCESSING'] } } }).then((toPrepare) => {
        snapshot.orders = { toPrepare }
      }),
    )
  }

  if (actorCan(actor, 'canManageDeliveries')) {
    tasks.push(
      prisma.orderDelivery
        .count({ where: { businessId, status: 'UNASSIGNED', order: { status: { notIn: ['CANCELLED', 'COMPLETED', 'REFUNDED'] } } } })
        .then((unassigned) => {
          snapshot.deliveries = { unassigned }
        }),
    )
  }

  if (actorCan(actor, ['canReadBookings', 'canManageBookings'])) {
    tasks.push(
      prisma.appointment
        .count({ where: { businessId, startTime: { gte: start, lt: end }, status: { in: ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS'] } } })
        .then((today) => {
          snapshot.bookings = { today }
        }),
    )
  }

  if (actorCan(actor, ['canProcessPayments', 'canManageBilling'])) {
    tasks.push(
      prisma.businessPaymentAttempt.count({ where: { businessId, status: 'REFUND_DUE' } }).then((n) => {
        snapshot.refundsDue = n
      }),
    )
  }

  if (actorCan(actor, 'canManageInventory')) {
    tasks.push(
      prisma.$queryRaw<{ name: string }[]>`
        SELECT p."name" FROM "inventory_items" i JOIN "products" p ON p."id" = i."product_id"
        WHERE i."business_id" = ${businessId}::uuid AND p."business_id" = ${businessId}::uuid
          AND p."is_active" AND p."track_stock" AND i."min_quantity" > 0 AND i."quantity" <= i."min_quantity"
        ORDER BY i."quantity" ASC, p."name" ASC LIMIT 50`.then((rows) => {
        snapshot.lowStock = { count: rows.length, names: rows.slice(0, 3).map((r) => r.name) }
      }),
    )
  }

  if (actorCan(actor, ['canManageCustomers', 'canIssueLoyalty'])) {
    // A count only — names stay on the Customers page, where the role's own rules apply.
    const cutoff = new Date(now.getTime() - LAPSED_DAYS * DAY_MS)
    tasks.push(
      prisma.membership.count({ where: { businessId, status: 'active', lastSeen: { lt: cutoff } } }).then((n) => {
        snapshot.lapsedCustomers = n
      }),
    )
  }

  if (actorCan(actor, 'canViewAnalytics')) {
    tasks.push(
      getBusinessEntitlements(businessId).then(async (entitlements) => {
        if (hasFeature(entitlements, 'basic_analytics')) snapshot.storefront = await topStorefrontItem(businessId, now)
      }),
    )
  }

  if (actorCan(actor, 'canManageSettings')) {
    tasks.push(
      getBusinessReadiness(businessId).then((items) => {
        snapshot.readiness = items
      }),
      prisma.storefrontRevision.count({ where: { businessId, publishedAt: { not: null } } }).then((n) => {
        snapshot.hasPublishedDesign = n > 0
      }),
    )
  }

  await Promise.all(tasks)
  return snapshot
}
