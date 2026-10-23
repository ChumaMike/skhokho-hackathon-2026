import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma/client'
import { getCustomerSession } from '@/lib/auth/guards'
import { checkRateLimits, clientIp, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'
import { hostTenantConflict } from '@/lib/tenant/storefront-request'
import { isWebPushConfigured } from '@/lib/messaging/webpush-config'
import { deviceLabelFrom, membershipIdForClaim, parsePushSubscription, savePushSubscription, type PushOwnerClaim } from '@/modules/customers/push-subscriptions.service'

export const runtime = 'nodejs'

const Body = z.object({
  businessId: z.string().uuid(),
  /** The order this browser just placed — the way a customer who isn't signed in is recognised. */
  orderId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullable().optional(),
  subscription: z.unknown(),
})

/**
 * "Yes, tell me about my orders on this phone": stores the browser's push
 * subscription against the customer's membership at THIS shop. Who the
 * customer is comes from the signed-in session, or failing that from the
 * order id the browser was just handed at checkout. Either way the row is
 * tied to a membership, never to customers.id, and an order id from another
 * shop is refused. Hidden entirely when Web Push isn't configured.
 */
export async function POST(req: NextRequest) {
  if (!isWebPushConfigured()) return NextResponse.json({ ok: false, code: 'UNAVAILABLE', message: 'Order updates on this phone are not available right now.' }, { status: 404 })

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
  const subscription = parsePushSubscription(parsed.data.subscription)
  if (!subscription) return NextResponse.json({ ok: false, code: 'INVALID_SUBSCRIPTION', message: "This phone didn't give us a usable subscription." }, { status: 400 })

  if (await hostTenantConflict(req, parsed.data.businessId)) {
    return NextResponse.json({ ok: false, code: 'BUSINESS_UNAVAILABLE', message: 'This shop is not available right now.' })
  }
  const business = await prisma.business.findFirst({ where: { id: parsed.data.businessId, status: 'ACTIVE' }, select: { id: true } })
  if (!business) return NextResponse.json({ ok: false, code: 'BUSINESS_UNAVAILABLE', message: 'This shop is not available right now.' })

  const session = await getCustomerSession()
  const claim: PushOwnerClaim | null = session ? { session } : parsed.data.orderId ? { orderId: parsed.data.orderId } : null
  if (!claim) return NextResponse.json({ ok: false, code: 'SIGNED_OUT', message: 'Sign in, or place an order, and we can set this up.' }, { status: 401 })

  const membershipId = await membershipIdForClaim(business.id, claim)
  if (!membershipId) {
    return NextResponse.json({ ok: false, code: 'NO_MEMBERSHIP', message: "You haven't ordered here yet, so there's nothing to update you about." })
  }

  try {
    const device = await savePushSubscription(membershipId, subscription, deviceLabelFrom(req.headers.get('user-agent')))
    return NextResponse.json({ ok: true, deviceLabel: device.deviceLabel })
  } catch {
    return NextResponse.json({ ok: false, code: 'SAVE_FAILED', message: "That didn't work right now. Your updates still come by text or email." })
  }
}
