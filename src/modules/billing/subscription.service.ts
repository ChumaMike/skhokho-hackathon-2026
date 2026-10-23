/**
 * Subscriptions & entitlements — database side.
 *
 * Every read is keyed by businessId, which callers take from the signed
 * session (dashboard) — never from client input. This is the SaaS
 * subscription a business holds with Skhokho Labs; it never touches
 * BusinessPaymentConnection/BusinessPaymentAttempt (a merchant's own
 * customers paying them), and platform billing will get its own records.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { resolveEntitlements, type Entitlements, type SubscriptionStatus } from './entitlements'
import { isFeatureKey } from './features'

const PLAN_WITH_ENTITLEMENTS = {
  select: {
    id: true,
    code: true,
    name: true,
    entitlements: { select: { featureKey: true, enabled: true, limitValue: true } },
  },
} as const

/** What `businessId` may use right now. Fails closed (grants nothing) if no default plan exists. */
export async function getBusinessEntitlements(businessId: string, now: Date = new Date()): Promise<Entitlements> {
  const [subscription, defaultPlan, overrides] = await Promise.all([
    prisma.businessSubscription.findUnique({
      where: { businessId },
      select: {
        planId: true,
        status: true,
        currentPeriodEnd: true,
        graceEndsAt: true,
        planRef: PLAN_WITH_ENTITLEMENTS,
      },
    }),
    prisma.plan.findFirst({ where: { isDefault: true }, ...PLAN_WITH_ENTITLEMENTS }),
    prisma.entitlementOverride.findMany({
      where: { businessId },
      select: { featureKey: true, enabled: true, limitValue: true, expiresAt: true },
    }),
  ])

  if (!defaultPlan) {
    // A deploy problem (the plans seed didn't run), not a business problem.
    console.error('[entitlements] no default plan configured — granting nothing')
  }

  return resolveEntitlements({
    subscription: subscription
      ? {
          planId: subscription.planId,
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
          graceEndsAt: subscription.graceEndsAt,
        }
      : null,
    subscribedPlan: subscription?.planRef ?? null,
    defaultPlan,
    overrides,
    now,
  })
}

export class UnknownPlanError extends Error {
  constructor(code: string) {
    super(`No plan with code ${code}`)
    this.name = 'UnknownPlanError'
  }
}

/**
 * Put a business on a plan (platform-admin / billing use only — no merchant
 * UI calls this). Upserts so a business with no subscription row gets one.
 */
export async function changeBusinessPlan(
  businessId: string,
  planCode: string,
  options: { status?: SubscriptionStatus; currentPeriodEnd?: Date | null } = {},
) {
  const plan = await prisma.plan.findUnique({ where: { code: planCode }, select: { id: true } })
  if (!plan) throw new UnknownPlanError(planCode)

  const data = {
    planId: plan.id,
    status: options.status ?? 'ACTIVE',
    currentPeriodEnd: options.currentPeriodEnd ?? null,
    graceEndsAt: null,
    cancelledAt: null,
  } satisfies Prisma.BusinessSubscriptionUncheckedUpdateInput

  return prisma.businessSubscription.upsert({
    where: { businessId },
    create: { businessId, ...data },
    update: data,
  })
}

/** Lifecycle transitions billing will drive: payment failed, cancelled, ended. */
export async function setSubscriptionStatus(
  businessId: string,
  status: SubscriptionStatus,
  options: { graceEndsAt?: Date | null; currentPeriodEnd?: Date | null } = {},
) {
  return prisma.businessSubscription.update({
    where: { businessId },
    data: {
      status,
      ...(options.graceEndsAt !== undefined ? { graceEndsAt: options.graceEndsAt } : {}),
      ...(options.currentPeriodEnd !== undefined ? { currentPeriodEnd: options.currentPeriodEnd } : {}),
      ...(status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
    },
  })
}

/**
 * A per-business exception to its plan (pilot, comp, support fix). Admin
 * use only; always carries a reason; optional expiry. The resolver applies
 * it on the next read — no deploy, no code change.
 */
export async function setEntitlementOverride(
  businessId: string,
  featureKey: string,
  input: { enabled: boolean; limitValue?: number | null; expiresAt?: Date | null; reason: string },
) {
  if (!isFeatureKey(featureKey)) throw new UnknownFeatureError(featureKey)
  const data = { enabled: input.enabled, limitValue: input.limitValue ?? null, expiresAt: input.expiresAt ?? null, reason: input.reason }
  return prisma.entitlementOverride.upsert({
    where: { businessId_featureKey: { businessId, featureKey } },
    create: { businessId, featureKey, ...data },
    update: data,
  })
}

export async function clearEntitlementOverride(businessId: string, featureKey: string): Promise<boolean> {
  const r = await prisma.entitlementOverride.deleteMany({ where: { businessId, featureKey } })
  return r.count === 1
}

export async function listEntitlementOverrides(businessId: string) {
  return prisma.entitlementOverride.findMany({ where: { businessId }, orderBy: { featureKey: 'asc' }, select: { featureKey: true, enabled: true, limitValue: true, reason: true, expiresAt: true, createdAt: true } })
}

export class UnknownFeatureError extends Error {
  constructor(key: string) {
    super(`No feature with key ${key}`)
    this.name = 'UnknownFeatureError'
  }
}

export type PublicPlan = {
  code: string
  name: string
  tagline: string | null
  priceCents: number | null
  currency: string
  interval: 'MONTHLY' | 'YEARLY' | null
  entitlements: { featureKey: string; enabled: boolean; limitValue: number | null }[]
}

/** Active, public plans in display order — for the showcase. */
export async function listPublicPlans(): Promise<PublicPlan[]> {
  return prisma.plan.findMany({
    where: { isPublic: true, isActive: true },
    orderBy: { sortOrder: 'asc' },
    select: {
      code: true,
      name: true,
      tagline: true,
      priceCents: true,
      currency: true,
      interval: true,
      entitlements: { select: { featureKey: true, enabled: true, limitValue: true } },
    },
  })
}
