import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { verifyPassword, signToken, sessionCookieOptions, COOKIE_NAME } from '@/modules/auth/auth.service'
import { checkRateLimits, clientIp, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/**
 * Business-owner login.
 *
 * Auth for this platform is credential-based via `AppUser` (see the model
 * comment in prisma/schema.prisma: "Business owners, field agents, internal
 * staff and platform admins log in here"). A business owner's `AppUser` row
 * has `role: 'OWNER'` and is linked to exactly one `Business` via
 * `Business.ownerUserId` (set by /api/platform/join at registration).
 *
 * Of the three TokenPayload members in auth.service, `StaffToken` is the one
 * shaped for a session that acts on a single business — `staffId`, `tenantId`,
 * `email`, `isOwner`. There is no dedicated "owner" token type, and
 * `PlatformAdminToken`/`PlatformUserToken` are for different actors entirely
 * (platform staff / WhatsApp-OTP customers), so a business owner signs in as
 * a StaffToken with `isOwner: true` — the same flag `guards.ts`'s
 * `requireStaffPermission` already uses to let an owner bypass permission
 * checks. `staffId` here is the `AppUser.id`, not a `BusinessStaff.id`; the
 * guard this app uses (`requireStaff`) only checks `payload.type` and,
 * optionally, `payload.tenantId` — it never looks `staffId` up against
 * `BusinessStaff`, so this is safe.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const email = (form.get('email') ?? '').toString().trim().toLowerCase()
  const password = (form.get('password') ?? '').toString()

  const back = (err: string) =>
    NextResponse.redirect(new URL(`/login?err=${encodeURIComponent(err)}`, req.url), 303)

  if (!email || !password) return back('Enter your email and password.')

  // Brute-force guard: per IP and per account, shared across instances.
  const limited = await checkRateLimits([['loginIp', clientIp(req)], ['loginAccount', `owner:${email}`]])
  if (!limited.allowed) return back(RATE_LIMITED_MESSAGE)

  try {
    const appUser = await prisma.appUser.findUnique({ where: { email } })
    if (!appUser || !appUser.passwordHash || !appUser.isActive) {
      return back('Email or password is wrong.')
    }
    if (appUser.role !== 'OWNER') {
      return back('This login is for business owners.')
    }

    const valid = await verifyPassword(password, appUser.passwordHash)
    if (!valid) return back('Email or password is wrong.')

    const business = await prisma.business.findFirst({ where: { ownerUserId: appUser.id } })
    if (!business) return back('No business is linked to this account yet.')

    const token = await signToken({
      type: 'staff',
      staffId: appUser.id,
      tenantId: business.id,
      email: appUser.email,
      isOwner: true,
    })

    await prisma.appUser.update({ where: { id: appUser.id }, data: { lastLoginAt: new Date() } })

    const res = NextResponse.redirect(new URL('/dashboard', req.url), 303)
    res.cookies.set(COOKIE_NAME.staff, token, sessionCookieOptions('staff'))
    return res
  } catch (e) {
    console.error('[login] error:', e)
    return back('Something went wrong. Try again.')
  }
}
