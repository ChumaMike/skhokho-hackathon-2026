/**
 * Customer-facing order messages — to the email typed at checkout AND to the
 * phone typed at checkout, through the MessageProvider seam
 * (src/lib/messaging/provider.ts). Both live on the order as metadata
 * (notifyEmail / notifyPhone), never on the customer's identity. A customer
 * with only a WhatsApp number therefore gets every milestone a customer
 * with an email gets, as soon as a phone provider is configured; until
 * then the gap is observable (message.unconfigured), never silent.
 *
 * Every sender here is fire-and-forget: called AFTER the transaction that
 * changed the order, never inside it, and never throws — a failed message
 * can't corrupt or roll back an order. sendEmail / sendPhoneMessage already
 * record failures as observable SYSTEM events with safe metadata only.
 *
 * Status messages ALSO go to the browsers the customer switched on for
 * this shop (Web Push, Tab 7): the order's membership, never an identity,
 * selects the subscriptions, and push-delivery.ts handles the rest.
 *
 * Nothing secret is ever included in a STATUS message: no drop-off code,
 * no tracking token. The confirmation carries the customer's own delivery
 * page link (which this customer's browser already holds) and nothing the
 * shop could use.
 */

import { prisma } from '@/lib/prisma/client'
import { customerOrderStatusEmail, sendEmail, type CustomerOrderStatus } from '@/lib/email'
import { sendPhoneMessage } from '@/lib/messaging/provider'
import { customerOrderPlacedText, customerOrderStatusText } from '@/lib/messaging/templates'
import { formatZAR } from '@/lib/utils'
import { log, errorFields } from '@/lib/log'
import { customerCancellationText, formatEtaTime, getOrderCancellation, getOrderEta } from './order.service'
import { pushOrderStatusToMembership } from '@/modules/customers/push-delivery'

/** Where this order's messages go — read from the order itself, never from the identity. */
export function notifyTargets(metadata: unknown): { email: string | null; phone: string | null } {
  const m = (metadata ?? {}) as { notifyEmail?: unknown; notifyPhone?: unknown }
  return {
    email: typeof m.notifyEmail === 'string' && m.notifyEmail ? m.notifyEmail : null,
    phone: typeof m.notifyPhone === 'string' && /^\+27[678]\d{8}$/.test(m.notifyPhone) ? m.notifyPhone : null,
  }
}

export async function notifyCustomerOrderStatus(orderId: string, status: CustomerOrderStatus): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, metadata: true, fulfilmentMethod: true, businessId: true, membershipId: true, business: { select: { id: true, name: true, phone: true, whatsapp: true } } },
    })
    if (!order) return
    const { email, phone } = notifyTargets(order.metadata)
    if (!email && !phone && !order.membershipId) return
    const contact = order.business.whatsapp || order.business.phone || null
    // Tab 5 — what the merchant promised or decided, in a sentence a customer can act on
    // (the ETA on acceptance, the reason on cancellation). Email only for now; the
    // phone template is Customer accounts' and keeps its own wording.
    let detail: string | null = null
    if (status === 'CONFIRMED') {
      const eta = getOrderEta(order.metadata)
      if (eta) {
        detail =
          order.fulfilmentMethod === 'DELIVERY'
            ? `It should be on its way by about ${formatEtaTime(eta.readyAt)}.`
            : `It should be ready to collect at about ${formatEtaTime(eta.readyAt)}.`
      }
    } else if (status === 'CANCELLED') {
      const c = getOrderCancellation(order.metadata)
      if (c) detail = customerCancellationText(c) || null
    }
    const sends: Promise<unknown>[] = []
    if (email) {
      const { subject, html, text } = customerOrderStatusEmail({
        status,
        businessName: order.business.name,
        orderNumber: order.orderNumber,
        fulfilmentMethod: order.fulfilmentMethod,
        contact,
        detail,
      })
      sends.push(sendEmail({ to: email, subject, html, text, kind: 'customer_order_status' }))
    }
    if (phone) {
      sends.push(
        sendPhoneMessage({
          to: phone,
          text: customerOrderStatusText({ status, businessName: order.business.name, orderNumber: order.orderNumber, contact }),
          kind: 'customer_order_status',
          // This text is sent on the shop's behalf, so the shop's daily cap
          // applies and the cost is attributed to it (Tab 4, notify-sms).
          businessId: order.businessId,
        }),
      )
    }
    // Web Push: every browser this customer switched on at THIS shop (none → nothing happens, no event).
    if (order.membershipId) {
      sends.push(
        pushOrderStatusToMembership({
          membershipId: order.membershipId,
          businessId: order.business.id,
          businessName: order.business.name,
          orderId: order.id,
          orderNumber: order.orderNumber,
          status,
        }),
      )
    }
    await Promise.all(sends)
  } catch (e) {
    log('error', 'customer_notification.failed', { status, ...errorFields(e) })
  }
}

/**
 * The confirmation TEXT for a newly placed order (the email counterpart is
 * sent by the checkout route, which already has the itemised quote in
 * hand). Only for a genuinely new order — the route guards on `created`.
 */
export async function notifyCustomerOrderPlacedByPhone(
  orderId: string,
  opts: { trackingUrl: string; deliveryUrl: string | null; paymentMessage: string },
): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { orderNumber: true, metadata: true, fulfilmentMethod: true, total: true, businessId: true, business: { select: { name: true } } },
    })
    if (!order) return
    const { phone } = notifyTargets(order.metadata)
    if (!phone) return
    await sendPhoneMessage({
      to: phone,
      text: customerOrderPlacedText({
        businessName: order.business.name,
        orderNumber: order.orderNumber,
        totalFormatted: formatZAR(order.total),
        fulfilmentMethod: order.fulfilmentMethod,
        paymentMessage: opts.paymentMessage,
        trackingUrl: opts.trackingUrl,
        deliveryUrl: opts.deliveryUrl,
      }),
      kind: 'customer_order_confirmation',
      businessId: order.businessId,
    })
  } catch (e) {
    log('error', 'customer_notification.failed', { status: 'PLACED', ...errorFields(e) })
  }
}
