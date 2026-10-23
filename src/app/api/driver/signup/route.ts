import { NextRequest, NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { signToken, sessionCookieOptions, COOKIE_NAME } from '@/modules/auth/auth.service'
import { signUpDriver, DriverError } from '@/modules/skhokholetha/driver.service'
import { FeatureDisabledError, lethaEnabled } from '@/modules/skhokholetha/flags'
import { checkRateLimits, clientIp, honeypotTripped, HONEYPOT_FIELD, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'
import { sendEmail, driverVerifyEmail } from '@/lib/email'
import { getAppUrl } from '@/lib/utils'

export const runtime = 'nodejs'

/** A new person signs up to drive: AppUser (role DRIVER) + DRAFT driver profile, then email confirmation. */
export async function POST(req: NextRequest) {
  const back = (err: string) => NextResponse.redirect(new URL(`/driver/join?err=${encodeURIComponent(err)}`, req.url), 303)
  // Checked before reading anything; signUpDriver checks again (defence in depth).
  if (!lethaEnabled('driverSignup')) return back(new FeatureDisabledError('driverSignup').message)
  const form = await req.formData()
  if (honeypotTripped(form.get(HONEYPOT_FIELD))) return back('Something went wrong. Try again.')
  const limited = await checkRateLimits([['driverSignupIp', clientIp(req)]])
  if (!limited.allowed) return back(RATE_LIMITED_MESSAGE)

  try {
    const created = await signUpDriver({
      firstName: String(form.get('firstName') ?? ''),
      lastName: String(form.get('lastName') ?? ''),
      email: String(form.get('email') ?? ''),
      phone: String(form.get('phone') ?? ''),
      password: String(form.get('password') ?? ''),
    })
    const verifyUrl = `${getAppUrl(new URL(req.url).origin)}/api/driver/verify-email?token=${created.verifyToken}`
    const { subject, html, text } = driverVerifyEmail({ verifyUrl })
    await sendEmail({ to: created.email, subject, html, text, kind: 'driver_verify' })

    const token = await signToken({ type: 'driver', userId: created.userId, driverId: created.driverId, email: created.email })
    const res = NextResponse.redirect(new URL('/driver?welcome=1', req.url), 303)
    res.cookies.set(COOKIE_NAME.driver, token, sessionCookieOptions('driver'))
    return res
  } catch (e) {
    if (e instanceof DriverError || e instanceof FeatureDisabledError) return back(e.message)
    if (e instanceof ZodError) return back('Check your details: name, a valid email, a cellphone number and a password of 8+ characters.')
    console.error('[driver/signup] error:', e instanceof Error ? e.message : e)
    return back('Something went wrong. Try again.')
  }
}
