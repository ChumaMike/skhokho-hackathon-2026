/**
 * Orders that may be stuck — defined once, here, and only ever SURFACED to
 * operations. Nothing in this module changes an order: time passing is a
 * reason to look, never a reason to act (docs/merchant-operations.md).
 *
 * "Stuck" is judged from the order's own timestamps: `createdAt` for orders
 * nobody has touched, `updatedAt` (bumped by every status change) for the
 * ones a merchant started working on. Every query is a bounded count or a
 * small indexed page, so the overview stays cheap.
 */

import type { OrderStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { TERMINAL_STATUSES } from '@/modules/skhokholetha/state-machine'

const MIN = 60 * 1000
const H = 60 * MIN

/** Minutes/hours after which each situation deserves a look. Tuned for a takeaway; shown next to each view. */
export const ORDER_ATTENTION = {
  /** PENDING order nobody has accepted — a busy counter misses the new-order sound. */
  newUnactionedMin: 15,
  /** Customer PAID online, merchant still hasn't confirmed — the one that annoys customers most. */
  paidUnconfirmedMin: 10,
  /** Online order still unpaid: the customer abandoned the gateway or the notification never came. */
  unpaidOnlineHours: 2,
  /** Accepted / preparing for a long time with no further status change. */
  stuckProcessingHours: 2,
  /** READY for collection and nobody completed it — forgotten at the counter or never collected. */
  readyNotCollectedHours: 2,
  /** READY for delivery with no driver assigned and no Skhokholetha request open. */
  readyNoDeliveryMin: 30,
  /** Any active order this old is almost certainly abandoned. */
  oldActiveHours: 24,
} as const

export type AttentionKind = 'new_unactioned' | 'paid_unconfirmed' | 'unpaid_online' | 'stuck_processing' | 'ready_not_collected' | 'ready_no_delivery' | 'old_active'

export const ATTENTION_KINDS: { kind: AttentionKind; label: string; why: string }[] = [
  { kind: 'paid_unconfirmed', label: 'Paid, not confirmed', why: `paid online, still PENDING after ${ORDER_ATTENTION.paidUnconfirmedMin} min` },
  { kind: 'new_unactioned', label: 'New, not actioned', why: `PENDING for over ${ORDER_ATTENTION.newUnactionedMin} min` },
  { kind: 'ready_no_delivery', label: 'Ready, no driver', why: `READY for delivery, nobody assigned and no Skhokholetha request for ${ORDER_ATTENTION.readyNoDeliveryMin} min` },
  { kind: 'ready_not_collected', label: 'Ready, not collected', why: `READY for collection for over ${ORDER_ATTENTION.readyNotCollectedHours} h` },
  { kind: 'stuck_processing', label: 'Stuck in preparation', why: `CONFIRMED / PROCESSING with no change for ${ORDER_ATTENTION.stuckProcessingHours} h` },
  { kind: 'unpaid_online', label: 'Unpaid online order', why: `card order still unpaid after ${ORDER_ATTENTION.unpaidOnlineHours} h` },
  { kind: 'old_active', label: 'Very old active order', why: `not completed or cancelled after ${ORDER_ATTENTION.oldActiveHours} h` },
]

const ACTIVE: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PROCESSING', 'READY']

/** The Prisma filter for one situation — used by both the counts and the list, so they can never disagree. */
export function attentionWhere(kind: AttentionKind, now: Date, businessId?: string): Prisma.OrderWhereInput {
  const scope = businessId ? { businessId } : {}
  const before = (ms: number) => new Date(now.getTime() - ms)
  switch (kind) {
    case 'new_unactioned':
      return { ...scope, status: 'PENDING', createdAt: { lt: before(ORDER_ATTENTION.newUnactionedMin * MIN) } }
    case 'paid_unconfirmed':
      // updatedAt moves when the payment settles, so this clock starts at payment, not at checkout.
      return { ...scope, status: 'PENDING', paymentStatus: 'PAID', updatedAt: { lt: before(ORDER_ATTENTION.paidUnconfirmedMin * MIN) } }
    case 'unpaid_online':
      // Online orders carry no payment method until they settle; cash orders are marked CASH at checkout.
      return { ...scope, status: { in: ACTIVE }, paymentStatus: 'PENDING', paymentMethod: null, createdAt: { lt: before(ORDER_ATTENTION.unpaidOnlineHours * H) } }
    case 'stuck_processing':
      return { ...scope, status: { in: ['CONFIRMED', 'PROCESSING'] }, updatedAt: { lt: before(ORDER_ATTENTION.stuckProcessingHours * H) } }
    case 'ready_not_collected':
      return { ...scope, status: 'READY', fulfilmentMethod: 'COLLECTION', updatedAt: { lt: before(ORDER_ATTENTION.readyNotCollectedHours * H) } }
    case 'ready_no_delivery':
      return {
        ...scope,
        status: 'READY',
        fulfilmentMethod: 'DELIVERY',
        updatedAt: { lt: before(ORDER_ATTENTION.readyNoDeliveryMin * MIN) },
        // No own driver assigned AND no open Skhokholetha request hanging off the delivery record.
        OR: [{ delivery: null }, { delivery: { status: 'UNASSIGNED', networkDeliveries: { none: { status: { notIn: [...TERMINAL_STATUSES] } } } } }],
      }
    case 'old_active':
      return { ...scope, status: { in: ACTIVE }, createdAt: { lt: before(ORDER_ATTENTION.oldActiveHours * H) } }
  }
}

export type AttentionCounts = Record<AttentionKind, number> & { total: number }

/** One count per situation. `total` is the number of distinct orders (an order can match more than one). */
export async function orderAttentionCounts(now: Date = new Date(), businessId?: string): Promise<AttentionCounts> {
  const counts = await Promise.all(ATTENTION_KINDS.map((k) => prisma.order.count({ where: attentionWhere(k.kind, now, businessId) })))
  const total = await prisma.order.count({ where: { OR: ATTENTION_KINDS.map((k) => attentionWhere(k.kind, now, businessId)) } })
  const out = { total } as AttentionCounts
  ATTENTION_KINDS.forEach((k, i) => {
    out[k.kind] = counts[i]
  })
  return out
}

/** The orders in one situation, oldest first — no customer details. */
export async function listOrdersNeedingAttention(kind: AttentionKind, opts: { now?: Date; businessId?: string; take?: number } = {}) {
  const now = opts.now ?? new Date()
  return prisma.order.findMany({
    where: attentionWhere(kind, now, opts.businessId),
    orderBy: { createdAt: 'asc' },
    take: opts.take ?? 50,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      total: true,
      fulfilmentMethod: true,
      createdAt: true,
      updatedAt: true,
      business: { select: { id: true, name: true } },
    },
  })
}
