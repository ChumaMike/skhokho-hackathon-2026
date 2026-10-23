/**
 * Entitlement resolution — pure, no Prisma.
 *
 *   Plan ─▶ Subscription (status + dates) ─▶ effective plan ─▶ + overrides ─▶ Entitlements
 *
 * The subscription decides WHICH plan applies right now; the plan's
 * entitlement rows decide WHAT that grants; unexpired per-business
 * overrides adjust individual keys. Every downgrade path lands on the
 * default plan — access shrinks, data is never deleted.
 *
 * Fails closed: an unknown feature key, a missing plan, or an inconsistent
 * subscription never GRANTS anything.
 */

import { FEATURE_KEYS, FEATURES, isFeatureKey, type BooleanFeature, type FeatureKey, type LimitFeature } from './features'

/**
 * How long a lapsed PAID plan keeps working when no explicit graceEndsAt is set.
 *
 * 10 days, so the card retry schedule planned for Phase B (day 0, 2, 5, 8 —
 * docs/specs/2026-10-21-plans.md §6) finishes with two days to spare. A plan
 * must never lapse while a retry could still succeed.
 *
 * This is grace for a FAILED PAYMENT. It deliberately does not apply to the
 * end of a free trial — see subscriptionAccess.
 */
export const SUBSCRIPTION_GRACE_DAYS = 10
const DAY_MS = 24 * 60 * 60 * 1000

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED'

export type SubscriptionInput = {
  planId: string | null
  status: SubscriptionStatus
  currentPeriodEnd: Date | null
  graceEndsAt: Date | null
} | null

export type PlanInput = {
  id: string
  code: string
  name: string
  entitlements: { featureKey: string; enabled: boolean; limitValue: number | null }[]
}

export type OverrideInput = { featureKey: string; enabled: boolean; limitValue: number | null; expiresAt: Date | null }

/** Why the effective plan is what it is — shown to owners and used by billing later. */
export type AccessState =
  | 'NO_SUBSCRIPTION' // default plan
  | 'ACTIVE'
  | 'TRIALING'
  | 'GRACE' // lapsed or payment failed — paid plan still on until accessUntil
  | 'CANCELLED_PENDING' // cancelled — paid plan still on until accessUntil
  | 'EXPIRED' // default plan
  | 'UNCONFIGURED' // no default plan in the database — nothing granted

export type FeatureGrant = { enabled: boolean; limit: number | null }

export type Entitlements = {
  planCode: string | null
  planName: string | null
  state: AccessState
  /** When the current (paid) access ends, if it's on a clock. */
  accessUntil: Date | null
  features: Record<FeatureKey, FeatureGrant>
}

/** Which plan the subscription entitles the business to right now. */
export function subscriptionAccess(
  subscription: SubscriptionInput,
  now: Date,
): { usesSubscribedPlan: boolean; state: AccessState; accessUntil: Date | null } {
  if (!subscription) return { usesSubscribedPlan: false, state: 'NO_SUBSCRIPTION', accessUntil: null }

  const { status, currentPeriodEnd, graceEndsAt } = subscription
  const graceEnd = graceEndsAt ?? (currentPeriodEnd ? new Date(currentPeriodEnd.getTime() + SUBSCRIPTION_GRACE_DAYS * DAY_MS) : null)
  const expired = { usesSubscribedPlan: false, state: 'EXPIRED' as const, accessUntil: null }

  switch (status) {
    case 'ACTIVE':
      if (!currentPeriodEnd || currentPeriodEnd > now) {
        return { usesSubscribedPlan: true, state: status, accessUntil: currentPeriodEnd }
      }
      // Period ended without renewal: the grace period still applies.
      return graceEnd && graceEnd > now ? { usesSubscribedPlan: true, state: 'GRACE', accessUntil: graceEnd } : expired

    case 'TRIALING':
      // A trial that is still running grants its plan; one that has ended
      // falls straight to the default plan with NO grace. Grace exists to
      // protect a paying customer whose payment failed — there is nothing to
      // retry at the end of a free trial, and extending a trial by another
      // 10 days silently would make the advertised 14 days a lie.
      // Nothing is deleted: see docs/specs/2026-10-21-plans.md §4.
      return !currentPeriodEnd || currentPeriodEnd > now
        ? { usesSubscribedPlan: true, state: 'TRIALING', accessUntil: currentPeriodEnd }
        : expired

    case 'PAST_DUE':
      // No date to measure grace from is an inconsistent row — fail closed.
      return graceEnd && graceEnd > now ? { usesSubscribedPlan: true, state: 'GRACE', accessUntil: graceEnd } : expired

    case 'CANCELLED':
      // Cancelling stops renewal, not access already paid for.
      return currentPeriodEnd && currentPeriodEnd > now
        ? { usesSubscribedPlan: true, state: 'CANCELLED_PENDING', accessUntil: currentPeriodEnd }
        : expired

    case 'EXPIRED':
    default:
      return expired
  }
}

function emptyFeatures(): Record<FeatureKey, FeatureGrant> {
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, { enabled: false, limit: 0 }])) as Record<FeatureKey, FeatureGrant>
}

function grantFrom(key: FeatureKey, enabled: boolean, limitValue: number | null): FeatureGrant {
  if (!enabled) return { enabled: false, limit: 0 }
  // Boolean features carry no limit; a limit feature with null is unlimited.
  return { enabled: true, limit: FEATURES[key].kind === 'limit' ? limitValue : null }
}

export function resolveEntitlements(input: {
  subscription: SubscriptionInput
  /** The subscription's own plan, if it has one. */
  subscribedPlan: PlanInput | null
  defaultPlan: PlanInput | null
  overrides: OverrideInput[]
  now: Date
}): Entitlements {
  const access = subscriptionAccess(input.subscription, input.now)
  const plan = (access.usesSubscribedPlan && input.subscribedPlan) || input.defaultPlan
  const features = emptyFeatures()

  if (!plan) {
    return { planCode: null, planName: null, state: 'UNCONFIGURED', accessUntil: null, features }
  }

  for (const row of plan.entitlements) {
    if (isFeatureKey(row.featureKey)) features[row.featureKey] = grantFrom(row.featureKey, row.enabled, row.limitValue)
  }
  for (const override of input.overrides) {
    if (override.expiresAt && override.expiresAt <= input.now) continue
    if (isFeatureKey(override.featureKey)) {
      features[override.featureKey] = grantFrom(override.featureKey, override.enabled, override.limitValue)
    }
  }

  // A subscription naming a plan that couldn't be loaded falls back to the
  // default plan, and the state must say so rather than claim that plan is
  // active. (planId null is different: it simply IS the default plan.)
  const fellBack = access.usesSubscribedPlan && !input.subscribedPlan && !!input.subscription?.planId
  return {
    planCode: plan.code,
    planName: plan.name,
    state: fellBack ? 'NO_SUBSCRIPTION' : access.state,
    accessUntil: fellBack ? null : access.accessUntil,
    features,
  }
}

export function hasFeature(entitlements: Entitlements, key: BooleanFeature): boolean {
  return entitlements.features[key].enabled
}

/** The cap for a limit feature: a number, null for unlimited, 0 when not granted. */
export function featureLimit(entitlements: Entitlements, key: LimitFeature): number | null {
  const grant = entitlements.features[key]
  return grant.enabled ? grant.limit : 0
}

/** Whether one more item fits under a limit feature, given how many exist now. */
export function withinLimit(entitlements: Entitlements, key: LimitFeature, currentCount: number): boolean {
  const limit = featureLimit(entitlements, key)
  return limit === null || currentCount < limit
}
