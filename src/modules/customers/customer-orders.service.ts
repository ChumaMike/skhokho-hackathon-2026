/**
 * "My orders" at ONE business, for a signed-in customer — history, live
 * status, the links to the tracking and delivery pages, reorder lines, and
 * self-service cancel while the shop hasn't started on the order.
 *
 * Scoping is always (businessId, membershipId): the membership comes from
 * customer-account.service.ts's per-business resolution of the verified
 * identifier, so a customer can only ever list and cancel their own orders
 * at the shop they are signed in to. Nothing here reads or returns
 * customers.id.
 *
 * Cancel goes through order.service's cancelOrder (the one place the
 * delivery side-effects live) with a customer-worded reason; the merchant
 * is told twice — the dashboard notification cancelOrder already writes,
 * and an email to the owner from here.
 */

import { prisma } from '@/lib/prisma/client'
import { formatZAR } from '@/lib/utils'
import { appOrigin } from '@/modules/tenant/storefront-url'
import { deriveCustomerKey } from '@/modules/skhokholetha/codes'
import { cancelOrder } from '@/modules/orders/order.service'
import { ownerOrderCancelledByCustomerEmail, sendEmail } from '@/lib/email'
import { log, errorFields } from '@/lib/log'

/** Why a customer cancelled — a fixed list the merchant sees as plain words. */
export const CANCEL_REASONS = {
  CHANGED_MIND: 'I changed my mind',
  ORDERED_BY_MISTAKE: 'I ordered by mistake',
  TAKING_TOO_LONG: "It's taking too long",
  WRONG_DETAILS: 'I got my details wrong',
  OTHER: 'Something else',
} as const
export type CancelReason = keyof typeof CANCEL_REASONS
export const MAX_CANCEL_NOTE_LENGTH = 200

/** Order statuses in which the shop is still working on it — the account page refreshes itself while any order is here. */
const LIVE_STATUSES = ['PENDING', 'CONFIRMED', 'PROCESSING', 'READY'] as const

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Sent to the shop',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Being prepared',
  READY: 'Ready',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
}

const DELIVERY_LABEL: Record<string, string> = {
  UNASSIGNED: 'Waiting for a driver',
  ASSIGNED: 'Driver assigned',
  PICKED_UP: 'On its way',
  DELIVERED: 'Delivered',
  FAILED: 'Delivery problem',
}

export interface CustomerOrderView {
  id: string
  orderNumber: string
  status: string
  statusLabel: string
  /** True while the shop is still on it (the page keeps refreshing). */
  live: boolean
  placedAt: Date
  placedLabel: string
  fulfilmentMethod: 'COLLECTION' | 'DELIVERY'
  totalFormatted: string
  paymentLine: string
  items: { name: string; quantity: number; options: string[] }[]
  /** What "Order again" puts in the basket — ids only, the quote re-prices and drops anything gone. */
  reorderLines: { productId: string; quantity: number; optionIds?: string[] }[]
  /** The order confirmation / tracking page (order id is the key, same as the email link). */
  trackingPath: string
  /** The customer's own Skhokholetha delivery page, for a delivery order — the only place the drop-off code lives. */
  deliveryPageUrl: string | null
  deliveryLabel: string | null
  canCancel: boolean
}

const PLACED_FORMAT = new Intl.DateTimeFormat('en-ZA', {
  timeZone: 'Africa/Johannesburg',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

function paymentLine(o: { paymentStatus: string; paymentMethod: string | null; fulfilmentMethod: string; status: string }): string {
  if (o.paymentStatus === 'PAID') return 'Paid'
  if (o.paymentStatus === 'REFUNDED') return 'Refunded'
  if (o.status === 'CANCELLED') return 'Not charged'
  if (o.paymentMethod === 'CASH') return o.fulfilmentMethod === 'DELIVERY' ? 'Pay the driver' : 'Pay when you collect'
  return 'Payment pending'
}

/** The customer's orders at this business, newest first. */
export async function listCustomerOrders(businessId: string, membershipId: string, opts: { limit?: number } = {}): Promise<CustomerOrderView[]> {
  const rows = await prisma.order.findMany({
    where: { businessId, membershipId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, opts.limit ?? 50),
    select: {
      id: true,
      orderNumber: true,
      status: true,
      createdAt: true,
      total: true,
      fulfilmentMethod: true,
      paymentStatus: true,
      paymentMethod: true,
      items: {
        orderBy: { id: 'asc' },
        select: { productId: true, name: true, quantity: true, options: { orderBy: { sortOrder: 'asc' }, select: { optionId: true, optionNameSnapshot: true } } },
      },
      delivery: { select: { id: true, status: true, customerKeyNonce: true } },
    },
  })
  const origin = appOrigin()
  return rows.map((o) => {
    const live = (LIVE_STATUSES as readonly string[]).includes(o.status)
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      statusLabel: STATUS_LABEL[o.status] ?? o.status,
      live,
      placedAt: o.createdAt,
      placedLabel: PLACED_FORMAT.format(o.createdAt),
      fulfilmentMethod: o.fulfilmentMethod,
      totalFormatted: formatZAR(o.total),
      paymentLine: paymentLine(o),
      items: o.items.map((i) => ({ name: i.name, quantity: i.quantity, options: i.options.map((op) => op.optionNameSnapshot) })),
      reorderLines: o.items
        .filter((i) => i.productId)
        .map((i) => {
          const optionIds = i.options.map((op) => op.optionId).filter((id): id is string => !!id)
          return optionIds.length > 0 ? { productId: i.productId!, quantity: i.quantity, optionIds } : { productId: i.productId!, quantity: i.quantity }
        }),
      trackingPath: `/store/order/${o.id}`,
      deliveryPageUrl: o.delivery?.customerKeyNonce ? `${origin}/delivery/${deriveCustomerKey(o.delivery.id, o.delivery.customerKeyNonce)}` : null,
      deliveryLabel: o.delivery ? (DELIVERY_LABEL[o.delivery.status] ?? null) : null,
      canCancel: o.status === 'PENDING',
    }
  })
}

export class CustomerOrderError extends Error {
  constructor(
    message: string,
    readonly code: 'NOT_FOUND' | 'TOO_LATE' | 'INVALID_REASON',
  ) {
    super(message)
    this.name = 'CustomerOrderError'
  }
}

/**
 * Cancels the customer's own order while it is still PENDING (the shop has
 * not confirmed it). Once confirmed, the shop may already be cooking — the
 * customer is told to contact the shop instead. The merchant is notified
 * on the dashboard (by cancelOrder) and by email (here).
 */
export async function cancelOrderAsCustomer(
  businessId: string,
  membershipId: string,
  orderId: string,
  reason: CancelReason,
  note?: string,
): Promise<{ orderNumber: string }> {
  if (!(reason in CANCEL_REASONS)) throw new CustomerOrderError('Choose a reason.', 'INVALID_REASON')
  const order = await prisma.order.findFirst({ where: { id: orderId, businessId, membershipId }, select: { id: true, orderNumber: true, status: true } })
  if (!order) throw new CustomerOrderError("We couldn't find that order.", 'NOT_FOUND')
  if (order.status !== 'PENDING') {
    throw new CustomerOrderError(
      order.status === 'CANCELLED' ? 'This order is already cancelled.' : 'The shop has already started on this order, so it can no longer be cancelled here. Please contact the shop.',
      'TOO_LATE',
    )
  }
  const trimmedNote = (note ?? '').trim().slice(0, MAX_CANCEL_NOTE_LENGTH)
  // Tab 5's cancelOrder takes a reason from the fixed list: a customer-initiated
  // cancellation is CUSTOMER_ASKED, with their chosen reason and note as the detail.
  await cancelOrder(businessId, orderId, { reason: 'CUSTOMER_ASKED', detail: `${CANCEL_REASONS[reason]}${trimmedNote ? `: ${trimmedNote}` : ''}` })
  void notifyOwnerOfCustomerCancel(businessId, order.orderNumber, CANCEL_REASONS[reason], trimmedNote)
  return { orderNumber: order.orderNumber }
}

/** Fire-and-forget: a failed email never undoes a cancellation already recorded. */
async function notifyOwnerOfCustomerCancel(businessId: string, orderNumber: string, reason: string, note: string): Promise<void> {
  try {
    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, owner: { select: { email: true } } } })
    if (!business?.owner?.email) return
    const { subject, html, text } = ownerOrderCancelledByCustomerEmail({ businessName: business.name, orderNumber, reason, note: note || null })
    await sendEmail({ to: business.owner.email, subject, html, text, kind: 'owner_order_cancelled_by_customer' })
  } catch (e) {
    log('error', 'customer_cancel.owner_email_failed', errorFields(e))
  }
}
