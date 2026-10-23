/**
 * Whether the public pay page may hand an order to PayFast right now — pure,
 * so every refusal is unit-testable. The page itself only renders the result.
 *
 * Order matters: payment state is checked before fulfilment state, and both
 * before anything that would create an attempt (the page is a public GET).
 */

import { MAX_OPEN_ATTEMPTS_PER_ORDER } from './payment-attempt.service'

export type HandoffDecision =
  | { kind: 'HANDOFF' }
  | { kind: 'ALREADY_PAID' }
  /** Cancelled, completed, refunded, failed — nothing to pay online. */
  | { kind: 'NOT_PAYABLE' }
  /** The shop has no verified account of its own — never a platform fallback. */
  | { kind: 'ONLINE_PAYMENT_OFF' }
  /** Too many handoffs already open for this order. */
  | { kind: 'TOO_MANY_ATTEMPTS' }
  /** notify_url would have to come from the request's Host header. */
  | { kind: 'MISCONFIGURED' }

export function decideHandoff(input: {
  paymentStatus: string
  orderStatus: string
  receivingVerified: boolean
  openAttempts: number
  /** NEXT_PUBLIC_APP_URL is set (or we're not in production). */
  trustedOriginConfigured: boolean
}): HandoffDecision {
  if (input.paymentStatus === 'PAID') return { kind: 'ALREADY_PAID' }
  if (input.paymentStatus !== 'PENDING') return { kind: 'NOT_PAYABLE' }
  if (input.orderStatus === 'CANCELLED' || input.orderStatus === 'COMPLETED' || input.orderStatus === 'REFUNDED') {
    return { kind: 'NOT_PAYABLE' }
  }
  if (!input.receivingVerified) return { kind: 'ONLINE_PAYMENT_OFF' }
  if (!input.trustedOriginConfigured) return { kind: 'MISCONFIGURED' }
  if (input.openAttempts >= MAX_OPEN_ATTEMPTS_PER_ORDER) return { kind: 'TOO_MANY_ATTEMPTS' }
  return { kind: 'HANDOFF' }
}

/**
 * PayFast needs at least one of email / cell number. Send only one — the
 * minimum it requires — so the handoff form carries as little of the
 * customer's personal information as possible.
 */
export function buyerContactForHandoff(identifiers: { type: string; value: string }[]): {
  buyerEmail?: string
  buyerCellNumber?: string
} {
  const email = identifiers.find((i) => i.type === 'email')?.value
  if (email) return { buyerEmail: email }
  const phone = identifiers.find((i) => i.type === 'phone')?.value
  return phone ? { buyerCellNumber: phone } : {}
}
