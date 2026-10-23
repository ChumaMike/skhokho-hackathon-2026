import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { getAppUrl } from '@/lib/utils'
import { sendEmail, passwordResetEmail, isEmailConfigured } from '@/lib/email'
import { hashToken } from '@/modules/auth/auth.service'
import { checkRateLimits, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Request a password reset. Always redirects to the same "check your
 * email" confirmation regardless of whether the email exists — an
 * account-enumeration guard, not a formality: this is a public form.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const email = (form.get('email') ?? '').toString().trim().toLowerCase()

  // Branches on GLOBAL config, never on whether this particular email has an
  // account — that's what keeps this an enumeration guard rather than a
  // leak. If email delivery is unconfigured, EVERY submission (real account
  // or not) lands on the same "not available" page; the honest failure
  // state is visible to everyone equally, not just to real accounts.
  if (!isEmailConfigured()) {
    return NextResponse.redirect(new URL('/forgot-password?unavailable=1', req.url), 303)
  }

  const done = () => NextResponse.redirect(new URL('/forgot-password?sent=1', req.url), 303)

  if (!email) return done()

  // Limits inbox-bombing and enumeration probing. A limited request gets the
  // same "check your email" page as any other — it reveals nothing.
  const limited = await checkRateLimits([['recoveryIp', clientIp(req)], ['recoveryAccount', email]])
  if (!limited.allowed) return done()

  const appUser = await prisma.appUser.findUnique({ where: { email } })
  if (appUser && appUser.isActive && appUser.role === 'OWNER') {
    const token = crypto.randomBytes(32).toString('hex')
    await prisma.appUser.update({
      where: { id: appUser.id },
      data: { resetToken: hashToken(token), resetTokenExpiry: new Date(Date.now() + TOKEN_TTL_MS) },
    })

    const resetUrl = `${getAppUrl(new URL(req.url).origin)}/reset-password?token=${token}`
    const { subject, html, text } = passwordResetEmail({ resetUrl })
    await sendEmail({ to: appUser.email, subject, html, text, kind: 'password_reset' })
  }

  return done()
}
