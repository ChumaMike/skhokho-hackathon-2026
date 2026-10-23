import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { verifyPassword, signToken, sessionCookieOptions, COOKIE_NAME } from '@/modules/auth/auth.service'
import { checkRateLimits, clientIp, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/** Drivers sign in with their Skhokho account; a driver profile is what makes it a driver session. */
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const email = String(form.get('email') ?? '').trim().toLowerCase()
  const password = String(form.get('password') ?? '')
  const back = (err: string) => NextResponse.redirect(new URL(`/driver/login?err=${encodeURIComponent(err)}`, req.url), 303)
  if (!email || !password) return back('Enter your email and password.')

  const limited = await checkRateLimits([['loginIp', clientIp(req)], ['loginAccount', `driver:${email}`]])
  if (!limited.allowed) return back(RATE_LIMITED_MESSAGE)

  try {
    const user = await prisma.appUser.findUnique({ where: { email }, select: { id: true, email: true, passwordHash: true, isActive: true, driverProfile: { select: { id: true } } } })
    if (!user || !user.passwordHash || !user.isActive || !(await verifyPassword(password, user.passwordHash))) return back('Email or password is wrong.')
    if (!user.driverProfile) return back("This account doesn't drive yet — sign up to drive from your account first.")
    const token = await signToken({ type: 'driver', userId: user.id, driverId: user.driverProfile.id, email: user.email })
    const res = NextResponse.redirect(new URL('/driver', req.url), 303)
    res.cookies.set(COOKIE_NAME.driver, token, sessionCookieOptions('driver'))
    return res
  } catch (e) {
    console.error('[driver/login] error:', e instanceof Error ? e.message : e)
    return back('Something went wrong. Try again.')
  }
}
