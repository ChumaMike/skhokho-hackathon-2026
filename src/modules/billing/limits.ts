/**
 * Plan limit enforcement for products, services and staff seats.
 *
 * Policy, from docs/specs/2026-10-21-plans.md §3 — deliberately conservative:
 *
 *   - NEW creation is restricted when a business is at or over its limit.
 *   - EXISTING rows are never deleted, hidden, archived or deactivated because
 *     a plan changed. Not on downgrade, not at trial expiry, not after grace.
 *   - The over-limit state is surfaced plainly, so an owner always knows why.
 *
 * A business may therefore sit over its limit indefinitely; it simply cannot
 * add more. A merchant's catalogue and staff records are their own business
 * data, and a billing state change is not a licence to touch it — hiding a
 * shop's products because its card failed would damage a real trading
 * business, and "which products, in what order?" has no honest answer.
 *
 * The check lives in the service rather than in each server action on purpose:
 * a call site cannot forget it. Creation is rare, so the extra entitlement
 * read costs nothing that matters.
 */

import { prisma } from '@/lib/prisma/client'
import { getBusinessEntitlements, listPublicPlans } from './subscription.service'
import { featureLimit, withinLimit, type Entitlements } from './entitlements'
import type { LimitFeature } from './features'

/** The three limits this module enforces, and how to talk about each one. */
export const ENFORCED_LIMITS = {
  max_products: { one: 'product', many: 'products' },
  max_services: { one: 'service', many: 'services' },
  max_staff: { one: 'team member', many: 'team members' },
} as const

export type EnforcedLimit = keyof typeof ENFORCED_LIMITS

/**
 * Carries a 403 and the numbers a page needs to render an upgrade prompt
 * rather than a bare refusal.
 *
 * Deliberately NOT a subclass of AuthError: importing that would pull
 * lib/auth/guards — and with it `next/headers` — into this module, which makes
 * every caller unloadable outside a Next request and un-unit-testable. The
 * same reasoning is already recorded in handleApiError, which matches
 * AuthError structurally by name for exactly that reason. `status` and `name`
 * are what the error handlers read, so this stays compatible with them.
 */
export class PlanLimitError extends Error {
  readonly status = 403 as const

  constructor(
    readonly feature: EnforcedLimit,
    readonly limit: number,
    readonly used: number,
    message: string,
  ) {
    super(message)
    this.name = 'PlanLimitError'
  }
}

/**
 * How many of a limited thing this business already has.
 *
 * Staff deliberately excludes the owner: `max_staff` is a team-seat
 * allowance, and the owner's own record is created by registration
 * (tenant.service.ts), which must never be refused for a plan reason. So
 * "2 team members" on FREE means the owner plus two, not the owner plus one.
 */
export async function countFor(businessId: string, feature: EnforcedLimit): Promise<number> {
  switch (feature) {
    case 'max_products':
      return prisma.product.count({ where: { businessId } })
    case 'max_services':
      return prisma.service.count({ where: { businessId } })
    case 'max_staff':
      return prisma.businessStaff.count({ where: { businessId, isOwner: false } })
  }
}

/**
 * The cheapest public plan that would allow `needed` of this thing, for the
 * upgrade message. Null when nothing on sale would help (already on the
 * largest plan, or no plan is priced yet) — in which case the message stays
 * honest and simply states the limit.
 */
async function nextPlanFor(
  feature: EnforcedLimit,
  needed: number,
): Promise<{ name: string; limit: number | null } | null> {
  const plans = await listPublicPlans()
  for (const plan of plans) {
    const row = plan.entitlements.find((e) => e.featureKey === feature && e.enabled)
    if (!row) continue
    // null limitValue is unlimited, which always helps.
    if (row.limitValue === null || row.limitValue >= needed) {
      return { name: plan.name, limit: row.limitValue }
    }
  }
  return null
}

/**
 * The refusal an owner reads. Exported so the wording is pinned by tests
 * rather than only being seen when someone hits a limit in production.
 *
 * Three jobs, in this order: say what the limit is, say what lifts it, and
 * promise nothing was lost. The last one matters most — an owner who hits
 * this after a downgrade needs to know their catalogue is intact.
 */
export function limitMessage(
  feature: EnforcedLimit,
  limit: number,
  upgrade: { name: string; limit: number | null } | null,
): string {
  const { many } = ENFORCED_LIMITS[feature]
  const head =
    limit === 0
      ? `Your plan doesn't include ${many} yet.`
      : `You've reached the ${limit} ${limit === 1 ? ENFORCED_LIMITS[feature].one : many} your plan includes.`
  if (!upgrade) return `${head} Nothing has been lost — get in touch and we'll sort you out.`
  const allowance = upgrade.limit === null ? 'as many as you need' : `${upgrade.limit}`
  return `${head} Moving to ${upgrade.name} gives you ${allowance}. Everything you already have stays exactly as it is.`
}

/**
 * Refuses to let a business add one more, when one more would exceed its plan.
 *
 * Throws PlanLimitError (403) with a message written for a shop owner, never a
 * bare refusal and never a crash. Pass `entitlements` when the caller already
 * loaded them; otherwise they are read here.
 */
export async function assertCanAdd(
  businessId: string,
  feature: EnforcedLimit,
  entitlements?: Entitlements,
): Promise<void> {
  const ent = entitlements ?? (await getBusinessEntitlements(businessId))
  const used = await countFor(businessId, feature)
  if (withinLimit(ent, feature, used)) return

  const limit = featureLimit(ent, feature) ?? 0
  const upgrade = await nextPlanFor(feature, used + 1)
  throw new PlanLimitError(feature, limit, used, limitMessage(feature, limit, upgrade))
}

export interface LimitUsage {
  feature: LimitFeature
  label: string
  used: number
  /** null = unlimited. */
  limit: number | null
  /** At or past the limit: nothing more can be added. */
  atLimit: boolean
  /** Already past it — only reachable by a downgrade, never by adding. */
  overLimit: boolean
}

/**
 * Usage against every enforced limit, for the owner's plan page.
 *
 * `overLimit` is the state a downgrade creates and this module deliberately
 * tolerates: the rows stay, and the page says so rather than implying
 * something was removed.
 */
export async function limitUsage(businessId: string, entitlements?: Entitlements): Promise<LimitUsage[]> {
  const ent = entitlements ?? (await getBusinessEntitlements(businessId))
  const features = Object.keys(ENFORCED_LIMITS) as EnforcedLimit[]
  const counts = await Promise.all(features.map((f) => countFor(businessId, f)))

  return features.map((feature, i) => {
    const used = counts[i]
    const limit = featureLimit(ent, feature)
    const label = ENFORCED_LIMITS[feature].many.replace(/^./, (c) => c.toUpperCase())
    return {
      feature,
      label,
      used,
      limit,
      atLimit: !withinLimit(ent, feature, used),
      overLimit: limit !== null && used > limit,
    }
  })
}
