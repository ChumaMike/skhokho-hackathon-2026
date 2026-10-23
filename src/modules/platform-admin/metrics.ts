/**
 * Operational metrics for the admin overview and health pages. Real data only,
 * and cheap: every query is a count/groupBy/aggregate over an indexed column
 * with a time bound (today / 24h / 7d) — nothing scans whole tables row by row.
 */

import { prisma } from '@/lib/prisma/client'
import { isEmailConfigured } from '@/lib/email'
import { lethaEnabled } from '@/modules/skhokholetha/flags'
import { driverLegalConfig } from '@/modules/skhokholetha/legal'
import { monthWindow } from '@/lib/ai/anthropic'
import { getBusinessEntitlements } from '@/modules/billing/subscription.service'
import { featureLimit } from '@/modules/billing/entitlements'

const H = 60 * 60 * 1000
const ACTIVE_DELIVERY: string[] = ['CREATED', 'SEARCHING', 'OFFERED', 'ASSIGNED', 'DRIVER_TO_PICKUP', 'ARRIVED_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_DROPOFF', 'RETURNING']
/** A delivery is "late" when it has been open this long, or searching for a driver this long. */
export const LATE_OPEN_MS = 90 * 60 * 1000
export const LATE_SEARCH_MS = 15 * 60 * 1000

/** Midnight in South Africa (UTC+2, no DST) for "today" figures. */
export function startOfDaySAST(now: Date): Date {
  const sast = new Date(now.getTime() + 2 * H)
  return new Date(Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), sast.getUTCDate()) - 2 * H)
}

const count = <T extends { _count: { _all: number } }>(rows: T[], pick: (r: T) => string) =>
  Object.fromEntries(rows.map((r) => [pick(r), r._count._all])) as Record<string, number>

export async function businessMetrics() {
  const [total, byStatus, bySub, plans] = await Promise.all([
    prisma.business.count(),
    prisma.business.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.businessSubscription.groupBy({ by: ['status', 'planId'], _count: { _all: true } }),
    prisma.plan.findMany({ select: { id: true, name: true, priceCents: true } }),
  ])
  const planById = new Map(plans.map((p) => [p.id, p]))
  const planDistribution: Record<string, number> = {}
  let trials = 0
  let paid = 0
  for (const r of bySub) {
    const plan = r.planId ? planById.get(r.planId) : undefined
    const name = plan?.name ?? 'Default'
    planDistribution[name] = (planDistribution[name] ?? 0) + r._count._all
    if (r.status === 'TRIALING') trials += r._count._all
    if ((r.status === 'ACTIVE' || r.status === 'PAST_DUE') && (plan?.priceCents ?? 0) > 0) paid += r._count._all
  }
  return { total, byStatus: count(byStatus, (r) => r.status), trials, paid, planDistribution }
}

export async function commerceMetrics(now = new Date()) {
  const today = startOfDaySAST(now)
  const day = new Date(now.getTime() - 24 * H)
  const [ordersToday, todayByStatus, paidToday, awaitingMerchant, attempts] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: today } } }),
    prisma.order.groupBy({ by: ['status'], where: { createdAt: { gte: today } }, _count: { _all: true } }),
    prisma.order.aggregate({ where: { createdAt: { gte: today }, paymentStatus: 'PAID' }, _sum: { total: true }, _count: { _all: true } }),
    // Every PENDING order, whenever placed: the merchant has not accepted it yet.
    prisma.order.count({ where: { status: 'PENDING' } }),
    prisma.businessPaymentAttempt.groupBy({ by: ['status'], where: { createdAt: { gte: day } }, _count: { _all: true } }),
  ])
  const gmvCents = Math.round(Number(paidToday._sum.total ?? 0) * 100)
  const paidCount = paidToday._count._all
  const t = count(todayByStatus, (r) => r.status)
  const a = count(attempts, (r) => r.status)
  const succeeded = a.COMPLETE ?? 0
  const failed = (a.FAILED ?? 0) + (a.CANCELLED ?? 0) + (a.EXPIRED ?? 0)
  return {
    ordersToday,
    completedToday: t.COMPLETED ?? 0,
    cancelledToday: (t.CANCELLED ?? 0) + (t.REFUNDED ?? 0),
    awaitingMerchant,
    gmvTodayCents: gmvCents,
    averageOrderCents: paidCount ? Math.round(gmvCents / paidCount) : 0,
    paymentsLast24h: {
      succeeded,
      failed,
      refundDue: a.REFUND_DUE ?? 0,
      pending: (a.CREATED ?? 0) + (a.SUBMITTED ?? 0),
      /** Share of finished attempts that succeeded; null until there is a sample. */
      successRate: succeeded + failed > 0 ? succeeded / (succeeded + failed) : null,
    },
  }
}

export async function deliveryMetrics(now = new Date()) {
  const week = new Date(now.getTime() - 7 * 24 * H)
  const [drivers, availability, open, failedWeek, disputed, lateOpen, lateSearch, latency] = await Promise.all([
    prisma.driverProfile.groupBy({ by: ['verificationStatus'], _count: { _all: true } }),
    prisma.driverProfile.groupBy({ by: ['availability'], where: { verificationStatus: 'APPROVED' }, _count: { _all: true } }),
    prisma.networkDelivery.groupBy({ by: ['status'], where: { status: { in: ACTIVE_DELIVERY as never } }, _count: { _all: true } }),
    prisma.networkDelivery.count({ where: { status: { in: ['FAILED', 'RETURNING', 'RETURNED'] }, updatedAt: { gte: week } } }),
    prisma.networkDelivery.count({ where: { status: 'DISPUTED' } }),
    prisma.networkDelivery.count({ where: { status: { in: ACTIVE_DELIVERY as never }, createdAt: { lt: new Date(now.getTime() - LATE_OPEN_MS) } } }),
    prisma.networkDelivery.count({ where: { status: { in: ['SEARCHING', 'OFFERED'] }, searchingAt: { lt: new Date(now.getTime() - LATE_SEARCH_MS) } } }),
    dispatchLatency(now),
  ])
  const v = count(drivers, (r) => r.verificationStatus)
  const av = count(availability, (r) => r.availability)
  const o = count(open, (r) => r.status)
  return {
    drivers: { pending: v.PENDING_REVIEW ?? 0, approved: v.APPROVED ?? 0, suspended: v.SUSPENDED ?? 0, online: av.ONLINE ?? 0, busy: av.BUSY ?? 0 },
    deliveries: {
      active: Object.values(o).reduce((a, b) => a + b, 0),
      searching: (o.SEARCHING ?? 0) + (o.OFFERED ?? 0) + (o.CREATED ?? 0),
      late: lateOpen,
      searchingTooLong: lateSearch,
      failedLast7d: failedWeek,
      disputed,
    },
    latency,
  }
}

/** Median seconds from searching → first offer, and searching → assigned, over the last 24h. */
export async function dispatchLatency(now = new Date()) {
  const since = new Date(now.getTime() - 24 * H)
  const [row] = await prisma.$queryRaw<{ first_offer_s: number | null; assigned_s: number | null; samples: bigint }[]>`
    SELECT
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (fo.first_offer - nd."searching_at"))) AS first_offer_s,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (nd."assigned_at" - nd."searching_at"))) AS assigned_s,
      COUNT(*) AS samples
    FROM "network_deliveries" nd
    LEFT JOIN LATERAL (
      SELECT MIN(e."created_at") AS first_offer FROM "delivery_events" e
      WHERE e."network_delivery_id" = nd."id" AND e."type" = 'offer_created'
    ) fo ON TRUE
    WHERE nd."searching_at" >= ${since}`
  return {
    medianSecondsToFirstOffer: row?.first_offer_s == null ? null : Math.round(Number(row.first_offer_s)),
    medianSecondsToAssignment: row?.assigned_s == null ? null : Math.round(Number(row.assigned_s)),
    samples: Number(row?.samples ?? 0),
  }
}

export const SECURITY_ACTIONS = [
  'admin_login_failed',
  'admin_mfa_failed',
  'admin_mfa_rate_limited',
  'admin_permission_denied',
  'staff_permission_denied',
  'session_type_mismatch',
  'rate_limit_triggered',
  'payment_webhook_rejected',
  'delivery_code_locked',
] as const

export async function securityMetrics(now = new Date()) {
  const day = new Date(now.getTime() - 24 * H)
  const [byAction, adminActions] = await Promise.all([
    prisma.platformAuditEvent.groupBy({ by: ['action'], where: { category: 'SECURITY', createdAt: { gte: day } }, _count: { _all: true } }),
    prisma.platformAuditEvent.count({ where: { category: 'ADMIN_ACTION', createdAt: { gte: day } } }),
  ])
  return { last24h: count(byAction, (r) => r.action), adminActionsLast24h: adminActions }
}

export async function databaseHealth(): Promise<{ up: boolean; ms: number | null }> {
  const started = Date.now()
  try {
    await Promise.race([prisma.$queryRaw`SELECT 1`, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 5_000))])
    return { up: true, ms: Date.now() - started }
  } catch {
    return { up: false, ms: null }
  }
}

/** Configuration PRESENCE only — never values. */
export function configStatus() {
  const legal = driverLegalConfig()
  return {
    email: isEmailConfigured(),
    cronSecret: Boolean(process.env.CRON_SECRET),
    paymentsEncryptionKey: Boolean(process.env.PAYMENT_ENCRYPTION_KEY),
    livePaymentVerification: process.env.PAYMENTS_ALLOW_LIVE_VERIFICATION === 'true',
    platformBilling: Boolean(process.env.PAYFAST_MERCHANT_ID && process.env.PAYFAST_MERCHANT_KEY),
    externalAi: process.env.BUDDY_EXTERNAL_AI === 'enabled' && Boolean(process.env.ANTHROPIC_API_KEY),
    skhokholetha: {
      network: lethaEnabled('network'),
      driverSignup: lethaEnabled('driverSignup'),
      deliveryRequests: lethaEnabled('deliveryRequests'),
      driverApprovals: lethaEnabled('driverApprovals'),
      legalConfigured: legal.ok,
    },
  }
}

export async function systemMetrics(now = new Date()) {
  const day = new Date(now.getTime() - 24 * H)
  const [emailFailures, notificationFailures, jobFailures, dispatchFailures, paymentProcessingFailures, paymentConnectionsLive, webhookRejections] = await Promise.all([
    prisma.platformAuditEvent.count({ where: { category: 'SYSTEM', action: 'email_failed', createdAt: { gte: day } } }),
    prisma.platformAuditEvent.count({ where: { category: 'SYSTEM', action: 'notification_failed', createdAt: { gte: day } } }),
    prisma.platformAuditEvent.count({ where: { category: 'SYSTEM', action: 'job_failed', createdAt: { gte: day } } }),
    prisma.platformAuditEvent.count({ where: { category: 'SYSTEM', action: 'dispatch_tick_failed', createdAt: { gte: day } } }),
    prisma.platformAuditEvent.count({ where: { category: 'SYSTEM', action: 'payment_notification_processing_failed', createdAt: { gte: day } } }),
    prisma.businessPaymentConnection.count({ where: { environment: 'LIVE', status: 'VERIFIED' } }).catch(() => 0),
    prisma.platformAuditEvent.count({ where: { category: 'SECURITY', action: 'payment_webhook_rejected', createdAt: { gte: day } } }),
  ])
  return { emailFailures, notificationFailures, jobFailures, dispatchFailures, paymentProcessingFailures, paymentConnectionsLive, webhookRejections }
}

/**
 * Platform-wide AI figures for the Control Centre: calls, failures, refused
 * calls, estimated provider spend, and which businesses are close to their
 * monthly allowance. Counts and sums only — never a prompt or a draft.
 */
export async function aiPlatformMetrics(now = new Date()) {
  const month = monthWindow(now)
  const day = new Date(now.getTime() - 24 * H)
  const [okMonth, failedMonth, blockedMonth, costMonth, ok24, failed24, perBusiness] = await Promise.all([
    prisma.aiUsageEvent.count({ where: { outcome: 'OK', createdAt: { gte: month.start, lt: month.end } } }),
    prisma.aiUsageEvent.count({ where: { outcome: { in: ['FAILED', 'TIMEOUT', 'REJECTED_OUTPUT'] }, createdAt: { gte: month.start, lt: month.end } } }),
    prisma.aiUsageEvent.count({ where: { outcome: { in: ['BLOCKED_ALLOWANCE', 'BLOCKED_ENTITLEMENT', 'BLOCKED_RATE_LIMIT', 'BLOCKED_DISABLED'] }, createdAt: { gte: month.start, lt: month.end } } }),
    prisma.aiUsageEvent.aggregate({ where: { outcome: 'OK', createdAt: { gte: month.start, lt: month.end } }, _sum: { estimatedCostUsdMicros: true, inputTokens: true, outputTokens: true } }),
    prisma.aiUsageEvent.count({ where: { outcome: 'OK', createdAt: { gte: day } } }),
    prisma.aiUsageEvent.count({ where: { outcome: { in: ['FAILED', 'TIMEOUT', 'REJECTED_OUTPUT'] }, createdAt: { gte: day } } }),
    prisma.aiUsageEvent.groupBy({
      by: ['businessId'],
      where: { outcome: 'OK', metered: true, businessId: { not: null }, createdAt: { gte: month.start, lt: month.end } },
      _count: { _all: true },
      orderBy: { _count: { businessId: 'desc' } },
      take: 50,
    }),
  ])
  // Allowance check for the busiest businesses only (bounded fan-out).
  const approaching: { businessId: string; name: string; used: number; limit: number }[] = []
  const ids = perBusiness.map((r) => r.businessId).filter((id): id is string => !!id)
  const names = new Map((await prisma.business.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((b) => [b.id, b.name]))
  for (const row of perBusiness) {
    if (!row.businessId) continue
    const ent = await getBusinessEntitlements(row.businessId, now)
    const limit = featureLimit(ent, 'ai_generations_monthly')
    if (limit !== null && limit > 0 && row._count._all >= Math.ceil(limit * 0.8)) {
      approaching.push({ businessId: row.businessId, name: names.get(row.businessId) ?? row.businessId, used: row._count._all, limit })
    }
  }
  return {
    month: { ok: okMonth, failed: failedMonth, blocked: blockedMonth, estimatedCostUsdMicros: costMonth._sum.estimatedCostUsdMicros ?? 0, tokens: (costMonth._sum.inputTokens ?? 0) + (costMonth._sum.outputTokens ?? 0) },
    last24h: { ok: ok24, failed: failed24 },
    approaching,
  }
}
