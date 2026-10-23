import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { verifyPassword, signToken, sessionCookieOptions, COOKIE_NAME } from '@/modules/auth/auth.service'
import { checkRateLimits, clientIp, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/**
 * Team-member login — separate from /api/platform/login (which is
 * AppUser/owner-only) because a real BusinessStaff member authenticates
 * against a different table entirely. Signs the same `StaffToken` shape
 * the owner gets, with `staffId` now a real `BusinessStaff.id` and
 * `isOwner: false` (owner rows are refused here — owners use /login) —
 * `requireStaff()` doesn't care which table `staffId`
 * came from (it never looks it up), so every existing /dashboard/* page
 * accepts this session exactly like an owner's. Only pages guarded by
 * `requireOwnerOnlySession` (src/app/dashboard/session.ts) tell the two
 * apart. See that file and the tool-graduation record for the open gap
 * this leaves: no action anywhere yet checks a team member's actual role
 * permissions.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const businessSlug = (form.get('business') ?? '').toString().trim().toLowerCase()
  const email = (form.get('email') ?? '').toString().trim().toLowerCase()
  const password = (form.get('password') ?? '').toString()

  const back = (err: string) =>
    NextResponse.redirect(
      new URL(`/staff-login?business=${encodeURIComponent(businessSlug)}&err=${encodeURIComponent(err)}`, req.url),
      303,
    )

  if (!businessSlug || !email || !password) return back('Enter your business, email and password.')

  // Brute-force guard: per IP and per (business, account), shared across instances.
  const limited = await checkRateLimits([['loginIp', clientIp(req)], ['loginAccount', `staff:${businessSlug}:${email}`]])
  if (!limited.allowed) return back(RATE_LIMITED_MESSAGE)

  try {
    // `email` is unique per business (`@@unique([businessId, email])`), not
    // globally — the same person could be staff at two businesses with one
    // email. The business slug (what the merchant's own storefront URL
    // already uses) resolves which BusinessStaff row this login means,
    // via the compound unique key, rather than a bare email lookup that
    // could match the wrong business's staff row.
    const business = await prisma.business.findUnique({ where: { slug: businessSlug } })
    if (!business) return back('Email or password is wrong.')

    const staff = await prisma.businessStaff.findUnique({
      where: { businessId_email: { businessId: business.id, email } },
    })
    if (!staff || !staff.isActive) return back('Email or password is wrong.')
    // Owners sign in at /login (AppUser), whose password is the one a reset
    // changes. Their BusinessStaff row only carries their role in the team —
    // it is never a second way in, so an old or leaked owner password can't
    // produce an owner session here after a reset. Same generic message: this
    // route never confirms which accounts exist.
    if (staff.isOwner) return back('Email or password is wrong.')

    const valid = await verifyPassword(password, staff.passwordHash)
    if (!valid) return back('Email or password is wrong.')

    const token = await signToken({
      type: 'staff',
      staffId: staff.id,
      tenantId: staff.businessId,
      email: staff.email,
      isOwner: false,
    })

    await prisma.businessStaff.update({ where: { id: staff.id }, data: { lastLoginAt: new Date() } })

    const res = NextResponse.redirect(new URL('/dashboard', req.url), 303)
    res.cookies.set(COOKIE_NAME.staff, token, sessionCookieOptions('staff'))
    return res
  } catch (e) {
    console.error('[staff-login] error:', e)
    return back('Something went wrong. Try again.')
  }
}
