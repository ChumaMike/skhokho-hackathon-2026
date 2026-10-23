import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma/client'
import { getCustomerSession } from '@/lib/auth/guards'
import { checkRateLimits, clientIp, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'
import { hostTenantConflict } from '@/lib/tenant/storefront-request'
import { joinRewards } from '@/modules/customers/customer-account.service'

export const runtime = 'nodejs'

const Body = z.object({ businessId: z.string().uuid() })

/**
 * A signed-in customer starts a rewards card at THIS shop (Consent 1,
 * per-business loyalty — recorded by the identity RPC). Phone sessions only;
 * the number was verified by the sign-in code, so this is the OTP-confirmed
 * path the consent wording asks for.
 */
export async function POST(req: NextRequest) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ ok: false, code: 'SIGNED_OUT', message: 'Sign in to start a rewards card.' }, { status: 401 })
  if (session.channel !== 'phone') {
    return NextResponse.json({ ok: false, code: 'PHONE_REQUIRED', message: 'Sign in with your phone number to start a rewards card — stamps are kept against your number.' })
  }

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
  const business = await prisma.business.findFirst({ where: { id: parsed.data.businessId, status: 'ACTIVE' }, select: { id: true } })
  if (!business) return NextResponse.json({ ok: false, code: 'BUSINESS_UNAVAILABLE', message: 'This shop is not available right now.' })

  try {
    const membership = await joinRewards(business.id, session, clientIp(req))
    return NextResponse.json({ ok: true, shortCode: membership.shortCode })
  } catch (e) {
    return NextResponse.json({ ok: false, code: 'JOIN_FAILED', message: e instanceof Error ? e.message : 'Could not open your rewards card.' })
  }
}
