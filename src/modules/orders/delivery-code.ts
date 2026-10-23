/**
 * Proof of delivery for a business's OWN drivers — the counterpart of
 * Skhokholetha's drop-off code (modules/skhokholetha/codes.ts), reusing its
 * derivation: a 6-digit code HMAC-derived from the server key, the delivery
 * and a per-delivery nonce. Only the nonce is stored (order_delivery_codes).
 *
 *   assignDriver        → issueDropoffCode (idempotent)
 *   customer's page     → the code, while a driver is assigned or out
 *   driver "Delivered"  → verifyDropoffCode, then the delivery completes
 *   manager             → rotateDropoffCode after a lock, or completes
 *                         WITHOUT the code with a recorded reason
 *
 * The code is REQUIRED only when the customer can actually see it — i.e. the
 * order came through the storefront and holds a customer key
 * (OrderDelivery.customerKeyHash). An order with no customer page (a legacy
 * row) completes as before, without a code.
 */

import { prisma } from '@/lib/prisma/client'
import { checkRateLimits } from '@/lib/rate-limit'
import { securityEvent } from '@/modules/platform-admin/audit'
import { codeMatches, deriveCode, newCodeNonce, MAX_CODE_FAILURES } from '@/modules/skhokholetha/codes'

export { MAX_CODE_FAILURES }

/** Keeps own-driver codes in a different HMAC domain from network deliveries with the same id shape. */
function codeSubject(orderDeliveryId: string): string {
  return `own:${orderDeliveryId}`
}

export type DeliveryCodeFailure = 'CODE_REQUIRED' | 'CODE_WRONG' | 'CODE_LOCKED' | 'RATE_LIMITED'

export class DeliveryCodeError extends Error {
  constructor(
    message: string,
    readonly code: DeliveryCodeFailure,
  ) {
    super(message)
    this.name = 'DeliveryCodeError'
  }
}

/** Issues the code once; a repeated call (reassignment, retry) keeps the existing one. */
export async function issueDropoffCode(businessId: string, orderDeliveryId: string): Promise<void> {
  try {
    await prisma.orderDeliveryCode.create({ data: { orderDeliveryId, businessId, nonce: newCodeNonce() } })
  } catch (e) {
    if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') return
    throw e
  }
}

export function dropoffCodeFor(orderDeliveryId: string, nonce: string): string {
  return deriveCode('DROPOFF', codeSubject(orderDeliveryId), nonce)
}

/** The manager issues a new code after too many wrong tries; the old one stops working at once. */
export async function rotateDropoffCode(businessId: string, orderDeliveryId: string): Promise<void> {
  const updated = await prisma.orderDeliveryCode.updateMany({
    where: { orderDeliveryId, businessId, confirmedAt: null },
    data: { nonce: newCodeNonce(), failures: 0 },
  })
  if (updated.count === 0) throw new Error('There is no open delivery code to replace.')
}

/**
 * Checks the code a driver typed. Runs OUTSIDE the completing transaction so
 * a wrong guess is always counted; locks after MAX_CODE_FAILURES (a security
 * signal — guessing, or a driver trying to skip the customer) and rate limits
 * per driver. Returns normally on a match.
 */
export async function verifyDropoffCode(
  businessId: string,
  orderDeliveryId: string,
  presented: string | null | undefined,
  actorStaffId: string,
  now: Date = new Date(),
): Promise<void> {
  const row = await prisma.orderDeliveryCode.findFirst({ where: { orderDeliveryId, businessId } })
  if (!row) return // no code was ever issued for this delivery — nothing to check
  if (row.confirmedAt) return
  if (!presented || !presented.trim()) {
    throw new DeliveryCodeError("Ask the customer for their 6-digit delivery code — it's on their delivery page.", 'CODE_REQUIRED')
  }
  const limited = await checkRateLimits([['deliveryCodeDriver', `staff:${actorStaffId}`]], now)
  if (!limited.allowed) throw new DeliveryCodeError('Too many code attempts. Wait a few minutes.', 'RATE_LIMITED')
  if (row.failures >= MAX_CODE_FAILURES) {
    throw new DeliveryCodeError('Too many wrong codes — ask your manager to issue a new one.', 'CODE_LOCKED')
  }
  if (codeMatches('DROPOFF', codeSubject(orderDeliveryId), row.nonce, presented)) return

  await prisma.orderDeliveryCode.update({ where: { orderDeliveryId }, data: { failures: { increment: 1 } } })
  if (row.failures + 1 >= MAX_CODE_FAILURES) {
    await securityEvent('delivery_code_locked', {
      outcome: 'DENIED',
      actor: { type: 'staff', id: actorStaffId },
      businessId,
      resource: { type: 'order_delivery', id: orderDeliveryId },
      metadata: { purpose: 'DROPOFF', source: 'own_driver' },
    })
  }
  throw new DeliveryCodeError("That code isn't right. Check it with the customer.", 'CODE_WRONG')
}

/** What the customer's own page shows for an own-driver delivery (never the business). */
export async function customerDropoffCodeView(orderDeliveryId: string): Promise<{ code: string | null; locked: boolean } | null> {
  const row = await prisma.orderDeliveryCode.findUnique({
    where: { orderDeliveryId },
    select: { nonce: true, failures: true, confirmedAt: true, orderDelivery: { select: { status: true } } },
  })
  if (!row) return null
  const show = !row.confirmedAt && (row.orderDelivery.status === 'ASSIGNED' || row.orderDelivery.status === 'PICKED_UP')
  return { code: show ? dropoffCodeFor(orderDeliveryId, row.nonce) : null, locked: row.failures >= MAX_CODE_FAILURES }
}
