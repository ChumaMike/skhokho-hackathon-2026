import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkRateLimits, clientIp, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'
import { customerSessionCookie, parseLoginIdentifier, verifyLoginCode, type VerifyFailure } from '@/modules/customers/customer-auth.service'

export const runtime = 'nodejs'

const Body = z.object({
  identifier: z.string().trim().min(1).max(254),
  code: z.string().trim().min(1).max(12),
})

const FAILURE_MESSAGE: Record<VerifyFailure, string> = {
  NONE: 'Ask for a new code first.',
  EXPIRED: 'That code has expired. Ask for a new one.',
  LOCKED: 'Too many wrong tries. Ask for a new code.',
  INVALID: "That code isn't right. Check it and try again.",
}

/** Step 2 of customer sign-in: the code comes back, the session cookie goes out. */
export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, code: 'INVALID_REQUEST', message: 'Malformed request.' }, { status: 400 })
  }
  const parsed = Body.safeParse(body)
  if (!parsed.success) return NextResponse.json({ ok: false, code: 'INVALID_REQUEST', message: 'Enter the code we sent you.' }, { status: 400 })

  const id = parseLoginIdentifier(parsed.data.identifier)
  if (!id) return NextResponse.json({ ok: false, code: 'INVALID_IDENTIFIER', message: 'Enter the same number or email you asked the code for.' })

  const limited = await checkRateLimits([
    ['customerVerifyIp', clientIp(req)],
    ['customerVerifyIdentifier', id.identifier],
  ])
  if (!limited.allowed) {
    return NextResponse.json({ ok: false, code: 'RATE_LIMITED', message: RATE_LIMITED_MESSAGE }, { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } })
  }

  const result = await verifyLoginCode(id, parsed.data.code, { ip: clientIp(req) })
  if (!result.ok) return NextResponse.json({ ok: false, code: result.reason, message: FAILURE_MESSAGE[result.reason] })

  const cookie = customerSessionCookie()
  const res = NextResponse.json({ ok: true, channel: id.channel })
  res.cookies.set(cookie.name, result.token, cookie.options)
  return res
}
