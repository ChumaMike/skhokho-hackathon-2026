import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma/client'
import { getCustomerSession } from '@/lib/auth/guards'
import { checkRateLimits, clientIp, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'
import { hostTenantConflict } from '@/lib/tenant/storefront-request'
import { membershipIdForClaim, removeAllPushSubscriptions, removePushSubscription, type PushOwnerClaim } from '@/modules/customers/push-subscriptions.service'

export const runtime = 'nodejs'

const Body = z.object({
  businessId: z.string().uuid(),
  /** The browser's own endpoint: switch off THIS phone. Omitted: switch off every browser at this shop. */
  endpoint: z.string().url().max(2048).optional(),
  /** The order this browser placed — recognises a customer who isn't signed in (same claim as subscribing). */
  orderId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullable().optional(),
})

/**
 * "Switch off order updates" — for this browser, or for every browser the
 * customer switched on at THIS shop. The same claim as subscribing (the
 * signed-in session, or the order id this browser placed) finds the
 * membership, so nobody can switch off someone else's updates. Works even
 * when Web Push is no longer configured: a customer must always be able to
 * stop it.
 */
export async function POST(req: NextRequest) {
  const limited = await checkRateLimits([['customerActionIp', clientIp(req)]])
  if (!limited.allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMITED', message: RATE_LIMITED_MESSAGE }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, code: 'INVALID_REQUEST', message: 'Malformed request.' }, { status: 400 })
  }
  const parsed = Body.safeParse(body)
  if (!parsed.success) return NextResponse.json({ ok: false, code: 'INVALID_REQUEST', message: 'Malformed request.' }, { status: 400 })

  if (await hostTenantConflict(req, parsed.data.businessId)) {
    return NextResponse.json({ ok: false, code: 'BUSINESS_UNAVAILABLE', message: 'This shop is not available right now.' })
  }
  const business = await prisma.business.findFirst({ where: { id: parsed.data.businessId }, select: { id: true } })
  if (!business) return NextResponse.json({ ok: false, code: 'BUSINESS_UNAVAILABLE', message: 'This shop is not available right now.' })

  const session = await getCustomerSession()
  const claim: PushOwnerClaim | null = session ? { session } : parsed.data.orderId ? { orderId: parsed.data.orderId } : null
  if (!claim) return NextResponse.json({ ok: false, code: 'SIGNED_OUT', message: 'Sign in to change this.' }, { status: 401 })

  const membershipId = await membershipIdForClaim(business.id, claim)
  // Nothing to switch off is the same outcome as switching off: say so, don't error.
  if (!membershipId) return NextResponse.json({ ok: true, removed: 0 })

  try {
    const removed = parsed.data.endpoint ? await removePushSubscription(membershipId, parsed.data.endpoint) : await removeAllPushSubscriptions(membershipId)
    return NextResponse.json({ ok: true, removed })
  } catch {
    return NextResponse.json({ ok: false, code: 'REMOVE_FAILED', message: "That didn't work right now. Try again in a moment." })
  }
}
