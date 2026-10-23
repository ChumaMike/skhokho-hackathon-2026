/**
 * Forecast Service — the only part of the forecast that touches the database.
 *
 * It reads one business's own paid order history, hands it to the pure
 * arithmetic in `forecast.ts` as integer cents, and returns the result. Reads
 * only: nothing here writes, and no table was added for this feature.
 *
 * Two deliberate choices about what counts as takings:
 *
 *  - `orders.total` is `Decimal(10,2)` RANDS in this schema, so the cents
 *    conversion happens here, in SQL (`total * 100`), where it is exact. The
 *    forecast maths never sees a float rand value.
 *  - A paid order that was later CANCELLED or REFUNDED is left out. The
 *    Analytics overview (`analytics.service.ts`) counts every `PAID` order
 *    regardless of order status, so its totals can sit a little above this
 *    page's history for the same weeks. That is on purpose: money handed back
 *    is not money to plan next month's stock around, and a funding-readiness
 *    number that counts refunds as revenue would be the wrong kind of wrong.
 */

import { prisma } from '@/lib/prisma/client'
import {
  forecastSales,
  HISTORY_WINDOW_DAYS,
  type DailySales,
  type SalesForecast,
} from './forecast'

const DAY_MS = 86_400_000

/** Midnight UTC on the day `date` falls in. */
function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/**
 * Daily paid takings for one business, oldest first, one row per day that had
 * at least one paid order. Gaps are left for the pure module to zero-fill, so
 * the zero-filling rule lives in one place and is tested without a database.
 */
export async function getDailySales(
  businessId: string,
  opts: { days?: number; today?: Date } = {},
): Promise<DailySales[]> {
  const today = opts.today ?? new Date()
  const days = opts.days ?? HISTORY_WINDOW_DAYS
  // Include today: its orders are history for the averages even though the
  // forecast itself starts tomorrow.
  const since = new Date(startOfUtcDay(today).getTime() - (days - 1) * DAY_MS)
  const until = new Date(startOfUtcDay(today).getTime() + DAY_MS)

  const rows = await prisma.$queryRaw<{ day: Date; orders: number; cents: bigint }[]>`
    SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
           COUNT(*)::int AS orders,
           (COALESCE(SUM(total), 0) * 100)::bigint AS cents
    FROM orders
    WHERE business_id = ${businessId}::uuid
      AND created_at >= ${since}
      AND created_at < ${until}
      AND payment_status = 'PAID'
      AND status NOT IN ('CANCELLED', 'REFUNDED')
    GROUP BY 1
    ORDER BY 1`

  return rows.map((row) => ({
    date: isoDate(row.day),
    cents: Number(row.cents),
    orders: row.orders,
  }))
}

/** The next four weeks for one business, from its own order history. */
export async function getSalesForecast(
  businessId: string,
  opts: { today?: Date; weeks?: number } = {},
): Promise<SalesForecast> {
  const today = opts.today ?? new Date()
  const history = await getDailySales(businessId, { today })
  return forecastSales(history, { today, weeks: opts.weeks })
}
