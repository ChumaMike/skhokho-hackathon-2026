import { NextRequest, NextResponse } from 'next/server'
import { resolveStorefrontCartQuote, CartQuoteRequestSchema } from '@/modules/orders/storefront-cart'
import { hostTenantConflict } from '@/lib/tenant/storefront-request'
import { checkRateLimits, clientIp, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/**
 * Server-authoritative cart pricing — called on Basket view and on
 * checkout entry so the customer is always shown the CURRENT price/
 * availability, never a stale one carried in localStorage. This is the
 * same resolveStorefrontCartQuote the final checkout submission
 * re-validates against (see /api/store/checkout) — one pricing
 * computation, never duplicated between "show a quote" and "charge it."
 */
export async function POST(req: NextRequest) {
  const limited = await checkRateLimits([['quoteIp', clientIp(req)]])
  if (!limited.allowed) {
    return NextResponse.json(
      { ok: false, code: 'RATE_LIMITED', message: RATE_LIMITED_MESSAGE },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, code: 'INVALID_REQUEST', message: 'Malformed request.' }, { status: 400 })
  }

  const parsed = CartQuoteRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, code: 'INVALID_REQUEST', message: 'Malformed cart.' }, { status: 400 })
  }

  // A tenant hostname may only act on its own business (storefront-request.ts).
  if (await hostTenantConflict(req, parsed.data.businessId)) {
    return NextResponse.json({ ok: false, code: 'BUSINESS_UNAVAILABLE', message: 'This shop is not available right now.' })
  }

  // Always 200 — success/failure is the `ok` field, not the HTTP status,
  // so the client can render a plain-language structured error the same
  // way for every case (see instruction on cart errors).
  const result = await resolveStorefrontCartQuote(parsed.data)
  return NextResponse.json(result)
}
