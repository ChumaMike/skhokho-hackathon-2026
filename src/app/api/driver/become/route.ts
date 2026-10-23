import { NextRequest, NextResponse } from 'next/server'
import { requireOwner, AuthError } from '@/lib/auth/guards'
import { prisma } from '@/lib/prisma/client'
import { signToken, sessionCookieOptions, COOKIE_NAME } from '@/modules/auth/auth.service'
import { becomeDriver, DriverError } from '@/modules/skhokholetha/driver.service'
import { FeatureDisabledError, lethaEnabled } from '@/modules/skhokholetha/flags'

export const runtime = 'nodejs'

/** A signed-in business owner adds driving to their existing Skhokho account (no second user). */
export async function POST(req: NextRequest) {
  const back = (err: string) => NextResponse.redirect(new URL(`/driver/join?err=${encodeURIComponent(err)}`, req.url), 303)
  if (!lethaEnabled('driverSignup')) return back(new FeatureDisabledError('driverSignup').message)
  try {
    const owner = await requireOwner()
    const form = await req.formData()
    const user = await prisma.appUser.findUniqueOrThrow({ where: { id: owner.staffId }, select: { id: true, email: true } })
    const driverId = await becomeDriver(user.id, { displayName: String(form.get('displayName') ?? ''), phone: String(form.get('phone') ?? '') })
    const token = await signToken({ type: 'driver', userId: user.id, driverId, email: user.email })
    const res = NextResponse.redirect(new URL('/driver', req.url), 303)
    res.cookies.set(COOKIE_NAME.driver, token, sessionCookieOptions('driver'))
    return res
  } catch (e) {
    if (e instanceof AuthError) return back('Sign in to your business account first.')
    if (e instanceof DriverError || e instanceof FeatureDisabledError) return back(e.message)
    console.error('[driver/become] error:', e instanceof Error ? e.message : e)
    return back('Something went wrong. Try again.')
  }
}
