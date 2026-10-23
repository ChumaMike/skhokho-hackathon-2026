import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma/client'
import { checkRateLimits, clientIp, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'
import { hostTenantConflict } from '@/lib/tenant/storefront-request'
import { isPhoneMessagingConfigured } from '@/lib/messaging/provider'
import { issueLoginCode, parseLoginIdentifier } from '@/modules/customers/customer-auth.service'

export const runtime = 'nodejs'

const Body = z.object({
  /** What the customer typed: a phone number or an email address. */
  identifier: z.string().trim().min(1).max(254),
  /** The shop whose page the customer is on — only names the shop in the message. */
  businessId: z.string().uuid().optional(),
})

/**
 * Step 1 of customer sign-in: send a one-time code. Says nothing about
 * whether the number or address is known anywhere — there is no "account"
 * to enumerate, the code proves ownership of the identifier and that is all.
 */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, code: 'INVALID_REQUEST', message: 'Malformed request.' }, { status: 400 })
  }
  const parsed = Body.safeParse(body)
  if (!parsed.success) return NextResponse.json({ ok: false, code: 'INVALID_REQUEST', message: 'Enter your phone number or email.' }, { status: 400 })

  const id = parseLoginIdentifier(parsed.data.identifier)
  if (!id) {
    return NextResponse.json({ ok: false, code: 'INVALID_IDENTIFIER', message: 'Enter a valid South African mobile number (like 082 123 4567) or an email address.' })
  }

  const limited = await checkRateLimits([
    ['customerCodeIp', clientIp(req)],
    ['customerCodeIdentifier', id.identifier],
  ])
  if (!limited.allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMITED', message: RATE_LIMITED_MESSAGE }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } })
  }

  if (id.channel === 'phone' && !isPhoneMessagingConfigured()) {
    return NextResponse.json({ ok: false, code: 'PHONE_UNAVAILABLE', message: "We can't text codes right now. Sign in with your email address instead." })
  }

  let shopName: string | null = null
  if (parsed.data.businessId) {
    if (await hostTenantConflict(req, parsed.data.businessId)) {
      return NextResponse.json({ ok: false, code: 'BUSINESS_UNAVAILABLE', message: 'This shop is not available right now.' })
    }
    shopName = (await prisma.business.findFirst({ where: { id: parsed.data.businessId, status: 'ACTIVE' }, select: { name: true } }))?.name ?? null
  }

  const { delivery } = await issueLoginCode(id, { shopName, ip: clientIp(req) })
  if (delivery === 'none') {
    return NextResponse.json({
      ok: false,
      code: 'SEND_FAILED',
      message: id.channel === 'phone' ? "We couldn't send a code to that number right now. Try again in a moment, or use your email." : "We couldn't send the email right now. Please try again in a moment.",
    })
  }
  return NextResponse.json({ ok: true, delivery, channel: id.channel })
}
