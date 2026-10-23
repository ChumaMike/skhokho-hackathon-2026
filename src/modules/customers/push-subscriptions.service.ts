/**
 * Web Push subscriptions — the browsers a customer said "tell me about my
 * orders on this phone" on. Each row belongs to the customer's pairwise
 * membership at ONE business (never customers.id), so a shop can only
 * reach a customer about its own orders and nothing here crosses shops.
 *
 * Two ways a browser gets tied to a membership, both already trusted by
 * the rest of the storefront:
 *   - a signed-in customer session (the verified phone/email) at this shop
 *   - the order id the customer's browser was just handed at checkout
 *     (the same unguessable-link trust model as the confirmation page)
 *
 * Sending lives in src/lib/messaging/providers/webpush.ts; this module only
 * stores, lists and removes. Nothing about a subscription is secret in the
 * sense of a credential, but the endpoint is the push service's private
 * address for that browser, so it never reaches another customer or a
 * shop's own staff.
 */

import { prisma } from '@/lib/prisma/client'
import type { CustomerToken } from '@/modules/auth/auth.service'
import { findMembershipForSession } from './customer-account.service'

export interface ParsedPushSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

const BASE64URL = /^[A-Za-z0-9_-]+=*$/
const MAX_ENDPOINT = 2048

/**
 * The browser's PushSubscription.toJSON(), checked rather than trusted: an
 * https endpoint of sane length and two base64url keys of the sizes the
 * Web Push encryption needs (a 65-byte P-256 point, a 16-byte auth secret).
 * Anything else is null — the route answers "malformed", nothing is stored.
 */
export function parsePushSubscription(input: unknown): ParsedPushSubscription | null {
  if (!input || typeof input !== 'object') return null
  const o = input as { endpoint?: unknown; keys?: unknown }
  if (typeof o.endpoint !== 'string' || o.endpoint.length > MAX_ENDPOINT) return null
  let url: URL
  try {
    url = new URL(o.endpoint)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  const keys = (o.keys ?? {}) as { p256dh?: unknown; auth?: unknown }
  if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null
  const p256dh = keys.p256dh.trim()
  const auth = keys.auth.trim()
  // 65 bytes → 87 or 88 base64url chars; 16 bytes → 22 to 24.
  if (p256dh.length < 86 || p256dh.length > 90 || !BASE64URL.test(p256dh)) return null
  if (auth.length < 21 || auth.length > 25 || !BASE64URL.test(auth)) return null
  return { endpoint: o.endpoint, p256dh, auth }
}

/**
 * A short, honest name for the account page ("Android phone", "iPhone",
 * "Computer") — read from the user agent once, stored as the label, and the
 * user agent itself is dropped.
 */
export function deviceLabelFrom(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ''
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone or iPad'
  if (/Android/i.test(ua)) return 'Android phone'
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'Computer'
  return 'This device'
}

export interface PushDevice {
  id: string
  deviceLabel: string
  createdAt: Date
}

/** Who a subscription is for: either the signed-in customer at this shop, or the order the browser just placed. */
export type PushOwnerClaim = { session: CustomerToken } | { orderId: string }

/**
 * The membership a claim resolves to at THIS business, or null when it
 * resolves to nothing (signed in but never a customer here; an order id
 * from another shop or that never existed). Never trusts the claim across
 * businesses: an order id only counts for the business it belongs to.
 */
export async function membershipIdForClaim(businessId: string, claim: PushOwnerClaim): Promise<string | null> {
  if ('session' in claim) {
    const m = await findMembershipForSession(businessId, claim.session)
    return m?.membershipId ?? null
  }
  const order = await prisma.order.findFirst({ where: { id: claim.orderId, businessId }, select: { membershipId: true } })
  return order?.membershipId ?? null
}

/** Stores (or refreshes) one browser for one membership. Idempotent per browser. */
export async function savePushSubscription(membershipId: string, sub: ParsedPushSubscription, deviceLabel: string): Promise<PushDevice> {
  const row = await prisma.customerPushSubscription.upsert({
    where: { membershipId_endpoint: { membershipId, endpoint: sub.endpoint } },
    create: { membershipId, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, deviceLabel },
    // A browser can rotate its keys for the same endpoint; keep the newest.
    update: { p256dh: sub.p256dh, auth: sub.auth, deviceLabel },
    select: { id: true, deviceLabel: true, createdAt: true },
  })
  return row
}

/** The browsers switched on for this membership — labels and dates only, never endpoints or keys. */
export async function listPushDevices(membershipId: string): Promise<PushDevice[]> {
  return prisma.customerPushSubscription.findMany({
    where: { membershipId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, deviceLabel: true, createdAt: true },
  })
}

/** The customer switched this browser off at this shop. Returns how many rows went (0 when it was never on). */
export async function removePushSubscription(membershipId: string, endpoint: string): Promise<number> {
  const r = await prisma.customerPushSubscription.deleteMany({ where: { membershipId, endpoint } })
  return r.count
}

/** The customer switched everything off at this shop (all their browsers). */
export async function removeAllPushSubscriptions(membershipId: string): Promise<number> {
  const r = await prisma.customerPushSubscription.deleteMany({ where: { membershipId } })
  return r.count
}

/** The push service said this browser is gone (404/410): forget it everywhere, at every shop. */
export async function forgetDeadEndpoint(endpoint: string): Promise<number> {
  const r = await prisma.customerPushSubscription.deleteMany({ where: { endpoint } })
  return r.count
}

export interface DeliverablePushSubscription extends ParsedPushSubscription {
  id: string
}

/** Everything needed to send to this membership's browsers — for the provider only, never for a page. */
export async function pushSubscriptionsForMembership(membershipId: string): Promise<DeliverablePushSubscription[]> {
  return prisma.customerPushSubscription.findMany({
    where: { membershipId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  })
}

/** Marks a successful send, so a stale-looking row is distinguishable from a live one. */
export async function markPushSent(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await prisma.customerPushSubscription.updateMany({ where: { id: { in: ids } }, data: { lastSentAt: new Date() } })
}
