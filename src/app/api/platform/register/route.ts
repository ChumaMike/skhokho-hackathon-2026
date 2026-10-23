import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { registerCustomer } from '@/modules/customers/customer.service'
import { checkRateLimits, clientIp, honeypotTripped, HONEYPOT_FIELD, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/**
 * Customer self-registration at a business. Records layered consent:
 *  - loyalty_program (per-business) — recorded by the register_customer RPC
 *  - marketing (per-business, per-channel) — if opted in
 *  - cross_business_link (platform scope) — if opted in. CAPTURED here, but the
 *    cross-business layer stays DARK behind a flag until POPIA s57 authorisation.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const slug = (form.get('slug') ?? '').toString()
  const phone = (form.get('phone') ?? '').toString().trim()
  const name = (form.get('name') ?? '').toString().trim()

  const back = (err: string) => NextResponse.redirect(new URL(`/r/${slug}?err=${encodeURIComponent(err)}`, req.url), 303)

  if (honeypotTripped(form.get(HONEYPOT_FIELD))) return back('Something went wrong. Try again.')
  const limited = await checkRateLimits([['customerRegisterIp', clientIp(req)], ['customerRegisterPhone', phone ? `${slug}:${phone}` : null]])
  if (!limited.allowed) return back(RATE_LIMITED_MESSAGE)

  const business = await prisma.business.findUnique({ where: { slug }, select: { id: true } })
  if (!business) return back('That business could not be found.')

  try {
    // B6: this public form can't prove the person owns the phone number, so
    // it only joins the loyalty programme (the RPC records that consent).
    // Marketing consent is recorded only where ownership can be confirmed —
    // in person, by staff ("Add a customer"), or later via OTP. Cross-business
    // linking stays switched off until its s57 authorisation.
    const reg = await registerCustomer(business.id, phone, name || undefined, 'customer_registration')
    return NextResponse.redirect(new URL(`/r/${slug}?${new URLSearchParams({ code: reg.short_code }).toString()}`, req.url), 303)
  } catch (e) {
    return back((e as Error).message || 'Could not register. Check the number and try again.')
  }
}
