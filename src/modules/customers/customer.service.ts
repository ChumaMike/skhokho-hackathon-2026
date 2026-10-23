/**
 * Customer Service (approved identity design)
 *
 * REPLACES the rejected Kasi TenantCustomer/PlatformUser auto-link service.
 * All writes go through the SECURITY DEFINER RPCs in prisma/sql/identity_layer.sql,
 * which enforce: pairwise short codes, per-business scoping, append-only ledger,
 * and NO cross-business linking off unverified phones. Reads never expose the
 * global customer id — only the pairwise `public_id` + `short_code`.
 *
 * The cross-business linking layer (verified-phone → one global customer across
 * businesses) is POPIA s57-gated and ships dark behind a feature flag; it is NOT
 * implemented here.
 */

import { prisma } from '@/lib/prisma/client'
import { normalisePhone, isValidZaMobile } from '@/lib/za-phone'

export interface RegisterResult {
  public_id: string
  short_code: string
  display_name: string | null
  created: boolean
}

export interface VisitCounts {
  public_id: string
  stamps: number
  redeems: number
  required?: number
}

export interface MemberRow {
  public_id: string
  short_code: string
  display_name: string | null
  first_seen: Date
  last_seen: Date
  stamps: number
  redeems: number
}

function requireMobile(phone: string): string {
  const e164 = normalisePhone(phone)
  if (!isValidZaMobile(e164)) throw new Error('That is not a valid SA mobile number.')
  return e164
}

/** Loose format check only — the RPC/customer_identifiers row is the source of truth, this just rejects an obvious typo before it reaches the database. */
function normaliseEmail(email: string): string {
  const trimmed = email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) throw new Error('That is not a valid email address.')
  return trimmed
}

// ---------------------------------------------------------------------------
// Writes — via the identity RPCs (service path)
// ---------------------------------------------------------------------------

/**
 * Register (find-or-create) a customer at ONE business by phone.
 *
 * `email`/`consentMarketing` are optional, trailing params matching
 * register_customer's own DEFAULT NULL/FALSE trailing SQL parameters
 * (prisma/migrations/20260912000000_customer_consent_email) — every
 * existing call site that doesn't pass them keeps behaving exactly as
 * before (no email captured, no marketing consent granted).
 */
export async function registerCustomer(
  businessId: string,
  phone: string,
  name?: string,
  source = 'owner_dashboard',
  actorId?: string,
  ip?: string,
  email?: string,
  consentMarketing = false,
): Promise<RegisterResult> {
  const e164 = requireMobile(phone)
  const normalisedEmail = email ? normaliseEmail(email) : null
  const rows = await prisma.$queryRaw<{ result: RegisterResult }[]>`
    SELECT register_customer(
      ${businessId}::uuid, ${e164}, ${name ?? null},
      ${source}, ${actorId ?? null}, ${ip ?? null},
      ${normalisedEmail}, ${consentMarketing}
    ) AS result`
  return rows[0].result
}

/** The customer's own email, if one was ever captured — for order/booking confirmations. Returns null if none, never throws (most customers won't have supplied one). */
export async function getCustomerEmailByMembership(businessId: string, membershipId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ value: string }[]>`
    SELECT ci.value
    FROM customer_identifiers ci
    JOIN memberships m ON m.customer_id = ci.customer_id
    WHERE m.id = ${membershipId}::uuid AND m.business_id = ${businessId}::uuid AND ci.type = 'email'
    LIMIT 1`
  return rows[0]?.value ?? null
}

/**
 * Give a visit/stamp by the pairwise public id.
 *
 * `idempotencyKey`: pass the SAME key if retrying a request that may have
 * already succeeded (e.g. a network retry of the same user action) — a
 * matching key already recorded returns the existing result instead of
 * stamping twice. Omit it (or pass a fresh one) for a genuinely new stamp;
 * this is not a general dedup window, only protection against replaying
 * one specific request.
 */
export async function logVisit(
  businessId: string,
  publicId: string,
  kind: 'visit' | 'stamp' = 'stamp',
  actorId?: string,
  idempotencyKey?: string,
): Promise<VisitCounts> {
  const rows = await prisma.$queryRaw<{ result: VisitCounts }[]>`
    SELECT log_visit(${businessId}::uuid, ${publicId}::uuid, ${kind}, ${actorId ?? null}, ${idempotencyKey ?? null}) AS result`
  return rows[0].result
}

/** Register-or-find a walk-in by phone, then stamp — one action for the owner. */
export async function stampByPhone(
  businessId: string,
  phone: string,
  actorId?: string,
): Promise<VisitCounts & { short_code: string }> {
  const reg = await registerCustomer(businessId, phone, undefined, 'owner_dashboard', actorId)
  const counts = await logVisit(businessId, reg.public_id, 'stamp', actorId)
  return { ...counts, short_code: reg.short_code }
}

/**
 * Redeem a reward once the stamp threshold is met.
 *
 * `idempotencyKey`: same contract as logVisit's. Also closes a real
 * concurrency race independent of any key — see redeem_reward's own
 * pg_advisory_xact_lock in prisma/sql/10_identity_rpcs.sql, which
 * serializes two genuinely concurrent redeem calls for the same
 * membership so at most one can succeed against a given stamp balance.
 */
export async function redeemReward(
  businessId: string,
  publicId: string,
  actorId?: string,
  idempotencyKey?: string,
): Promise<VisitCounts> {
  const rows = await prisma.$queryRaw<{ result: VisitCounts }[]>`
    SELECT redeem_reward(${businessId}::uuid, ${publicId}::uuid, ${actorId ?? null}, ${idempotencyKey ?? null}) AS result`
  return rows[0].result
}

/** Look up a member by phone (rate-limited + audited surface). Returns null if none. */
export async function lookupByPhone(
  businessId: string,
  phone: string,
  actorId?: string,
  ip?: string,
): Promise<(RegisterResult & VisitCounts) | null> {
  const e164 = requireMobile(phone)
  const rows = await prisma.$queryRaw<{ result: (RegisterResult & VisitCounts) | null }[]>`
    SELECT lookup_membership(${businessId}::uuid, ${e164}, ${actorId ?? null}, ${ip ?? null}) AS result`
  return rows[0].result
}

// ---------------------------------------------------------------------------
// Reads — pairwise-safe (no global customer id, no phone)
// ---------------------------------------------------------------------------

/** Members of a business with derived stamp/redeem counts. */
export async function listMembers(
  businessId: string,
  opts: { limit?: number } = {},
): Promise<MemberRow[]> {
  const limit = Math.min(500, opts.limit ?? 200)
  return prisma.$queryRaw<MemberRow[]>`
    SELECT m.public_id, m.short_code, m.display_name, m.first_seen, m.last_seen,
      COUNT(v.*) FILTER (WHERE v.kind = 'stamp')::int  AS stamps,
      COUNT(v.*) FILTER (WHERE v.kind = 'redeem')::int AS redeems
    FROM memberships m
    LEFT JOIN visits v ON v.membership_id = m.id
    WHERE m.business_id = ${businessId}::uuid AND m.status = 'active'
    GROUP BY m.id
    ORDER BY m.last_seen DESC
    LIMIT ${limit}`
}

/** Top regulars by stamp count. */
export async function getRegulars(businessId: string, top = 10): Promise<MemberRow[]> {
  const members = await listMembers(businessId, { limit: 500 })
  return members.sort((a, b) => b.stamps - a.stamps).slice(0, top)
}

/** Members not seen in `days` days (lapsed). */
export async function getLapsed(businessId: string, days = 30): Promise<MemberRow[]> {
  const cutoff = days * 86_400_000
  const members = await listMembers(businessId, { limit: 500 })
  return members.filter((m) => Date.now() - new Date(m.last_seen).getTime() >= cutoff)
}
