import { NextRequest, NextResponse, after } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { safeReturnPath } from '@/lib/utils'
import { sendEmail, newBookingEmail, customerBookingConfirmationEmail } from '@/lib/email'
import { registerCustomer } from '@/modules/customers/customer.service'
import { getActiveService } from '@/modules/catalog/catalog.service'
import { createAppointment, AppointmentConflictError } from '@/modules/appointments/appointment.service'
import { BookingRefusedError } from '@/modules/appointments/booking-rules'
import { hostTenantConflict } from '@/lib/tenant/storefront-request'
import { countServerEvent } from '@/modules/storefront-learning/events'
import { checkRateLimits, clientIp, honeypotTripped, HONEYPOT_FIELD, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'
import { isCurrentTermsVersion, TERMS_OUTDATED_MESSAGE } from '@/lib/legal/documents'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const businessId = (form.get('businessId') ?? '').toString()
  const serviceId = (form.get('serviceId') ?? '').toString()
  const phone = (form.get('phone') ?? '').toString().trim()
  const startTimeRaw = (form.get('startTime') ?? '').toString()
  const returnTo = safeReturnPath((form.get('returnTo') ?? '/').toString())
  const email = (form.get('email') ?? '').toString().trim()
  const consent = form.get('consent') === 'on'
  // Posted by ConsentFields as a hidden field: the Terms version shown next
  // to the checkbox. Must be the current one (see /api/store/checkout).
  const termsVersion = (form.get('termsVersion') ?? '').toString().trim().slice(0, 40)

  const back = (err: string) =>
    NextResponse.redirect(new URL(`${returnTo}?err=${encodeURIComponent(err)}`, req.url), 303)

  if (honeypotTripped(form.get(HONEYPOT_FIELD))) return back('Something went wrong. Try again.')
  const limited = await checkRateLimits([['bookingIp', clientIp(req)]])
  if (!limited.allowed) return back(RATE_LIMITED_MESSAGE)

  if (!consent) return back('Please accept the terms to continue.')
  if (!isCurrentTermsVersion(termsVersion)) return back(TERMS_OUTDATED_MESSAGE)
  // A tenant hostname may only act on its own business (storefront-request.ts).
  if (await hostTenantConflict(req, businessId)) return back('That service is no longer available.')

  const service = await getActiveService(businessId, serviceId)
  if (!service) return back('That service is no longer available.')

  const startTime = new Date(startTimeRaw)
  if (Number.isNaN(startTime.getTime())) return back('Choose a valid date and time.')

  try {
    // B6: a public form can't prove phone ownership — no email is attached to
    // the customer's identity and no marketing consent is recorded here.
    const reg = await registerCustomer(businessId, phone, undefined, 'storefront_booking')

    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM memberships WHERE public_id = ${reg.public_id}::uuid LIMIT 1`
    const membershipId = rows[0]?.id
    if (!membershipId) return back('Could not book that slot. Try again.')

    const appointment = await createAppointment(businessId, {
      membershipId,
      serviceId: service.id,
      startTime,
      // Verified current above — recorded as what this customer accepted.
      termsVersion,
    })

    const serviceName = appointment?.service?.name ?? service.name
    after(() => countServerEvent(businessId, 'BOOKING_SUBMITTED', 'HOME'))
    after(() => notifyOwnerOfBooking(businessId, serviceName, startTime))
    // Confirmation goes only to the address typed for THIS booking.
    after(() => notifyCustomerOfBooking(businessId, confirmationEmail(email), serviceName, startTime))

    return NextResponse.redirect(new URL(`${returnTo}?ok=booking`, req.url), 303)
  } catch (e) {
    if (e instanceof AppointmentConflictError) return back(e.message)
    if (e instanceof BookingRefusedError) return back(e.message)
    return back((e as Error).message || 'Could not book that slot. Check the number and try again.')
  }
}

async function notifyOwnerOfBooking(businessId: string, serviceName: string, startTime: Date) {
  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { name: true, owner: { select: { email: true } } },
    })
    if (!business?.owner?.email) return

    const { subject, html } = newBookingEmail({
      businessName: business.name,
      serviceName,
      whenFormatted: startTime.toLocaleString('en-ZA', {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      }),
    })
    await sendEmail({ to: business.owner.email, subject, html, kind: 'owner_new_booking' })
  } catch (e) {
    console.error('[store/book] owner notification failed:', e)
  }
}

/** Only sends if the customer ever supplied an email — silently does nothing otherwise, same as notifyCustomerOfOrder in store/order/route.ts. */
/** A plausible email typed on this form, or null. Never read from a stored identity. */
function confirmationEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

async function notifyCustomerOfBooking(businessId: string, email: string | null, serviceName: string, startTime: Date) {
  try {
    if (!email) return

    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true } })
    if (!business) return

    const { subject, html } = customerBookingConfirmationEmail({
      businessName: business.name,
      serviceName,
      whenFormatted: startTime.toLocaleString('en-ZA', {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      }),
    })
    await sendEmail({ to: email, subject, html, kind: 'customer_booking_confirmation' })
  } catch (e) {
    console.error('[store/book] customer confirmation failed:', e)
  }
}
