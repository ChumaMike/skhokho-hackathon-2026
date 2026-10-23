/**
 * Mandatory TOTP MFA for platform admins (RFC 6238 via the `otpauth`
 * library — no home-made crypto).
 *
 *   password ok → short-lived admin_mfa session (can ONLY enrol or verify)
 *   → TOTP (or one recovery code) → platform_admin session with mfa: true
 *
 * - The TOTP secret is sealed with secret-box; the pending (enrolment) secret
 *   too. Without PAYMENT_ENCRYPTION_KEY enrolment fails closed.
 * - Each time-step is accepted at most once (mfa_last_step), so a code seen
 *   over someone's shoulder can't be replayed.
 * - Recovery codes: 10, single-use, stored as HMACs only, shown once.
 * - Attempts are rate-limited per admin and per IP; every failure, enrolment,
 *   recovery-code use and reset is an audit event. Codes are never logged.
 * - Reset = clear the factor + recovery codes + bump the session epoch (all
 *   of that admin's sessions end). Only ANOTHER super admin, with a reason.
 */

import { createHmac, randomBytes } from 'node:crypto'
import { Secret, TOTP } from 'otpauth'
import QRCode from 'qrcode'
import { prisma } from '@/lib/prisma/client'
import { encryptSecret, decryptSecret } from '@/lib/crypto/secret-box'
import { checkRateLimits } from '@/lib/rate-limit'
import { recordAudit, securityEvent } from './audit'
import { TX_OPTIONS } from '@/modules/skhokholetha/tx'

export const TOTP_PERIOD = 30
export const RECOVERY_CODE_COUNT = 10
const ISSUER = 'Skhokho Admin'

export class MfaError extends Error {
  constructor(message: string, readonly code: 'INVALID' | 'RATE_LIMITED' | 'NOT_ENROLLED' | 'ALREADY_ENROLLED' | 'NOT_ALLOWED' = 'INVALID') {
    super(message)
    this.name = 'MfaError'
  }
}

function totp(secretBase32: string, label: string) {
  return new TOTP({ issuer: ISSUER, label, algorithm: 'SHA1', digits: 6, period: TOTP_PERIOD, secret: Secret.fromBase32(secretBase32) })
}

function recoveryKey(): Buffer {
  const s = process.env.JWT_SECRET
  if (!s || s.length < 32) throw new Error('JWT_SECRET must be set to use admin recovery codes.')
  return Buffer.from(`admin-recovery:${s}`)
}

export function hashRecoveryCode(code: string): string {
  return createHmac('sha256', recoveryKey()).update(code.replace(/[\s-]/g, '').toLowerCase()).digest('hex')
}

function newRecoveryCode(): string {
  // 10 base32 chars ≈ 50 bits, shown as xxxxx-xxxxx.
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(10)
  const s = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
  return `${s.slice(0, 5)}-${s.slice(5)}`
}

/** The admin row for an ADMIN app user, created on first sign-in with the least-privileged role. */
export async function ensurePlatformAdmin(userId: string) {
  return prisma.platformAdmin.upsert({ where: { userId }, update: {}, create: { userId }, select: { id: true, role: true, mfaEnabledAt: true, sessionEpoch: true } })
}

/** Rate limit per admin and per IP. Events name the admin by their app-user id, like every other MFA event. */
async function limit(adminRowId: string, adminUserId: string, ip: string | null) {
  const r = await checkRateLimits([
    ['adminMfaAccount', adminRowId],
    ['adminMfaIp', ip],
  ])
  if (!r.allowed) {
    await securityEvent('admin_mfa_rate_limited', { outcome: 'DENIED', actor: { type: 'platform_admin', id: adminUserId }, ip })
    throw new MfaError('Too many attempts. Wait 15 minutes and try again.', 'RATE_LIMITED')
  }
}

// --- enrolment ----------------------------------------------------------------

/** Starts (or restarts) enrolment: a fresh pending secret. Returns what the authenticator app needs. */
export async function beginEnrollment(adminUserId: string, email: string) {
  const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { userId: adminUserId } })
  if (admin.mfaEnabledAt) throw new MfaError('MFA is already set up for this account.', 'ALREADY_ENROLLED')
  const secret = new Secret({ size: 20 })
  await prisma.platformAdmin.update({ where: { id: admin.id }, data: { mfaPendingCipher: encryptSecret(secret.base32).payload } })
  const uri = totp(secret.base32, email).toString()
  return { otpauthUri: uri, secret: secret.base32, qrSvg: await QRCode.toString(uri, { type: 'svg', margin: 1 }) }
}

/** Confirms enrolment with a code from the app; returns the recovery codes (shown once). */
export async function confirmEnrollment(adminUserId: string, email: string, code: string, ctx: { ip: string | null; requestId?: string | null }, now = new Date()) {
  const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { userId: adminUserId } })
  if (admin.mfaEnabledAt) throw new MfaError('MFA is already set up for this account.', 'ALREADY_ENROLLED')
  if (!admin.mfaPendingCipher) throw new MfaError('Start the set-up again.', 'NOT_ENROLLED')
  await limit(admin.id, adminUserId, ctx.ip)
  const secret = decryptSecret(admin.mfaPendingCipher)
  const step = matchStep(secret, email, code, now)
  if (step === null) {
    await securityEvent('admin_mfa_failed', { outcome: 'DENIED', actor: { type: 'platform_admin', id: adminUserId }, metadata: { stage: 'enrol' }, ...ctx })
    throw new MfaError("That code isn't right. Check the time on your phone and try again.")
  }
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode)
  const updated = await prisma.$transaction(async (tx) => {
    const r = await tx.platformAdmin.updateMany({
      where: { id: admin.id, mfaEnabledAt: null, mfaPendingCipher: admin.mfaPendingCipher },
      data: { mfaSecretCipher: admin.mfaPendingCipher, mfaPendingCipher: null, mfaEnabledAt: now, mfaLastStep: step, sessionEpoch: { increment: 1 } },
    })
    if (r.count !== 1) throw new MfaError('Set-up changed while you were confirming — start again.', 'NOT_ENROLLED')
    await tx.adminRecoveryCode.deleteMany({ where: { adminId: admin.id } })
    await tx.adminRecoveryCode.createMany({ data: codes.map((c) => ({ adminId: admin.id, codeHash: hashRecoveryCode(c) })) })
    await recordAudit({ category: 'SECURITY', action: 'admin_mfa_enrolled', actor: { type: 'platform_admin', id: adminUserId }, resource: { type: 'platform_admin', id: admin.id }, ...ctx }, { tx, strict: true })
    return tx.platformAdmin.findUniqueOrThrow({ where: { id: admin.id }, select: { sessionEpoch: true } })
  }, TX_OPTIONS)
  return { recoveryCodes: codes, epoch: updated.sessionEpoch }
}

// --- verification -------------------------------------------------------------

/** The time-step a code belongs to (±1 step for clock drift), or null. */
function matchStep(secretBase32: string, label: string, code: string, now: Date): number | null {
  const cleaned = (code ?? '').replace(/\s+/g, '')
  if (!/^\d{6}$/.test(cleaned)) return null
  const delta = totp(secretBase32, label).validate({ token: cleaned, timestamp: now.getTime(), window: 1 })
  if (delta === null) return null
  return Math.floor(now.getTime() / 1000 / TOTP_PERIOD) + delta
}

/**
 * Verifies a TOTP code OR a recovery code for an enrolled admin. Returns the
 * session epoch to put in the new session. Each TOTP step and each recovery
 * code works once.
 */
export async function verifySecondFactor(
  adminUserId: string,
  email: string,
  input: { code?: string; recoveryCode?: string },
  ctx: { ip: string | null; requestId?: string | null },
  now = new Date(),
): Promise<{ epoch: number; usedRecoveryCode: boolean }> {
  const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { userId: adminUserId } })
  if (!admin.mfaEnabledAt || !admin.mfaSecretCipher) throw new MfaError('Set up MFA first.', 'NOT_ENROLLED')
  await limit(admin.id, adminUserId, ctx.ip)
  const fail = async (kind: string) => {
    await securityEvent('admin_mfa_failed', { outcome: 'DENIED', actor: { type: 'platform_admin', id: adminUserId }, metadata: { kind }, ...ctx })
    throw new MfaError(kind === 'recovery' ? "That recovery code isn't valid." : "That code isn't right.")
  }

  if (input.recoveryCode) {
    const used = await prisma.adminRecoveryCode.updateMany({
      where: { adminId: admin.id, codeHash: hashRecoveryCode(input.recoveryCode), usedAt: null },
      data: { usedAt: now },
    })
    if (used.count !== 1) return fail('recovery')
    const left = await prisma.adminRecoveryCode.count({ where: { adminId: admin.id, usedAt: null } })
    await securityEvent('admin_recovery_code_used', { actor: { type: 'platform_admin', id: adminUserId }, metadata: { remaining: left }, ...ctx })
    return { epoch: admin.sessionEpoch, usedRecoveryCode: true }
  }

  const step = matchStep(decryptSecret(admin.mfaSecretCipher), email, input.code ?? '', now)
  if (step === null) return fail('totp')
  // Replay guard: the step must be newer than the last one accepted (conditional, race-safe).
  const claimed = await prisma.platformAdmin.updateMany({
    where: { id: admin.id, sessionEpoch: admin.sessionEpoch, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] },
    data: { mfaLastStep: step },
  })
  if (claimed.count !== 1) return fail('replay')
  return { epoch: admin.sessionEpoch, usedRecoveryCode: false }
}

/** A signed-in admin replaces their recovery codes (needs a current TOTP code). */
export async function regenerateRecoveryCodes(adminUserId: string, email: string, code: string, ctx: { ip: string | null; requestId?: string | null }) {
  await verifySecondFactor(adminUserId, email, { code }, ctx)
  const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { userId: adminUserId } })
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode)
  await prisma.$transaction(async (tx) => {
    await tx.adminRecoveryCode.deleteMany({ where: { adminId: admin.id } })
    await tx.adminRecoveryCode.createMany({ data: codes.map((c) => ({ adminId: admin.id, codeHash: hashRecoveryCode(c) })) })
    await recordAudit({ category: 'SECURITY', action: 'admin_recovery_codes_regenerated', actor: { type: 'platform_admin', id: adminUserId }, ...ctx }, { tx, strict: true })
  }, TX_OPTIONS)
  return codes
}

/**
 * Resets another admin's MFA (lost phone). Super admins only — enforced by
 * the caller's permission check AND here (never your own, always a reason).
 * The target's sessions all end; they enrol again on next sign-in.
 */
export async function resetAdminMfa(actorUserId: string, targetAdminId: string, reason: string, ctx: { ip: string | null; requestId?: string | null }) {
  const why = reason.trim()
  if (why.length < 5) throw new MfaError('Give a reason for the reset.', 'NOT_ALLOWED')
  const actor = await prisma.platformAdmin.findUnique({ where: { userId: actorUserId }, select: { role: true } })
  if (actor?.role !== 'SUPER_ADMIN') throw new MfaError('Only a super admin can reset MFA.', 'NOT_ALLOWED')
  const target = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: targetAdminId }, select: { id: true, userId: true } })
  if (target.userId === actorUserId) throw new MfaError("You can't reset your own MFA — ask another super admin.", 'NOT_ALLOWED')
  await prisma.$transaction(async (tx) => {
    await tx.platformAdmin.update({
      where: { id: target.id },
      data: { mfaSecretCipher: null, mfaPendingCipher: null, mfaEnabledAt: null, mfaLastStep: null, sessionEpoch: { increment: 1 } },
    })
    await tx.adminRecoveryCode.deleteMany({ where: { adminId: target.id } })
    await recordAudit(
      { category: 'ADMIN_ACTION', action: 'admin_mfa_reset', actor: { type: 'platform_admin', id: actorUserId }, resource: { type: 'platform_admin', id: target.id }, reason: why, ...ctx },
      { tx, strict: true },
    )
  }, TX_OPTIONS)
}
