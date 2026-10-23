/**
 * The business's contact email — the address shown on the storefront, used
 * in the ECTA information block and as the buyer email on PayFast
 * verification. Distinct from the owner's sign-in email (AppUser.email).
 *
 * Changing it is a two-step, self-service flow, tracked in
 * business_email_changes (one row per business, Tab 5 model):
 *
 *   requestEmailChange  → pendingEmail + a hashed, 24h token; the caller
 *                         emails the raw token to the NEW address only
 *   confirmEmailChange  → the link is opened: Business.email := pendingEmail,
 *                         verifiedAt := now, token cleared
 *
 * Until the link is opened nothing customer-facing changes, so a typo (or
 * someone else's address) never becomes the shop's public contact. The raw
 * token is never stored — same discipline as staff invites and driver
 * verification (auth.service.ts's hashToken).
 */

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '@/lib/prisma/client'
import { hashToken } from '@/modules/auth/auth.service'

export const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000

const EmailSchema = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254)

export class BusinessEmailError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BusinessEmailError'
  }
}

export interface BusinessEmailState {
  email: string | null
  /** When the current address was confirmed through this flow; null for an address set at sign-up. */
  emailVerifiedAt: Date | null
  pendingEmail: string | null
  /** True while a verification link for pendingEmail is still valid. */
  pendingLinkValid: boolean
}

export async function getBusinessEmailState(businessId: string, now: Date = new Date()): Promise<BusinessEmailState> {
  const b = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { email: true, emailChange: { select: { verifiedEmail: true, verifiedAt: true, pendingEmail: true, expiresAt: true } } },
  })
  const c = b.emailChange
  const verified = c?.verifiedAt && c.verifiedEmail && b.email && c.verifiedEmail.toLowerCase() === b.email.toLowerCase() ? c.verifiedAt : null
  return {
    email: b.email,
    emailVerifiedAt: verified,
    pendingEmail: c?.pendingEmail ?? null,
    pendingLinkValid: Boolean(c?.pendingEmail && c.expiresAt && c.expiresAt > now),
  }
}

function newToken() {
  return randomBytes(32).toString('base64url')
}

/**
 * Parks the new address and mints a fresh token (replacing any earlier,
 * unopened one). Returns the RAW token for the caller to email — this
 * function never sends anything itself, so a service test can assert the
 * whole flow without a transport.
 */
export async function requestEmailChange(businessId: string, rawEmail: string, now: Date = new Date()): Promise<{ pendingEmail: string; token: string }> {
  const parsed = EmailSchema.safeParse(rawEmail)
  if (!parsed.success) throw new BusinessEmailError(parsed.error.issues[0]?.message ?? 'Enter a valid email address.')
  const pendingEmail = parsed.data

  const current = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { email: true } })
  if (current.email && current.email.toLowerCase() === pendingEmail) {
    throw new BusinessEmailError('That is already your business email.')
  }

  const token = newToken()
  const data = { pendingEmail, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + EMAIL_CHANGE_TTL_MS) }
  await prisma.businessEmailChange.upsert({ where: { businessId }, create: { businessId, ...data }, update: data })
  return { pendingEmail, token }
}

/** A fresh link for the same pending address (the first email went astray). */
export async function reissueEmailChange(businessId: string, now: Date = new Date()): Promise<{ pendingEmail: string; token: string } | null> {
  const c = await prisma.businessEmailChange.findUnique({ where: { businessId }, select: { pendingEmail: true } })
  if (!c?.pendingEmail) return null
  const token = newToken()
  await prisma.businessEmailChange.update({
    where: { businessId },
    data: { tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + EMAIL_CHANGE_TTL_MS) },
  })
  return { pendingEmail: c.pendingEmail, token }
}

export async function cancelEmailChange(businessId: string): Promise<void> {
  await prisma.businessEmailChange.updateMany({
    where: { businessId },
    data: { pendingEmail: null, tokenHash: null, expiresAt: null },
  })
}

/**
 * Opens the link. Conditional on the hash AND the expiry, in one update, so
 * a link opened twice (or after a newer link was issued) changes nothing the
 * second time. Returns the business the change applied to, or null.
 */
export async function confirmEmailChange(token: string, now: Date = new Date()): Promise<{ businessId: string; email: string } | null> {
  if (!token || token.length < 20 || token.length > 200) return null
  const hash = hashToken(token)
  const c = await prisma.businessEmailChange.findUnique({
    where: { tokenHash: hash },
    select: { businessId: true, pendingEmail: true, expiresAt: true },
  })
  if (!c || !c.pendingEmail || !c.expiresAt || c.expiresAt < now) return null
  const email = c.pendingEmail

  return prisma.$transaction(async (tx) => {
    const applied = await tx.businessEmailChange.updateMany({
      where: { businessId: c.businessId, tokenHash: hash, expiresAt: { gte: now } },
      data: { verifiedEmail: email, verifiedAt: now, pendingEmail: null, tokenHash: null, expiresAt: null },
    })
    if (applied.count !== 1) return null
    await tx.business.update({ where: { id: c.businessId }, data: { email } })
    return { businessId: c.businessId, email }
  })
}
