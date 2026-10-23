/**
 * Human-readable AI usage for one business, this calendar month. Merchants
 * see generations used / remaining; tokens and cost estimates stay internal
 * (the Control Centre shows them to platform admins).
 */

import { prisma } from '@/lib/prisma/client'
import { allowanceFor, monthWindow } from '@/lib/ai/anthropic'
import { getBusinessEntitlements } from '@/modules/billing/subscription.service'
import type { Entitlements } from '@/modules/billing/entitlements'

export interface UsageSummary {
  month: { start: Date; end: Date }
  generationsUsed: number
  /** null = unlimited; 0 = none included */
  generationsLimit: number | null
  generationsRemaining: number | null
  tokensUsed: number
  tokenBudget: number | null
  failures: number
  blocked: number
  estimatedCostUsdMicros: number
  byCapability: { capability: string; calls: number }[]
}

export async function getUsageSummary(businessId: string, opts: { entitlements?: Entitlements; now?: Date } = {}): Promise<UsageSummary> {
  const now = opts.now ?? new Date()
  const entitlements = opts.entitlements ?? (await getBusinessEntitlements(businessId, now))
  const month = monthWindow(now)
  const inMonth = { businessId, createdAt: { gte: month.start, lt: month.end } }
  const [allowance, failures, blocked, cost, byCap] = await Promise.all([
    allowanceFor(businessId, entitlements, now),
    prisma.aiUsageEvent.count({ where: { ...inMonth, outcome: { in: ['FAILED', 'TIMEOUT', 'REJECTED_OUTPUT'] } } }),
    prisma.aiUsageEvent.count({ where: { ...inMonth, outcome: { in: ['BLOCKED_ALLOWANCE', 'BLOCKED_ENTITLEMENT', 'BLOCKED_RATE_LIMIT', 'BLOCKED_DISABLED'] } } }),
    prisma.aiUsageEvent.aggregate({ where: { ...inMonth, outcome: 'OK' }, _sum: { estimatedCostUsdMicros: true } }),
    prisma.aiUsageEvent.groupBy({ by: ['capability'], where: { ...inMonth, outcome: 'OK' }, _count: { _all: true }, orderBy: { _count: { capability: 'desc' } }, take: 10 }),
  ])
  return {
    month,
    generationsUsed: allowance.generationsUsed,
    generationsLimit: allowance.generationsLimit,
    generationsRemaining: allowance.generationsLimit === null ? null : Math.max(0, allowance.generationsLimit - allowance.generationsUsed),
    tokensUsed: allowance.tokensUsed,
    tokenBudget: allowance.tokenBudget,
    failures,
    blocked,
    estimatedCostUsdMicros: cost._sum.estimatedCostUsdMicros ?? 0,
    byCapability: byCap.map((r) => ({ capability: r.capability, calls: r._count._all })),
  }
}

/** "34 / 100 generations used this month" — or the unlimited / not-included wording. */
export function usageLine(u: Pick<UsageSummary, 'generationsUsed' | 'generationsLimit'>): string {
  if (u.generationsLimit === null) return `${u.generationsUsed} AI generations used this month`
  if (u.generationsLimit === 0) return 'AI generations are not included in your plan'
  return `${u.generationsUsed} / ${u.generationsLimit} AI generations used this month`
}
