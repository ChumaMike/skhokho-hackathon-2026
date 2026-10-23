/**
 * Funding readiness — the database side of the one-pager.
 *
 * Reads only, one business at a time, and the same definition of "takings" the
 * forecast uses: paid orders, with cancelled and refunded orders left out.
 * Unlike the forecast this looks at the business's WHOLE history, because
 * months trading and lifetime revenue are exactly what a lender asks for.
 *
 * Customers are counted through `memberships` — the business's own pairwise
 * view. No global customer id and no phone number is read here, and none
 * reaches the report.
 */

import { prisma } from '@/lib/prisma/client'
import { getDailySales } from './forecast.service'
import { buildFundingReadiness, type FundingInput, type FundingReadiness } from './funding-readiness'
import { fillDailyHistory, forecastSales, weeklyBlocks } from './forecast'

/** Months of history the report prints. A year is what a funder expects to see. */
export const REPORT_MONTHS = 12

/** `2026-10` for a date, in UTC. */
function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

export async function getFundingReadiness(
  businessId: string,
  opts: { today?: Date } = {},
): Promise<FundingReadiness | null> {
  const today = opts.today ?? new Date()
  const monthsSince = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (REPORT_MONTHS - 1), 1))

  // The daily history is read once and the forecast computed from it here,
  // rather than calling getSalesForecast as well: the two would run the same
  // query twice for one page.
  const [business, lifetimeRows, monthRows, customerRows, membershipRows, dailySales] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { name: true, createdAt: true } }),

    prisma.$queryRaw<{ paid_orders: number; paid_cents: bigint; first_paid: Date | null }[]>`
      SELECT COUNT(*)::int AS paid_orders,
             (COALESCE(SUM(total), 0) * 100)::bigint AS paid_cents,
             MIN(created_at) AS first_paid
      FROM orders
      WHERE business_id = ${businessId}::uuid
        AND payment_status = 'PAID'
        AND status NOT IN ('CANCELLED', 'REFUNDED')`,

    prisma.$queryRaw<{ month_start: Date; orders: number; cents: bigint }[]>`
      SELECT date_trunc('month', created_at AT TIME ZONE 'UTC')::date AS month_start,
             COUNT(*)::int AS orders,
             (COALESCE(SUM(total), 0) * 100)::bigint AS cents
      FROM orders
      WHERE business_id = ${businessId}::uuid
        AND created_at >= ${monthsSince}
        AND payment_status = 'PAID'
        AND status NOT IN ('CANCELLED', 'REFUNDED')
      GROUP BY 1
      ORDER BY 1`,

    // Repeat custom is counted by ORDERS PER MEMBERSHIP, not by when a
    // customer was first seen: a business that imported its customer list in
    // one afternoon would otherwise look as though nobody had ever come back.
    // POS orders with no membership cannot be attributed to a customer at all,
    // so they are not counted here (the report says so).
    prisma.$queryRaw<{ with_orders: number; repeat_customers: number }[]>`
      SELECT COUNT(*)::int AS with_orders,
             COUNT(*) FILTER (WHERE paid_orders >= 2)::int AS repeat_customers
      FROM (
        SELECT membership_id, COUNT(*) AS paid_orders
        FROM orders
        WHERE business_id = ${businessId}::uuid
          AND payment_status = 'PAID'
          AND status NOT IN ('CANCELLED', 'REFUNDED')
          AND membership_id IS NOT NULL
        GROUP BY membership_id
      ) AS per_customer`,

    prisma.$queryRaw<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM memberships
      WHERE business_id = ${businessId}::uuid AND status = 'active'`,

    getDailySales(businessId, { today }),
  ])

  if (!business) return null

  const lifetime = lifetimeRows[0]
  const customers = customerRows[0]
  const thisMonth = monthKey(today)
  const filled = fillDailyHistory(dailySales)
  const forecast = forecastSales(dailySales, { today })

  const input: FundingInput = {
    businessName: business.name,
    today,
    registeredAt: business.createdAt,
    firstPaidOrderAt: lifetime?.first_paid ?? null,
    lifetime: {
      paidOrders: lifetime?.paid_orders ?? 0,
      paidCents: Number(lifetime?.paid_cents ?? 0),
    },
    months: monthRows.map((row) => {
      const month = monthKey(row.month_start)
      return { month, cents: Number(row.cents), orders: row.orders, partial: month === thisMonth }
    }),
    weeks: weeklyBlocks(filled),
    customers: {
      total: membershipRows[0]?.total ?? 0,
      withOrders: customers?.with_orders ?? 0,
      withRepeatOrders: customers?.repeat_customers ?? 0,
    },
    forecast,
  }

  return buildFundingReadiness(input)
}
