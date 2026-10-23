/**
 * Slug allocation and safe slug changes.
 *
 * A slug is unique across BOTH businesses.slug and business_slug_history
 * (a retired slug still redirects, so handing it to someone else would let
 * them inherit another business's links). No single index can span two
 * tables, so every write that claims a slug takes one transaction-scoped
 * advisory lock first; the per-table unique indexes stay as the backstop.
 * Slug writes are rare (signup, an owner renaming), so one global lock
 * costs nothing measurable.
 *
 * Business.id remains the tenant identity throughout — nothing here ever
 * keys data by slug.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { clearHostnameCache } from '@/lib/tenant/context'
import { slugCandidates, normalizeSlug, validateSlug, describeSlugProblem, type SlugContext } from './slug-policy'

type Tx = Prisma.TransactionClient

/** Arbitrary constant naming the "slug namespace" advisory lock. */
const SLUG_LOCK_KEY = 735_201_001

export async function lockSlugNamespace(tx: Tx): Promise<void> {
  // ::text because Prisma can't deserialize Postgres's `void` return type.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SLUG_LOCK_KEY})::text`
}

/**
 * Slugs from `candidates` already held by a business or by history —
 * optionally ignoring one business's own. One round trip: this runs inside
 * createBusiness's transaction, which is already tight on a cold serverless
 * database (see its timeout note).
 */
async function takenSlugs(tx: Tx, candidates: string[], exceptBusinessId?: string): Promise<Set<string>> {
  const except = exceptBusinessId ?? null
  const rows = await tx.$queryRaw<{ slug: string }[]>`
    SELECT slug FROM businesses
      WHERE slug = ANY(${candidates}) AND (${except}::uuid IS NULL OR id <> ${except}::uuid)
    UNION
    SELECT slug FROM business_slug_history
      WHERE slug = ANY(${candidates}) AND (${except}::uuid IS NULL OR business_id <> ${except}::uuid)
  `
  return new Set(rows.map((row) => row.slug))
}

export class SlugUnavailableError extends Error {
  constructor(message = 'No web address is available for this business name.') {
    super(message)
    this.name = 'SlugUnavailableError'
  }
}

/**
 * Pick the first free candidate for a new business. MUST be called inside
 * the same transaction that creates the business, so the lock covers the
 * insert too.
 */
export async function allocateSlug(tx: Tx, name: string, context: SlugContext = {}): Promise<string> {
  await lockSlugNamespace(tx)
  const candidates = slugCandidates(name, context)
  const taken = await takenSlugs(tx, candidates)
  const free = candidates.find((candidate) => !taken.has(candidate))
  if (!free) throw new SlugUnavailableError()
  return free
}

export class InvalidSlugError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidSlugError'
  }
}

/**
 * Change a business's slug. The old slug moves to history (so
 * /store/<old> and <old>.<storefront domain> 308 to the new one); a slug the
 * business itself retired earlier can be reclaimed. Returns the new slug.
 *
 * The requested value is normalized first, then must pass the same policy a
 * generated slug does — an owner can't pick a reserved or malformed one.
 */
export async function changeBusinessSlug(businessId: string, requested: string): Promise<string> {
  const slug = normalizeSlug(requested)
  const validation = validateSlug(slug)
  if (!validation.ok) throw new InvalidSlugError(describeSlugProblem(validation.problem))

  const result = await prisma.$transaction(async (tx) => {
    await lockSlugNamespace(tx)

    const business = await tx.business.findUnique({ where: { id: businessId }, select: { slug: true } })
    if (!business) throw new Error('Business not found')
    if (business.slug === slug) return slug

    const taken = await takenSlugs(tx, [slug], businessId)
    if (taken.has(slug)) throw new InvalidSlugError('That web address is already taken. Please pick another one.')

    // Reclaiming one of this business's own retired slugs: it stops being history.
    await tx.businessSlugHistory.deleteMany({ where: { businessId, slug } })
    await tx.businessSlugHistory.create({ data: { businessId, slug: business.slug } })
    await tx.business.update({ where: { id: businessId }, data: { slug } })
    return slug
  },
  // Same reasoning as createBusiness's transaction: several sequential round
  // trips to a serverless database can exceed Prisma's 5s default.
  { timeout: 15_000, maxWait: 10_000 })

  // Old and new hostnames/paths both resolve differently now. Clears this
  // instance only — other instances converge within the cache TTL (60s).
  clearHostnameCache()
  return result
}
