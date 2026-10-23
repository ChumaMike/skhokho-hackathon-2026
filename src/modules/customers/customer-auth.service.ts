/**
 * Customer sign-in by one-time code — phone first, email as the fallback.
 *
 * A customer types their WhatsApp/phone number, gets a 6-digit code through
 * the configured MessageProvider (src/lib/messaging/provider.ts), types it
 * back, and holds a `customer` session cookie (its own cookie, separate
 * from owner/staff/driver). Where no phone provider is configured, the
 * sign-in page offers email instead and the code goes through sendEmail.
 *
 * What the session proves is ownership of ONE identifier. It is deliberately
 * not a customers.id: the same phone is a separate `customers` row at every
 * business (register_customer never links unverified numbers), and linking
 * them is the POPIA s57-gated layer (cross-business.ts). customer-account.
 * service.ts resolves the per-business membership from the identifier at
 * request time, and the customer only ever sees memberships.public_id /
 * short_code.
 *
 * Codes: random 6 digits, SHA-256 hashed with the row id as salt, 10-minute
 * life, 5 wrong tries lock the code, one use. Issuing and verifying are both
 * rate limited by IP and by identifier (rate-limit.ts), and every issue /
 * success / lockout writes an audit_log row through the audit_write RPC
 * (actor_type 'customer') carrying the last three digits only.
 */

import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/prisma/client'
import { signToken, sessionCookieOptions, COOKIE_NAME, type CustomerToken } from '@/modules/auth/auth.service'
import { isPhoneMessagingConfigured, sendPhoneMessage, toE164Mobile } from '@/lib/messaging/provider'
import { customerLoginCodeEmail, sendEmail } from '@/lib/email'

export const CODE_LENGTH = 6
export const CODE_TTL_MS = 10 * 60 * 1000
export const MAX_CODE_ATTEMPTS = 5

export type LoginChannel = 'phone' | 'email'

export interface LoginIdentifier {
  channel: LoginChannel
  /** E.164 phone or lower-cased email. */
  identifier: string
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/**
 * What the customer typed → a canonical identifier, or null. Anything with
 * an "@" is treated as an email; everything else must be a valid SA mobile.
 */
export function parseLoginIdentifier(raw: string): LoginIdentifier | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  if (value.includes('@')) {
    const email = value.toLowerCase()
    return email.length <= 254 && EMAIL.test(email) ? { channel: 'email', identifier: email } : null
  }
  const e164 = toE164Mobile(value)
  return e164 ? { channel: 'phone', identifier: e164 } : null
}

export function generateLoginCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0')
}

/** The row id is the salt: a leaked table gives nothing reusable, and equal codes for two people hash differently. */
export function hashLoginCode(rowId: string, code: string): string {
  return createHash('sha256').update(`${rowId}:${code}`).digest('hex')
}

/** The text the customer receives. Plain, short, no link to tap — the code is all they need. */
export function loginCodeText(code: string, shopName?: string | null): string {
  const where = shopName ? ` for ${shopName}` : ''
  return `Your Skhokho sign-in code${where} is ${code}. It works for 10 minutes. If you didn't ask for it, just ignore this message.`
}

/** For the audit trail and logs: never the whole number or address. */
function identifierTail(id: LoginIdentifier): string {
  return id.channel === 'phone' ? id.identifier.slice(-3) : id.identifier.replace(/^.*@/, '@')
}

async function audit(action: string, id: LoginIdentifier, ip?: string | null): Promise<void> {
  try {
    await prisma.$executeRaw`SELECT audit_write('customer', NULL, NULL, ${action}, ${id.channel}, ${identifierTail(id)}, ${ip ?? null})`
  } catch (e) {
    console.error('[customer-auth] audit write failed:', e instanceof Error ? e.message : e)
  }
}

export type CodeDelivery = 'phone' | 'email' | 'none'

/**
 * Creates a code and sends it. `delivery: 'none'` means nothing could be
 * sent (phone requested but no phone provider is configured, or the
 * provider failed) — the caller tells the customer to use email instead.
 * The row is still created in that case only when a send was accepted, so
 * a code that never left the building can't be guessed at.
 */
export async function issueLoginCode(
  id: LoginIdentifier,
  opts: { shopName?: string | null; ip?: string | null } = {},
): Promise<{ delivery: CodeDelivery }> {
  if (id.channel === 'phone' && !isPhoneMessagingConfigured()) return { delivery: 'none' }

  const code = generateLoginCode()
  // The id doubles as the hash salt, so it is chosen here rather than by the database.
  const rowId = randomUUID()
  const row = await prisma.customerLoginCode.create({
    data: { id: rowId, channel: id.channel, identifier: id.identifier, codeHash: hashLoginCode(rowId, code), expiresAt: new Date(Date.now() + CODE_TTL_MS) },
    select: { id: true },
  })

  let sent = false
  if (id.channel === 'phone') {
    sent = (await sendPhoneMessage({ to: id.identifier, text: loginCodeText(code, opts.shopName), kind: 'customer_login_code' })).sent
  } else {
    const { subject, html, text } = customerLoginCodeEmail({ code, shopName: opts.shopName ?? null })
    sent = (await sendEmail({ to: id.identifier, subject, html, text, kind: 'customer_login_code' })).sent
  }

  if (!sent) {
    // Never leave a live code behind for a message nobody received.
    await prisma.customerLoginCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } }).catch(() => undefined)
    return { delivery: 'none' }
  }
  await audit('login_code_issued', id, opts.ip)
  return { delivery: id.channel }
}

export type VerifyFailure = 'NONE' | 'EXPIRED' | 'LOCKED' | 'INVALID'

/**
 * Checks the code against the newest unused one for this identifier and, on
 * success, consumes it and returns a signed customer session token.
 */
export async function verifyLoginCode(
  id: LoginIdentifier,
  code: string,
  opts: { ip?: string | null } = {},
): Promise<{ ok: true; token: string; session: CustomerToken } | { ok: false; reason: VerifyFailure }> {
  const presented = (code ?? '').replace(/\D/g, '')
  const row = await prisma.customerLoginCode.findFirst({
    where: { channel: id.channel, identifier: id.identifier, consumedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { id: true, codeHash: true, attempts: true, expiresAt: true },
  })
  if (!row) return { ok: false, reason: 'NONE' }
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'EXPIRED' }
  if (row.attempts >= MAX_CODE_ATTEMPTS) return { ok: false, reason: 'LOCKED' }

  const expected = Buffer.from(row.codeHash, 'hex')
  const actual = Buffer.from(hashLoginCode(row.id, presented), 'hex')
  const matches = presented.length === CODE_LENGTH && expected.length === actual.length && timingSafeEqual(expected, actual)

  if (!matches) {
    const bumped = await prisma.customerLoginCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } }, select: { attempts: true } })
    if (bumped.attempts >= MAX_CODE_ATTEMPTS) {
      await audit('login_code_locked', id, opts.ip)
      return { ok: false, reason: 'LOCKED' }
    }
    return { ok: false, reason: 'INVALID' }
  }

  // One use: a second request racing with the same code loses here.
  const consumed = await prisma.customerLoginCode.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } })
  if (consumed.count === 0) return { ok: false, reason: 'INVALID' }

  const session: CustomerToken = { type: 'customer', channel: id.channel, identifier: id.identifier }
  const token = await signToken(session)
  await audit('customer_login', id, opts.ip)
  return { ok: true, token, session }
}

/** Cookie name + options for the customer session — the route sets it on its response. */
export function customerSessionCookie(): { name: string; options: ReturnType<typeof sessionCookieOptions> } {
  return { name: COOKIE_NAME.customer, options: sessionCookieOptions('customer') }
}

/** Daily cron: codes are useless after ten minutes; keep the table small and PII-free. */
export async function purgeExpiredLoginCodes(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const result = await prisma.customerLoginCode.deleteMany({ where: { expiresAt: { lt: cutoff } } })
  return result.count
}
