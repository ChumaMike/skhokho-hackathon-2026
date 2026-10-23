/**
 * Sales histories for the forecast tests — so the forecast is tested without a
 * database, the way `forecast.ts` is written to allow.
 *
 * The shapes here are the ones that actually turn up in the pilot: a township
 * kitchen with quiet Mondays and a busy weekend, a shop that is growing, one
 * that is fading, and a business that opened five days ago. `WEEKEND_KITCHEN`
 * deliberately mirrors the demo business the hackathon judges will see (a
 * weekend peak on a Monday-to-Sunday pattern), so what the tests assert is
 * what the demo shows.
 *
 * Every number is fixed: no randomness, no `new Date()`, so a failure means
 * the arithmetic changed and never that the suite ran on a different day.
 */

import type { DailySales } from './forecast'

const DAY_MS = 86_400_000

/** Thursday. Every fixture's history ends here and forecasts from the 23rd. */
export const FIXTURE_TODAY = new Date('2026-10-22T09:00:00Z')

export interface HistoryOptions {
  /** Last day of the history, ISO `YYYY-MM-DD`. */
  endDate: string
  /** How many calendar days the history covers, ending on `endDate`. */
  days: number
  /** Cents taken on each weekday at the START of the history (0 = Sunday). */
  weekdayCents: Readonly<Record<number, number>>
  /** Paid orders on each weekday; defaults to one per R 100 so totals stay sane. */
  weekdayOrders?: Readonly<Record<number, number>>
  /** Compound growth per day, e.g. 0.01 for +1% a day. Negative for a decline. */
  dailyGrowth?: number
}

/**
 * A daily history with a fixed weekday shape and an optional steady growth or
 * decline. Days whose weekday maps to 0 cents are kept as real zero-takings
 * days (a closed Sunday is data, not a gap).
 */
export function buildDailyHistory(opts: HistoryOptions): DailySales[] {
  const { endDate, days, weekdayCents, weekdayOrders, dailyGrowth = 0 } = opts
  const end = new Date(`${endDate}T00:00:00Z`).getTime()
  const rows: DailySales[] = []
  for (let i = 0; i < days; i++) {
    const day = new Date(end - (days - 1 - i) * DAY_MS)
    const weekday = day.getUTCDay()
    const base = weekdayCents[weekday] ?? 0
    const cents = Math.round(base * (1 + dailyGrowth) ** i)
    const orders = cents === 0 ? 0 : (weekdayOrders?.[weekday] ?? Math.max(1, Math.round(cents / 10_000)))
    rows.push({ date: day.toISOString().slice(0, 10), cents, orders })
  }
  return rows
}

/** Six level weeks: R 400 a day flat, so the trend must come out at zero. */
export const STEADY_SHOP: DailySales[] = buildDailyHistory({
  endDate: '2026-10-22',
  days: 42,
  weekdayCents: { 0: 40_000, 1: 40_000, 2: 40_000, 3: 40_000, 4: 40_000, 5: 40_000, 6: 40_000 },
})

/**
 * A kitchen with the demo business's week: quiet Monday to Wednesday, busy
 * Friday and Saturday, closed-ish Sunday. Six whole weeks, level, so the
 * weekday shape is the only thing the forecast can be reading.
 */
export const WEEKEND_KITCHEN: DailySales[] = buildDailyHistory({
  endDate: '2026-10-22',
  days: 42,
  weekdayCents: {
    1: 21_000, // Monday
    2: 24_000,
    3: 27_000,
    4: 33_000,
    5: 57_000, // Friday
    6: 72_000, // Saturday
    0: 15_000, // Sunday
  },
  weekdayOrders: { 1: 7, 2: 8, 3: 9, 4: 11, 5: 19, 6: 24, 0: 5 },
})

/** Climbing a little under 1% a day — a real trend for the line to find. */
export const GROWING_SHOP: DailySales[] = buildDailyHistory({
  endDate: '2026-10-22',
  days: 42,
  weekdayCents: { 0: 30_000, 1: 30_000, 2: 30_000, 3: 30_000, 4: 30_000, 5: 30_000, 6: 30_000 },
  dailyGrowth: 0.008,
})

/** Falling away at the same rate, so the forecast must come down week by week. */
export const FADING_SHOP: DailySales[] = buildDailyHistory({
  endDate: '2026-10-22',
  days: 42,
  weekdayCents: { 0: 60_000, 1: 60_000, 2: 60_000, 3: 60_000, 4: 60_000, 5: 60_000, 6: 60_000 },
  dailyGrowth: -0.008,
})

/** Collapsing fast enough that four weeks of the raw line would predict nothing. */
export const COLLAPSING_SHOP: DailySales[] = buildDailyHistory({
  endDate: '2026-10-22',
  days: 28,
  weekdayCents: { 0: 90_000, 1: 90_000, 2: 90_000, 3: 90_000, 4: 90_000, 5: 90_000, 6: 90_000 },
  dailyGrowth: -0.05,
})

/** Open five days. Not enough for a trend, and the page must say so. */
export const NEW_SHOP: DailySales[] = buildDailyHistory({
  endDate: '2026-10-22',
  days: 5,
  weekdayCents: { 0: 12_000, 1: 12_000, 2: 12_000, 3: 12_000, 4: 12_000, 5: 12_000, 6: 12_000 },
})

/** Registered, never traded. */
export const NO_SALES: DailySales[] = []

/**
 * One Saturday R 1 000 and nothing else, three weeks ago — the awkward case
 * where zero-filling is the difference between an honest forecast and one that
 * promises R 1 000 every Saturday for a month.
 */
export const ONE_GOOD_SATURDAY: DailySales[] = [
  { date: '2026-10-03', cents: 100_000, orders: 12 },
  { date: '2026-10-22', cents: 0, orders: 0 },
]
