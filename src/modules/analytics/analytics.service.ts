/**
 * Analytics Service — the first real thing behind the `hasAnalytics` plan
 * flag, which previously gated nothing (see the professional-SaaS
 * assessment). Deliberately numbers-only, no charting library: the
 * `BusinessMetric` table this would eventually roll up into is unpopulated,
 * so a chart here would imply a tracked history that doesn't exist yet.
 * Weekly bucketing is computed live via `date_trunc`, not read from
 * `BusinessMetric` — fine at today's data volume, same tradeoff
 * `tenant.service.ts`'s `searchActiveBusinesses` already makes.
 */

import { prisma } from '@/lib/prisma/client'

export interface WeeklyAnalyticsRow {
  /** Monday of the week, ISO date (YYYY-MM-DD). */
  weekStart: string
  orders: number
  /** Orders marked paid — the right denominator for average order value. */
  paidOrders: number
  cancelledOrders: number
  /** Orders placed for delivery; the rest were collection. */
  deliveryOrders: number
  /** Sum of PAID orders' totals only — a PENDING order isn't revenue yet. */
  revenue: number
  newCustomers: number
  appointments: number
}

function mondayOf(d: Date): Date {
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = monday.getUTCDay() // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day
  monday.setUTCDate(monday.getUTCDate() + diff)
  return monday
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Last `weeks` calendar weeks (Monday-start), oldest first, zero-filled. */
export async function getWeeklyAnalytics(
  businessId: string,
  weeks = 6,
): Promise<WeeklyAnalyticsRow[]> {
  const thisMonday = mondayOf(new Date())
  const since = new Date(thisMonday.getTime() - (weeks - 1) * 7 * 86_400_000)

  const [orderRows, apptRows, customerRows] = await Promise.all([
    prisma.$queryRaw<{ week_start: Date; orders: number; paid_orders: number; cancelled_orders: number; delivery_orders: number; revenue: string | null }[]>`
      SELECT date_trunc('week', created_at)::date AS week_start,
             COUNT(*)::int AS orders,
             COUNT(*) FILTER (WHERE payment_status = 'PAID')::int AS paid_orders,
             COUNT(*) FILTER (WHERE status IN ('CANCELLED', 'REFUNDED'))::int AS cancelled_orders,
             COUNT(*) FILTER (WHERE fulfilment_method = 'DELIVERY')::int AS delivery_orders,
             COALESCE(SUM(total) FILTER (WHERE payment_status = 'PAID'), 0)::numeric AS revenue
      FROM orders
      WHERE business_id = ${businessId}::uuid AND created_at >= ${since}
      GROUP BY 1`,
    prisma.$queryRaw<{ week_start: Date; appointments: number }[]>`
      SELECT date_trunc('week', start_time)::date AS week_start,
             COUNT(*)::int AS appointments
      FROM appointments
      WHERE business_id = ${businessId}::uuid AND start_time >= ${since}
      GROUP BY 1`,
    prisma.$queryRaw<{ week_start: Date; new_customers: number }[]>`
      SELECT date_trunc('week', first_seen)::date AS week_start,
             COUNT(*)::int AS new_customers
      FROM memberships
      WHERE business_id = ${businessId}::uuid AND first_seen >= ${since}
      GROUP BY 1`,
  ])

  const ordersByWeek = new Map(orderRows.map((r) => [isoDate(r.week_start), r]))
  const apptsByWeek = new Map(apptRows.map((r) => [isoDate(r.week_start), r]))
  const customersByWeek = new Map(customerRows.map((r) => [isoDate(r.week_start), r]))

  const result: WeeklyAnalyticsRow[] = []
  for (let i = 0; i < weeks; i++) {
    const weekStart = new Date(since.getTime() + i * 7 * 86_400_000)
    const key = isoDate(weekStart)
    result.push({
      weekStart: key,
      orders: ordersByWeek.get(key)?.orders ?? 0,
      paidOrders: ordersByWeek.get(key)?.paid_orders ?? 0,
      cancelledOrders: ordersByWeek.get(key)?.cancelled_orders ?? 0,
      deliveryOrders: ordersByWeek.get(key)?.delivery_orders ?? 0,
      revenue: Number(ordersByWeek.get(key)?.revenue ?? 0),
      newCustomers: customersByWeek.get(key)?.new_customers ?? 0,
      appointments: apptsByWeek.get(key)?.appointments ?? 0,
    })
  }
  return result
}
