/**
 * The customer's own view of ONE business — resolved from their verified
 * identifier (customer-auth.service.ts) at request time.
 *
 * Why per business, and why a join rather than a stored customer id: the
 * same phone is a separate `customers` row at every business
 * (register_customer never links unverified numbers), and joining them is
 * the POPIA s57 layer behind cross-business.ts. So "my membership here" is
 * `memberships` × `customer_identifiers` scoped to this business, and the
 * only identifiers that leave this module are the pairwise public_id and
 * short_code — never customers.id, never memberships.customer_id.
 *
 * `membershipId` (memberships.id) is returned for server-side scoping of
 * orders and rewards within the same request. It is not rendered anywhere.
 */

import { prisma } from '@/lib/prisma/client'
import type { CustomerToken } from '@/modules/auth/auth.service'
import { requireCrossBusinessLinking } from './cross-business'

export interface CustomerMembership {
  /** memberships.id — server-side scoping only, never shown. */
  membershipId: string
  publicId: string
  shortCode: string
  displayName: string | null
}

/** The signed-in customer's membership at this business, or null if they have never ordered or joined here. */
export async function findMembershipForSession(businessId: string, session: CustomerToken): Promise<CustomerMembership | null> {
  const rows = await prisma.$queryRaw<{ id: string; public_id: string; short_code: string; display_name: string | null }[]>`
    SELECT m.id, m.public_id, m.short_code, m.display_name
    FROM memberships m
    JOIN customer_identifiers ci ON ci.customer_id = m.customer_id
    WHERE m.business_id = ${businessId}::uuid
      AND ci.type = ${session.channel}
      AND ci.value = ${session.identifier}
      AND m.status = 'active'
    ORDER BY m.last_seen DESC
    LIMIT 1`
  const row = rows[0]
  if (!row) return null
  return { membershipId: row.id, publicId: row.public_id, shortCode: row.short_code, displayName: row.display_name }
}

export interface CrossBusinessMembership {
  businessId: string
  businessName: string
  businessSlug: string
  publicId: string
  shortCode: string
  stamps: number
  redeems: number
  required: number
}

/**
 * Every shop this identifier is a member of — the "all my shops" view.
 * Refuses unless CROSS_BUSINESS_LINKING_ENABLED is on (POPIA s57); there is
 * deliberately no way to call this with the flag off.
 */
export async function listMembershipsAcrossBusinesses(session: CustomerToken): Promise<CrossBusinessMembership[]> {
  requireCrossBusinessLinking()
  const rows = await prisma.$queryRaw<
    { business_id: string; business_name: string; business_slug: string; public_id: string; short_code: string; stamps: number; redeems: number; required: number }[]
  >`
    SELECT b.id AS business_id, b.name AS business_name, b.slug AS business_slug,
      m.public_id, m.short_code,
      COUNT(v.*) FILTER (WHERE v.kind = 'stamp')::int  AS stamps,
      COUNT(v.*) FILTER (WHERE v.kind = 'redeem')::int AS redeems,
      COALESCE((b.config->>'loyalty_stamps_required')::int, 10) AS required
    FROM memberships m
    JOIN customer_identifiers ci ON ci.customer_id = m.customer_id
    JOIN businesses b ON b.id = m.business_id
    LEFT JOIN visits v ON v.membership_id = m.id
    WHERE ci.type = ${session.channel} AND ci.value = ${session.identifier}
      AND m.status = 'active' AND b.status = 'ACTIVE'
    GROUP BY b.id, m.id
    ORDER BY m.last_seen DESC`
  return rows.map((r) => ({
    businessId: r.business_id,
    businessName: r.business_name,
    businessSlug: r.business_slug,
    publicId: r.public_id,
    shortCode: r.short_code,
    stamps: r.stamps,
    redeems: r.redeems,
    required: r.required,
  }))
}

// ---------------------------------------------------------------------------
// Rewards — the per-business card (Consent 1 only)
// ---------------------------------------------------------------------------

export interface RewardsCard {
  shortCode: string
  stamps: number
  redeems: number
  required: number
  /** Stamps on the current card: stamps earned since the last redeem, capped at `required`. */
  progress: number
  rewardReady: boolean
}

/**
 * The customer's rewards card at ONE business, from the append-only visits
 * ledger — the same derivation the owner's StampCard and the redeem_reward
 * RPC use. Joining the card is Consent 1 (per-business loyalty), recorded by
 * register_customer; nothing here crosses businesses.
 */
export async function getRewardsCard(businessId: string, membership: CustomerMembership): Promise<RewardsCard> {
  const rows = await prisma.$queryRaw<{ stamps: number; redeems: number; required: number }[]>`
    SELECT
      COUNT(v.*) FILTER (WHERE v.kind = 'stamp')::int  AS stamps,
      COUNT(v.*) FILTER (WHERE v.kind = 'redeem')::int AS redeems,
      COALESCE((b.config->>'loyalty_stamps_required')::int, 10) AS required
    FROM businesses b
    LEFT JOIN visits v ON v.membership_id = ${membership.membershipId}::uuid AND v.business_id = b.id
    WHERE b.id = ${businessId}::uuid
    GROUP BY b.id`
  const row = rows[0] ?? { stamps: 0, redeems: 0, required: 10 }
  const progress = Math.min(row.required, Math.max(0, row.stamps - row.redeems * row.required))
  return { shortCode: membership.shortCode, stamps: row.stamps, redeems: row.redeems, required: row.required, progress, rewardReady: progress >= row.required }
}

/**
 * "Start my rewards card here": a signed-in customer joins THIS business's
 * programme. Only a phone session can — the identity RPC keys a membership
 * by a verified SA mobile, and an email-only sign-in has none to give. The
 * RPC records Consent 1 (loyalty_program) and nothing else: no marketing,
 * no cross-business link (those have their own consents and gates).
 */
export async function joinRewards(businessId: string, session: CustomerToken, ip?: string | null): Promise<CustomerMembership> {
  if (session.channel !== 'phone') throw new Error('Sign in with your phone number to start a rewards card.')
  const { registerCustomer } = await import('./customer.service')
  await registerCustomer(businessId, session.identifier, undefined, 'customer_account', undefined, ip ?? undefined)
  const membership = await findMembershipForSession(businessId, session)
  if (!membership) throw new Error('Could not open your rewards card. Try again.')
  return membership
}
