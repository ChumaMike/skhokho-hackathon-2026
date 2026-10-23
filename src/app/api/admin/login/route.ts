import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { verifyPassword, signToken, sessionCookieOptions, COOKIE_NAME } from '@/modules/auth/auth.service'
import { checkRateLimits, clientIp, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'
import { ensurePlatformAdmin } from '@/modules/platform-admin/mfa.service'
import { securityEvent } from '@/modules/platform-admin/audit'
import { clearAdminCookies } from '@/modules/platform-admin/session'

export const runtime = 'nodejs'

/**
 * Platform admin sign-in, step 1 of 2 (AppUser role ADMIN only). A correct
 * password issues ONLY the short-lived MFA-pending session; the real admin
 * session is issued after TOTP (/api/admin/mfa/*). `/admin-login` and
 * `/admin-mfa` exist on both the platform and the admin host.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const email = String(form.get('email') ?? '').trim().toLowerCase()
  const password = String(form.get('password') ?? '')
  const ip = clientIp(req)
  const requestId = req.headers.get('x-request-id')
  const back = (err: string) => {
    const res = NextResponse.redirect(new URL(`/admin-login?err=${encodeURIComponent(err)}`, req.url), 303)
    clearAdminCookies(res)
    return res
  }
  if (!email || !password) return back('Enter your email and password.')
  const limited = await checkRateLimits([['loginIp', ip], ['loginAccount', `admin:${email}`]])
  if (!limited.allowed) return back(RATE_LIMITED_MESSAGE)

  try {
    const user = await prisma.appUser.findUnique({ where: { email }, select: { id: true, email: true, role: true, passwordHash: true, isActive: true } })
    if (!user || user.role !== 'ADMIN' || !user.isActive || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
      // The address is kept only as a one-way hash (enough to spot one account being targeted).
      await securityEvent('admin_login_failed', {
        outcome: 'DENIED',
        actor: { type: 'anonymous' },
        metadata: { subject: createHash('sha256').update(`admin-login:${email}`).digest('hex').slice(0, 16) },
        ip,
        requestId,
      })
      return back('Email or password is wrong.')
    }
    const admin = await ensurePlatformAdmin(user.id)
    const pending = await signToken({ type: 'admin_mfa', adminId: user.id, email: user.email, epoch: admin.sessionEpoch })
    const res = NextResponse.redirect(new URL('/admin-mfa', req.url), 303)
    clearAdminCookies(res)
    res.cookies.set(COOKIE_NAME.admin_mfa, pending, sessionCookieOptions('admin_mfa'))
    await prisma.appUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    return res
  } catch (e) {
    console.error('[admin/login] error:', e instanceof Error ? e.message : e)
    return back('Something went wrong. Try again.')
  }
}
