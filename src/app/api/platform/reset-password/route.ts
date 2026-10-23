import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { getAppUrl } from '@/lib/utils'
import { hashPassword, hashToken } from '@/modules/auth/auth.service'
import { checkRateLimits, clientIp, RATE_LIMITED_MESSAGE } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const token = (form.get('token') ?? '').toString()
  const password = (form.get('password') ?? '').toString()
  const origin = getAppUrl(new URL(req.url).origin)

  const back = (err: string) =>
    NextResponse.redirect(
      `${origin}/reset-password?token=${encodeURIComponent(token)}&err=${encodeURIComponent(err)}`,
      303,
    )

  if (!token) return back('That reset link is invalid.')

  const limited = await checkRateLimits([['tokenUseIp', clientIp(req)]])
  if (!limited.allowed) return back(RATE_LIMITED_MESSAGE)

  const appUser = await prisma.appUser.findFirst({ where: { resetToken: hashToken(token) } })
  if (!appUser || !appUser.resetTokenExpiry || appUser.resetTokenExpiry.getTime() < Date.now()) {
    return back('That reset link has expired. Request a new one.')
  }

  let passwordHash: string
  try {
    passwordHash = await hashPassword(password)
  } catch (e) {
    return back((e as Error).message || 'Choose a password of at least 8 characters.')
  }

  await prisma.appUser.update({
    where: { id: appUser.id },
    data: { passwordHash, resetToken: null, resetTokenExpiry: null },
  })

  return NextResponse.redirect(`${origin}/login?reset=1`, 303)
}
