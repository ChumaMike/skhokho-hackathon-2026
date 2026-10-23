/**
 * Order updates by Web Push — the one place that turns "this order moved"
 * into pushes to the browsers the customer switched on at THIS shop.
 *
 * The membership (pairwise, per business) selects the subscriptions, the
 * provider seam (src/lib/messaging/provider.ts, Tab 7 block) sends, and
 * what the push service says comes back here: accepted rows are stamped,
 * gone rows (404/410) are forgotten everywhere. Never throws — called
 * fire-and-forget after the order has already changed, like email and
 * the phone text.
 */

import type { CustomerOrderStatus } from '@/lib/email'
import { sendPushMessages } from '@/lib/messaging/provider'
import { customerOrderStatusPush } from '@/lib/messaging/templates'
import { log, errorFields } from '@/lib/log'
import { forgetDeadEndpoint, markPushSent, pushSubscriptionsForMembership } from './push-subscriptions.service'

/** The order's own confirmation page — a path, so it opens on whichever host the customer subscribed from. */
export function orderPagePath(orderId: string): string {
  return `/store/order/${orderId}`
}

export interface OrderStatusPushInput {
  membershipId: string
  businessId: string
  businessName: string
  orderId: string
  orderNumber: string
  status: CustomerOrderStatus
}

export async function pushOrderStatusToMembership(input: OrderStatusPushInput): Promise<{ sent: number; gone: number }> {
  try {
    const targets = await pushSubscriptionsForMembership(input.membershipId)
    if (targets.length === 0) return { sent: 0, gone: 0 }
    const payload = customerOrderStatusPush({
      status: input.status,
      businessName: input.businessName,
      orderNumber: input.orderNumber,
      orderPath: orderPagePath(input.orderId),
    })
    const result = await sendPushMessages(targets, payload, { businessId: input.businessId, kind: 'customer_order_status' })
    await markPushSent(result.sent)
    for (const id of result.gone) {
      const endpoint = targets.find((t) => t.id === id)?.endpoint
      if (endpoint) await forgetDeadEndpoint(endpoint)
    }
    return { sent: result.sent.length, gone: result.gone.length }
  } catch (e) {
    log('error', 'customer_push.failed', { status: input.status, ...errorFields(e) })
    return { sent: 0, gone: 0 }
  }
}
