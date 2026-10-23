/**
 * Texts that go to a customer's phone — short, plain, warm South African
 * English, one message each. The email versions live in src/lib/email.ts;
 * these are the same milestones said in fewer words, because a text on a
 * small screen is read in one glance.
 *
 * Nothing secret ever goes here: no drop-off code, no tracking token. The
 * confirmation carries the customer's own delivery-page link and the
 * confirmation page link (both already handed to this customer's browser
 * at checkout); status updates carry only the order number and the shop's
 * contact.
 */

import type { CustomerOrderStatus } from '@/lib/email'

const STATUS_TEXT: Record<CustomerOrderStatus, (biz: string) => string> = {
  CONFIRMED: (b) => `${b} has confirmed your order and is getting it ready.`,
  READY_FOR_COLLECTION: (b) => `Your order is ready — come and fetch it at ${b}.`,
  DRIVER_ASSIGNED: (b) => `A driver is heading to ${b} to collect your order.`,
  OUT_FOR_DELIVERY: (b) => `Your order from ${b} is on its way to you.`,
  DELIVERED: (b) => `Your order from ${b} has been delivered. Enjoy!`,
  CANCELLED: (b) => `${b} has cancelled this order. If you already paid, the shop will arrange your refund.`,
}

export function customerOrderStatusText(opts: {
  status: CustomerOrderStatus
  businessName: string
  orderNumber: string
  /** The shop's contact number for questions, if it has one. */
  contact: string | null
}): string {
  const contact = opts.contact ? ` Questions? Contact ${opts.businessName} on ${opts.contact}.` : ''
  return `Order ${opts.orderNumber}: ${STATUS_TEXT[opts.status](opts.businessName)}${contact}`
}

export function customerOrderPlacedText(opts: {
  businessName: string
  orderNumber: string
  totalFormatted: string
  fulfilmentMethod: 'COLLECTION' | 'DELIVERY'
  /** "Pay when you collect." / "Pay the driver when it arrives." / "" when paid online. */
  paymentMessage: string
  /** The confirmation page for this order (order id is the key, same as the email). */
  trackingUrl: string
  /** The customer's own Skhokholetha delivery page — delivery orders only. */
  deliveryUrl: string | null
}): string {
  const how = opts.fulfilmentMethod === 'DELIVERY' ? 'for delivery' : 'for collection'
  const pay = opts.paymentMessage ? ` ${opts.paymentMessage}` : ''
  const track = opts.deliveryUrl ? ` Your order and delivery page: ${opts.deliveryUrl}` : ` Your order: ${opts.trackingUrl}`
  return `Thanks! Order ${opts.orderNumber} at ${opts.businessName} ${how}, ${opts.totalFormatted}.${pay}${track}`
}

// ---- Tab 7 (web push, feature/notify-webpush) ----
// The same milestone as the text above, cut for a notification card: a
// title that names the shop and the order, one line of body, and the
// customer's own order page to open on tap. Nothing secret, same as the text.

export function customerOrderStatusPush(opts: {
  status: CustomerOrderStatus
  businessName: string
  orderNumber: string
  /** The order's own confirmation page, a path on the storefront's origin (works on the platform host and a shop's own domain). */
  orderPath: string
}): { title: string; body: string; url: string; tag: string } {
  return {
    title: `${opts.businessName} · order ${opts.orderNumber}`,
    body: STATUS_TEXT[opts.status](opts.businessName),
    url: opts.orderPath,
    tag: `order-${opts.orderNumber}`,
  }
}
