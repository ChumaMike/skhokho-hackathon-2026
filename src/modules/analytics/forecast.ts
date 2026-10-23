/**
 * Cash-flow Forecast — the pure arithmetic, with no database and no Prisma.
 *
 * Everything here is a function of the daily sales history handed to it, so it
 * can be tested against fixtures (`forecast.fixtures.ts`) and so the method can
 * be explained to a merchant line by line. The reader of the Forecast page is a
 * shop owner deciding whether they can afford stock next week, so the rules are
 * deliberately simple enough to show on the page: a day-of-week average, a
 * straight-line trend through the weekly totals, and a cap on how far that line
 * may be carried forward.
 *
 * Money is INTEGER CENTS throughout. Orders are stored as `Decimal(10,2)` rands
 * in the database (`orders.total`), so the caller converts at the boundary —
 * see `forecast.service.ts`. Averaging and trending in cents keeps the
 * arithmetic exact, and every number that reaches a person carries its
 * `R 1 234.56` form alongside it.
 */

import { formatCents } from '@/lib/utils'

/** One day of the business's own takings. `cents` is PAID revenue only. */
export interface DailySales {
  /** Calendar day in UTC, ISO `YYYY-MM-DD`. */
  date: string
  /** Paid revenue that day, in integer cents. */
  cents: number
  /** Paid orders that day — context for the page, never used in the money maths. */
  orders: number
}

/** 0 = Sunday … 6 = Saturday, matching `Date#getUTCDay`. */
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** Monday first — how a trading week reads on the page. */
export const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

export interface WeekdayAverage {
  weekday: number
  name: string
  /** How many of this weekday the history covers (the divisor). */
  daysCounted: number
  averageCents: number
  averageDisplay: string
  /** Quiet enough to be worth acting on — see `SLOW_DAY_SHARE`. */
  slow: boolean
}

export interface ForecastDay {
  date: string
  weekday: number
  name: string
  cents: number
  display: string
  slow: boolean
}

export interface ForecastWeek {
  weekStart: string
  weekEnd: string
  cents: number
  display: string
  days: ForecastDay[]
}

/** One of the complete past weeks the trend was measured on. */
export interface HistoryWeek {
  weekStart: string
  weekEnd: string
  cents: number
  display: string
}

export type ForecastConfidence = 'none' | 'thin' | 'fair' | 'good'

export interface SalesForecast {
  /** First forecast day (the day after `today`). */
  from: string
  weeks: ForecastWeek[]
  days: ForecastDay[]
  totalCents: number
  totalDisplay: string
  /** All seven weekdays, Monday first, including days with no trading. */
  weekdayAverages: WeekdayAverage[]
  /** Names of the slow weekdays, Monday first. */
  slowWeekdays: string[]
  /**
   * The complete past weeks the trend was measured on, oldest first — so the
   * page can show what actually happened next to what is forecast.
   */
  historyWeeks: HistoryWeek[]
  trend: {
    /** Least-squares slope through the weekly totals, cents per week. */
    perWeekCents: number
    /** The size of that slope as money, without a sign. */
    perWeekDisplay: string
    direction: 'up' | 'down' | 'flat'
    /** The multiplier used for each forecast week, after the cap. */
    weekFactors: number[]
    /** True when the cap held the line back. */
    capped: boolean
  }
  history: {
    firstDate: string | null
    lastDate: string | null
    /** Calendar days covered, first to last inclusive. */
    daysCovered: number
    /** Complete 7-day blocks available to the trend. */
    completeWeeks: number
    /** Days that actually took money. */
    tradingDays: number
    totalCents: number
    totalDisplay: string
  }
  confidence: ForecastConfidence
  /** Plain-English method, shown on the page so the numbers can be checked. */
  method: string[]
}

/** Weeks forecast ahead. Four is what the page shows and what the report quotes. */
export const FORECAST_WEEKS = 4

/**
 * History older than this is ignored: how a shop traded twelve weeks ago says
 * little about next Tuesday, and a long window makes the averages slow to
 * notice a real change.
 */
export const HISTORY_WINDOW_DAYS = 84

/**
 * A weekday is "slow" when its average is below this share of the average
 * weekday. Three fifths is low enough not to flag a normal quiet-ish day, and
 * high enough to catch the day that genuinely isn't paying for itself.
 */
export const SLOW_DAY_SHARE = 0.6

/**
 * How far the trend may carry the forecast. A straight line through a handful
 * of weekly totals is a weak instrument: four weeks out it can predict double
 * or nothing at all, and nobody should order stock against either. The
 * multiplier is held inside 50% up or down, and the page says when it bit.
 */
export const TREND_CAP = 0.5

const DAY_MS = 86_400_000

function utcDay(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  return isoDate(new Date(utcDay(iso).getTime() + days * DAY_MS))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * The history as one row per calendar day, oldest first, zero-filled between
 * the first and last day with data and trimmed to the window.
 *
 * Zero-filling matters: a day the shop took nothing is real information about
 * that weekday, and dropping the gap would average only the good days and
 * overstate every forecast. Days BEFORE the first row are not invented, so a
 * business that opened last week isn't charged with empty weeks it never traded.
 */
export function fillDailyHistory(history: readonly DailySales[], windowDays = HISTORY_WINDOW_DAYS): DailySales[] {
  const byDate = new Map<string, DailySales>()
  for (const row of history) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue
    const existing = byDate.get(row.date)
    // Two rows for one day are summed rather than one of them silently winning.
    byDate.set(
      row.date,
      existing
        ? { date: row.date, cents: existing.cents + row.cents, orders: existing.orders + row.orders }
        : { date: row.date, cents: row.cents, orders: row.orders },
    )
  }
  const dates = [...byDate.keys()].sort()
  if (dates.length === 0) return []

  const last = dates[dates.length - 1]!
  const earliestAllowed = addDays(last, -(windowDays - 1))
  const first = dates.find((d) => d >= earliestAllowed) ?? last

  const filled: DailySales[] = []
  for (let cursor = first; cursor <= last; cursor = addDays(cursor, 1)) {
    filled.push(byDate.get(cursor) ?? { date: cursor, cents: 0, orders: 0 })
  }
  return filled
}

/** Average takings for each weekday, Monday first. Zero-filled days count. */
export function weekdayAverages(filled: readonly DailySales[]): WeekdayAverage[] {
  const totals = new Map<number, { cents: number; days: number }>()
  for (const row of filled) {
    const weekday = utcDay(row.date).getUTCDay()
    const bucket = totals.get(weekday) ?? { cents: 0, days: 0 }
    bucket.cents += row.cents
    bucket.days += 1
    totals.set(weekday, bucket)
  }

  const averages: WeekdayAverage[] = WEEKDAY_DISPLAY_ORDER.map((weekday) => {
    const bucket = totals.get(weekday)
    const averageCents = bucket && bucket.days > 0 ? Math.round(bucket.cents / bucket.days) : 0
    return {
      weekday,
      name: WEEKDAY_NAMES[weekday]!,
      daysCounted: bucket?.days ?? 0,
      averageCents,
      averageDisplay: formatCents(averageCents),
      slow: false,
    }
  })

  // "Slow" is relative to this business's own week, never to another shop's.
  // Weekdays with no history yet stay out of the comparison, so they cannot
  // drag the bar down and have every real trading day flagged as slow.
  const counted = averages.filter((a) => a.daysCounted > 0)
  const mean = counted.length > 0 ? counted.reduce((sum, a) => sum + a.averageCents, 0) / counted.length : 0
  if (mean > 0) {
    for (const average of averages) {
      if (average.daysCounted > 0) average.slow = average.averageCents < mean * SLOW_DAY_SHARE
    }
  }
  return averages
}

/**
 * The most recent complete 7-day blocks of history, oldest first. Blocks are
 * counted back from the LAST day with data so the newest week is whole; a
 * part-week at the old end is dropped rather than compared as though it were a
 * full week.
 */
export function weeklyBlocks(filled: readonly DailySales[]): HistoryWeek[] {
  const completeWeeks = Math.floor(filled.length / 7)
  if (completeWeeks === 0) return []
  const start = filled.length - completeWeeks * 7
  const blocks: HistoryWeek[] = []
  for (let week = 0; week < completeWeeks; week++) {
    const from = start + week * 7
    const days = filled.slice(from, from + 7)
    const cents = days.reduce((sum, row) => sum + row.cents, 0)
    blocks.push({
      weekStart: days[0]!.date,
      weekEnd: days[6]!.date,
      cents,
      display: formatCents(cents),
    })
  }
  return blocks
}

/** Just the money from `weeklyBlocks`, which is what the trend is measured on. */
export function weeklyTotals(filled: readonly DailySales[]): number[] {
  return weeklyBlocks(filled).map((block) => block.cents)
}

/**
 * Least-squares slope through the weekly totals: cents per week. Needs two
 * complete weeks; with fewer there is no trend to measure, and the answer is
 * flat rather than a guess.
 */
export function weeklyTrendCents(totals: readonly number[]): number {
  const n = totals.length
  if (n < 2) return 0
  const meanX = (n - 1) / 2
  const meanY = totals.reduce((sum, t) => sum + t, 0) / n
  let numerator = 0
  let denominator = 0
  for (let i = 0; i < n; i++) {
    numerator += (i - meanX) * (totals[i]! - meanY)
    denominator += (i - meanX) ** 2
  }
  return denominator === 0 ? 0 : Math.round(numerator / denominator)
}

/**
 * How much to trust it, in one word. 'none' means there is nothing to work
 * from at all; a business trading for a few days gets 'thin' rather than
 * 'none', because it has a real (if short) history.
 */
function confidenceOf(daysCovered: number, completeWeeks: number): ForecastConfidence {
  if (daysCovered === 0) return 'none'
  if (completeWeeks < 2) return 'thin'
  if (completeWeeks < 4) return 'fair'
  return 'good'
}

/**
 * The next four weeks, day by day, from this business's own order history.
 *
 * `today` is injected so the page, the report and the tests all forecast from
 * one agreed day; the forecast starts the day AFTER it, because today's
 * takings are still coming in.
 */
export function forecastSales(
  history: readonly DailySales[],
  opts: { today?: Date; weeks?: number; windowDays?: number } = {},
): SalesForecast {
  const today = opts.today ?? new Date()
  const weeks = opts.weeks ?? FORECAST_WEEKS
  const filled = fillDailyHistory(history, opts.windowDays ?? HISTORY_WINDOW_DAYS)

  const averages = weekdayAverages(filled)
  const historyWeeks = weeklyBlocks(filled)
  const totals = historyWeeks.map((block) => block.cents)
  const trendCents = weeklyTrendCents(totals)
  const completeWeeks = totals.length
  const tradingDays = filled.filter((row) => row.cents > 0).length
  const historyCents = filled.reduce((sum, row) => sum + row.cents, 0)

  const expectedWeekCents = averages.reduce((sum, a) => sum + a.averageCents, 0)
  const bySlot = new Map(averages.map((a) => [a.weekday, a]))

  const weekFactors: number[] = []
  let capped = false
  for (let week = 1; week <= weeks; week++) {
    const raw = expectedWeekCents > 0 ? 1 + (week * trendCents) / expectedWeekCents : 1
    const factor = clamp(raw, 1 - TREND_CAP, 1 + TREND_CAP)
    if (factor !== raw) capped = true
    weekFactors.push(factor)
  }

  const from = isoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) + DAY_MS))
  const forecastWeeks: ForecastWeek[] = []
  const days: ForecastDay[] = []
  for (let week = 0; week < weeks; week++) {
    const weekDays: ForecastDay[] = []
    for (let offset = 0; offset < 7; offset++) {
      const date = addDays(from, week * 7 + offset)
      const weekday = utcDay(date).getUTCDay()
      const average = bySlot.get(weekday)
      const cents = Math.max(0, Math.round((average?.averageCents ?? 0) * weekFactors[week]!))
      weekDays.push({
        date,
        weekday,
        name: WEEKDAY_NAMES[weekday]!,
        cents,
        display: formatCents(cents),
        slow: average?.slow ?? false,
      })
    }
    days.push(...weekDays)
    const weekCents = weekDays.reduce((sum, d) => sum + d.cents, 0)
    forecastWeeks.push({
      weekStart: weekDays[0]!.date,
      weekEnd: weekDays[6]!.date,
      cents: weekCents,
      display: formatCents(weekCents),
      days: weekDays,
    })
  }

  const totalCents = days.reduce((sum, d) => sum + d.cents, 0)
  const direction = trendCents > 0 ? 'up' : trendCents < 0 ? 'down' : 'flat'

  return {
    from,
    weeks: forecastWeeks,
    days,
    totalCents,
    totalDisplay: formatCents(totalCents),
    weekdayAverages: averages,
    slowWeekdays: averages.filter((a) => a.slow).map((a) => a.name),
    historyWeeks,
    trend: {
      perWeekCents: trendCents,
      perWeekDisplay: formatCents(Math.abs(trendCents)),
      direction,
      weekFactors,
      capped,
    },
    history: {
      firstDate: filled[0]?.date ?? null,
      lastDate: filled[filled.length - 1]?.date ?? null,
      daysCovered: filled.length,
      completeWeeks,
      tradingDays,
      totalCents: historyCents,
      totalDisplay: formatCents(historyCents),
    },
    confidence: confidenceOf(filled.length, completeWeeks),
    method: methodLines({ averages, trendCents, expectedWeekCents, completeWeeks, capped, direction }),
  }
}

/** The same sums in words, so an owner can check the forecast by hand. */
function methodLines(input: {
  averages: readonly WeekdayAverage[]
  trendCents: number
  expectedWeekCents: number
  completeWeeks: number
  capped: boolean
  direction: 'up' | 'down' | 'flat'
}): string[] {
  const lines: string[] = []
  if (input.completeWeeks === 0 && input.expectedWeekCents === 0) {
    lines.push('There are no paid orders to work from yet, so there is nothing to forecast. Take a few orders and this page fills itself in.')
    return lines
  }

  lines.push(
    'Each weekday gets its own average: everything you were paid on that weekday, divided by how many of those days your history covers. A day you took nothing counts as zero.',
    `At today's level that comes to ${formatCents(input.expectedWeekCents)} a week.`,
  )

  if (input.completeWeeks < 2) {
    lines.push('There is less than two full weeks of history, so no trend is applied yet — the forecast is the weekday averages as they stand.')
  } else if (input.direction === 'flat') {
    lines.push(`Your ${input.completeWeeks} full weeks of takings are level, so nothing is added or taken off.`)
  } else {
    const verb = input.direction === 'up' ? 'rising' : 'falling'
    const sign = input.direction === 'up' ? 'plus' : 'minus'
    lines.push(
      `A straight line through your ${input.completeWeeks} full weeks of takings is ${verb} by ${formatCents(Math.abs(input.trendCents))} a week, so each forecast week is multiplied by 1 ${sign} (weeks ahead x ${formatCents(Math.abs(input.trendCents))} / ${formatCents(input.expectedWeekCents)}).`,
    )
  }

  if (input.capped) {
    lines.push(`That line was held to ${Math.round(TREND_CAP * 100)}% up or down: four weeks is too far to carry a short history any further.`)
  }

  const slow = input.averages.filter((a) => a.slow).map((a) => a.name)
  if (slow.length > 0) {
    lines.push(`A day is marked slow when its average is under ${Math.round(SLOW_DAY_SHARE * 100)}% of your average day: ${slow.join(', ')}.`)
  }
  // Said plainly because the Analytics overview counts every paid order
  // whatever its order status, so the two pages can differ by the refunds.
  lines.push('Paid orders only; cancelled orders are left out — so this can read a little under the Analytics overview.')
  return lines
}
