/**
 * Pickup and drop-off confirmation codes.
 *
 * A code is 6 digits DERIVED with HMAC-SHA256 from a server key, the delivery
 * id, the purpose and a per-delivery random nonce. Nothing derivable is
 * stored: the database holds only the nonce, so a database read alone can't
 * reveal a code, and rotating the nonce instantly replaces it. Codes are
 * shown only to the party who must hand them over (the shop sees the pickup
 * code; the customer's tracking page shows the drop-off code) and are never
 * written to logs or delivery events.
 *
 * Guessing: 1 in 1,000,000 per try, and the service locks a code after
 * MAX_CODE_FAILURES wrong tries (plus the shared rate limiter per driver).
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export type CodePurpose = 'PICKUP' | 'DROPOFF'

export const CODE_LENGTH = 6
export const MAX_CODE_FAILURES = 5

function codeKey(): Buffer {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be set (at least 32 characters) to issue delivery codes.')
  // A key of its own, derived from the server secret, so codes can't be
  // confused with any other use of that secret.
  return createHash('sha256').update(`skhokholetha-delivery-codes:${secret}`).digest()
}

export function newCodeNonce(): string {
  return randomBytes(16).toString('hex')
}

export function deriveCode(purpose: CodePurpose, deliveryId: string, nonce: string): string {
  const mac = createHmac('sha256', codeKey()).update(`${purpose}:${deliveryId}:${nonce}`).digest()
  // 48 bits → decimal → last 6 digits (modulo bias at 2^48 is negligible).
  const n = mac.readUIntBE(0, 6) % 10 ** CODE_LENGTH
  return n.toString().padStart(CODE_LENGTH, '0')
}

/** Constant-time comparison of a presented code. */
export function codeMatches(purpose: CodePurpose, deliveryId: string, nonce: string, presented: string): boolean {
  const cleaned = (presented ?? '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(cleaned)) return false
  const expected = Buffer.from(deriveCode(purpose, deliveryId, nonce))
  return timingSafeEqual(expected, Buffer.from(cleaned))
}

/**
 * Customer tracking-link token: HMAC of the delivery id + a random nonce
 * (256 bits, unguessable). Derivable again for the shop from the stored
 * nonce; looked up by its SHA-256 only. Rotating the nonce kills old links.
 */
export function deriveTrackingToken(deliveryId: string, nonce: string): string {
  return createHmac('sha256', codeKey()).update(`TRACK:${deliveryId}:${nonce}`).digest('base64url')
}

export function hashTrackingToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * The CUSTOMER's own delivery key (per order delivery). Issued only to the
 * customer — in the checkout response and their own confirmation email —
 * and never returned by any business-facing view. It unlocks the customer's
 * delivery page, the only place the drop-off code is shown. Looked up by its
 * SHA-256; the nonce makes it rotatable.
 */
export function deriveCustomerKey(orderDeliveryId: string, nonce: string): string {
  return createHmac('sha256', codeKey()).update(`CUSTOMER:${orderDeliveryId}:${nonce}`).digest('base64url')
}
