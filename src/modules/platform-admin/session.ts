/**
 * Issuing and reading platform-admin sessions around MFA.
 *
 *   admin_mfa cookie       password verified only; can enrol/verify MFA, nothing else
 *   platform_admin cookie  issued ONLY after a second factor, with mfa: true + epoch
 */

import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { signToken, verifyToken, sessionCookieOptions, COOKIE_NAME, type AdminMfaToken } from '@/modules/auth/auth.service'
import { AuthError } from '@/lib/auth/guards'
import { resolveHostname } from '@/lib/tenant/context'
import { adminPath } from '@/lib/tenant/admin-paths'

export async function onAdminHost(req: NextRequest): Promise<boolean> {
  return (await resolveHostname(req.headers.get('host') ?? '')).type === 'platform_admin'
}

/** The admin's home on whichever host they're using. */
export async function adminHome(req: NextRequest): Promise<string> {
  return adminPath('/', await onAdminHost(req))
}

/** The password-verified, MFA-pending session — still an active ADMIN, same epoch. */
export async function requireMfaPending(req: NextRequest): Promise<AdminMfaToken> {
  const raw = req.cookies.get(COOKIE_NAME.admin_mfa)?.value
  if (!raw) throw new AuthError('Sign in first.', 401)
  let token
  try {
    token = await verifyToken(raw)
  } catch {
    throw new AuthError('Sign in again.', 401)
  }
  if (token.type !== 'admin_mfa') throw new AuthError('Sign in again.', 401)
  const admin = await prisma.platformAdmin.findUnique({ where: { userId: token.adminId }, select: { sessionEpoch: true, user: { select: { role: true, isActive: true } } } })
  if (!admin || admin.user.role !== 'ADMIN' || !admin.user.isActive || admin.sessionEpoch !== token.epoch) throw new AuthError('Sign in again.', 401)
  return token
}

/** Sets the full admin session (after MFA) and removes the pending one. */
export async function issueAdminSession(res: NextResponse, admin: { adminId: string; email: string; epoch: number }) {
  const token = await signToken({ type: 'platform_admin', adminId: admin.adminId, platformId: 'skhokho', email: admin.email, mfa: true, epoch: admin.epoch })
  res.cookies.set(COOKIE_NAME.platform_admin, token, sessionCookieOptions('platform_admin'))
  res.cookies.set(COOKIE_NAME.admin_mfa, '', { ...sessionCookieOptions('admin_mfa'), maxAge: 0 })
}

export function clearAdminCookies(res: NextResponse) {
  res.cookies.set(COOKIE_NAME.platform_admin, '', { ...sessionCookieOptions('platform_admin'), maxAge: 0 })
  res.cookies.set(COOKIE_NAME.admin_mfa, '', { ...sessionCookieOptions('admin_mfa'), maxAge: 0 })
}

export function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
}
