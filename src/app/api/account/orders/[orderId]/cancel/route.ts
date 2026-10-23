import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCustomerSession } from '@/lib/auth/guards'
import { checkRateLimits, clientIp, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'
import { hostTenantConflict } from '@/lib/tenant/storefront-request'
import { findMembershipForSession } from '@/modules/customers/customer-account.service'
import { CANCEL_REASONS, cancelOrderAsCustomer, CustomerOrderError, MAX_CANCEL_NOTE_LENGTH } from '@/modules/customers/customer-orders.service'

export const runtime = 'nodejs'

const Body = z.object({
  businessId: z.string().uuid(),
  reason: z.enum(Object.keys(CANCEL_REASONS) as [keyof typeof CANCEL_REASONS, ...(keyof typeof CANCEL_REASONS)[]]),
  note: z.string().trim().max(MAX_CANCEL_NOTE_LENGTH).optional(),
})

/**
 * A signed-in customer cancels their own PENDING order at this business.
 * Ownership is the customer's membership at the shop, resolved from the
 * verified session — an order id alone is never enough.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await getCustomerSession()
  if (!session) return NextResponse.json({ ok: false, code: 'SIGNED_OUT', message: 'Sign in to manage your orders.' }, { status: 401 })

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
  if (!parsed.success) return NextResponse.json({ ok: false, code: 'INVALID_REQUEST', message: 'Choose a reason for cancelling.' }, { status: 400 })
  if (await hostTenantConflict(req, parsed.data.businessId)) {
    return NextResponse.json({ ok: false, code: 'BUSINESS_UNAVAILABLE', message: 'This shop is not available right now.' })
  }

  const membership = await findMembershipForSession(parsed.data.businessId, session)
  if (!membership) return NextResponse.json({ ok: false, code: 'NOT_FOUND', message: "We couldn't find that order." }, { status: 404 })

  const { orderId } = await params
  try {
    const result = await cancelOrderAsCustomer(parsed.data.businessId, membership.membershipId, orderId, parsed.data.reason, parsed.data.note)
    return NextResponse.json({ ok: true, orderNumber: result.orderNumber })
  } catch (e) {
    if (e instanceof CustomerOrderError) {
      return NextResponse.json({ ok: false, code: e.code, message: e.message }, { status: e.code === 'NOT_FOUND' ? 404 : 409 })
    }
    // cancelOrder's own refusals (a driver already has it) are worded for the merchant; give the customer the honest short version.
    return NextResponse.json({ ok: false, code: 'TOO_LATE', message: 'This order can no longer be cancelled here. Please contact the shop.' }, { status: 409 })
  }
}
