import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { hashPassword, signToken, sessionCookieOptions, COOKIE_NAME } from '@/modules/auth/auth.service'
import { createBusiness } from '@/modules/tenant/tenant.service'
import { checkRateLimits, clientIp, honeypotTripped, HONEYPOT_FIELD, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const CATEGORIES = new Set([
  'SALON', 'FOOD_VENDOR', 'CAR_WASH', 'RETAIL_STORE', 'TUCK_SHOP', 'MECHANIC',
  'HAIR_BRAIDER', 'NAIL_TECHNICIAN', 'EVENTS', 'CHILDCARE', 'LAUNDRY', 'OTHER',
])

/** Owner onboarding: creates an AppUser (OWNER) + a Business (+ owner staff). */
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const get = (k: string) => (form.get(k) ?? '').toString().trim()

  const name = get('name')
  const category = get('category')
  const description = get('description')
  const firstName = get('firstName')
  const lastName = get('lastName')
  const email = get('email').toLowerCase()
  const phone = get('phone')
  const password = get('password')

  const back = (err: string) => NextResponse.redirect(new URL(`/join?err=${encodeURIComponent(err)}`, req.url), 303)

  // Bots fill the hidden field; people never see it.
  if (honeypotTripped(form.get(HONEYPOT_FIELD))) return back('Something went wrong. Try again.')
  const limited = await checkRateLimits([['signupIp', clientIp(req)]])
  if (!limited.allowed) return back(RATE_LIMITED_MESSAGE)

  if (!name || name.length < 2) return back('Enter your business name.')
  if (!CATEGORIES.has(category)) return back('Pick a business type.')
  if (!firstName || !lastName) return back('Enter your name.')
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return back('Enter a valid email.')
  if (password.length < 8) return back('Password must be at least 8 characters.')

  const existing = await prisma.appUser.findUnique({ where: { email } })
  if (existing) return back('That email is already registered.')

  const passwordHash = await hashPassword(password)

  // Created outside try so the catch block below can see it for cleanup —
  // AppUser creation and createBusiness (its own separate transaction) are
  // NOT atomic with each other. Reproduced live: createBusiness's
  // transaction can fail (it did, repeatedly, on P2028 against a real
  // Neon database — see tenant.service.ts's timeout comment) after the
  // AppUser row already committed, permanently orphaning it — every retry
  // with the same email then failed at the `existing` check above with no
  // way forward. Deleting the orphan on any failure below restores "retry
  // with the same email works" as an invariant, rather than a real fix
  // for the underlying non-atomicity (that would need createBusiness to
  // accept an existing Prisma transaction client instead of always
  // opening its own — out of scope for this fix).
  let appUser: { id: string } | undefined
  try {
    appUser = await prisma.appUser.create({
      data: { email, passwordHash, role: 'OWNER', emailVerifiedAt: new Date() },
    })

    const { business } = await createBusiness({
      name,
      category: category as never,
      description: description || undefined,
      email,
      phone: phone || undefined,
      owner: { firstName, lastName, email, passwordHash, phone: phone || undefined },
    })

    await prisma.business.update({ where: { id: business.id }, data: { ownerUserId: appUser.id } })

    // Registration used to leave the owner logged out, landing them on a
    // customer-facing success card with no path to their own dashboard —
    // their very first action after creating a business was an unexplained
    // second login with the same credentials they just typed. Sign them in
    // immediately instead, matching /api/platform/login's token shape
    // exactly (a StaffToken with isOwner: true — see that route's comment
    // for why there's no separate "owner" token type).
    const token = await signToken({
      type: 'staff',
      staffId: appUser.id,
      tenantId: business.id,
      email,
      isOwner: true,
    })

    const res = NextResponse.redirect(new URL('/dashboard', req.url), 303)
    res.cookies.set(COOKIE_NAME.staff, token, sessionCookieOptions('staff'))
    return res
  } catch (e) {
    console.error('[join] error:', e)
    if (appUser) {
      await prisma.appUser.delete({ where: { id: appUser.id } }).catch((cleanupError) => {
        console.error('[join] failed to clean up orphaned AppUser:', cleanupError)
      })
    }
    return back('Something went wrong creating your business. Try again.')
  }
}
