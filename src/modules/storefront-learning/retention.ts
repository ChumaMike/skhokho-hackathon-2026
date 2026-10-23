/**
 * Retention for storefront learning data.
 *
 *   storefront_daily_stats         — kept STOREFRONT_STATS_RETENTION_DAYS, then deleted
 *                                    (daily cron). Deleted with the business (cascade).
 *   storefront_pattern_candidates  — aggregate, cross-business structure only; holds no
 *                                    business id or per-business data, so it survives a
 *                                    business's deletion without retaining anything of theirs.
 *   storefront_revisions.original_spec — the business's own draft; deleted with the business.
 *
 * None of these hold personal information about any visitor or customer.
 */

import { prisma } from '@/lib/prisma/client'
import { storefrontDay } from './events'

/** Long enough for year-on-year insights; short enough not to keep data forever. */
export const STOREFRONT_STATS_RETENTION_DAYS = 400

export async function purgeExpiredStorefrontStats(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(storefrontDay(now).getTime() - STOREFRONT_STATS_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const deleted = await prisma.storefrontDailyStat.deleteMany({ where: { day: { lt: cutoff } } })
  return deleted.count
}

/** A business's own request to clear its storefront analytics. Scoped to that business only. */
export async function deleteStorefrontStatsForBusiness(businessId: string): Promise<number> {
  const deleted = await prisma.storefrontDailyStat.deleteMany({ where: { businessId } })
  return deleted.count
}
