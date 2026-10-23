/**
 * Funding readiness — the one-pager a merchant can print and hand to a lender,
 * a funder or a landlord. Pure: every figure is a function of the inputs, so
 * it is tested against fixtures and nothing on the page can come from
 * anywhere but this business's own orders.
 *
 * The audience is someone deciding whether to put money behind this shop, so
 * the rule throughout is that a number must be checkable. Each one is shown
 * with the sum that produced it (`formula`), nothing is weighted by a hidden
 * constant, and a figure with too little history behind it says so instead of
 * being quietly presented as solid.
 *
 * Money is integer cents in, `R 1 234.56` out. No credit scoring, no rating,
 * no recommendation to lend: a consistency score here is a description of how
 * steady the takings have been, and the page says exactly that.
 */

import { formatCents } from '@/lib/utils'
import type { HistoryWeek, SalesForecast } from './forecast'

/** One calendar month of paid takings. */
export interface MonthlyRevenue {
  /** `YYYY-MM`. */
  month: string
  cents: number
  orders: number
  display: string
  /** True for the month still running — it cannot be compared with a whole one. */
  partial: boolean
}

export interface FundingInput {
  businessName: string
  today: Date
  /** When the business registered on Skhokho. */
  registeredAt: Date | null
  /** The first paid order ever — when trading actually started here. */
  firstPaidOrderAt: Date | null
  /** Every paid order, not just the forecast window. */
  lifetime: { paidOrders: number; paidCents: number }
  /** Paid takings per calendar month, oldest first; the last may be partial. */
  months: readonly { month: string; cents: number; orders: number; partial: boolean }[]
  /** Complete recent weeks, oldest first — what the consistency score reads. */
  weeks: readonly HistoryWeek[]
  customers: {
    /** Memberships at this business (its own customer list). */
    total: number
    /** How many of them have ever paid for an order. */
    withOrders: number
    /** How many have paid for two or more. */
    withRepeatOrders: number
  }
  forecast: SalesForecast
}

export type ConsistencyBand = 'too early' | 'uneven' | 'fair' | 'strong'

export interface FundingReadiness {
  businessName: string
  /** ISO date the report was produced — a lender needs to know how fresh it is. */
  preparedOn: string
  tradingSince: string | null
  monthsTrading: number
  monthsTradingDisplay: string
  paidOrders: number
  revenueTotalCents: number
  revenueTotalDisplay: string
  averageOrderCents: number
  averageOrderDisplay: string
  months: MonthlyRevenue[]
  revenueTrend: {
    weekDirection: 'up' | 'down' | 'flat'
    weekChangeDisplay: string
    /** Last whole month against the one before it, when there are two. */
    monthOnMonth: { from: string; to: string; changeDisplay: string; direction: 'up' | 'down' | 'flat' } | null
  }
  repeatCustomers: {
    total: number
    withOrders: number
    repeat: number
    /** Whole percent of ordering customers who have ordered again. */
    ratePercent: number
    rateDisplay: string
  }
  consistency: {
    score: number
    band: ConsistencyBand
    weeksCounted: number
    meanWeekCents: number
    meanWeekDisplay: string
    swingCents: number
    swingDisplay: string
    /** The sum, in words and in symbols, as shown on the page. */
    formula: string[]
  }
  forecast: { nextWeekDisplay: string; fourWeekDisplay: string; confidence: SalesForecast['confidence'] }
  /** Plain-English points a lender can read off the page. */
  notes: string[]
}

/**
 * Weeks of history the consistency score needs before it is worth printing.
 * Two weeks can only ever say "these two differed by X", which is not
 * consistency; four gives a swing that means something.
 */
export const CONSISTENCY_MIN_WEEKS = 4

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** `October 2026` from `2026-10`. */
export function monthLabel(month: string): string {
  const [year, index] = month.split('-')
  const name = MONTH_NAMES[Number(index) - 1]
  return name && year ? `${name} ${year}` : month
}

/** Whole months between two dates, never negative. */
export function wholeMonthsBetween(from: Date, to: Date): number {
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) - (to.getUTCDate() < from.getUTCDate() ? 1 : 0)
  return Math.max(0, months)
}

/**
 * Average absolute distance of a week from the average week. Chosen over a
 * standard deviation on purpose: "your weeks are usually R 300 either side of
 * R 2 400" is a sentence a shop owner and a lender can both check by hand,
 * and squaring the differences would make one unusual week dominate a number
 * that is meant to describe the ordinary ones.
 */
export function averageSwingCents(totals: readonly number[]): number {
  if (totals.length === 0) return 0
  const mean = totals.reduce((sum, value) => sum + value, 0) / totals.length
  const swing = totals.reduce((sum, value) => sum + Math.abs(value - mean), 0) / totals.length
  return Math.round(swing)
}

function bandOf(score: number, weeks: number): ConsistencyBand {
  if (weeks < CONSISTENCY_MIN_WEEKS) return 'too early'
  if (score >= 75) return 'strong'
  if (score >= 50) return 'fair'
  return 'uneven'
}

export function buildFundingReadiness(input: FundingInput): FundingReadiness {
  const { lifetime, forecast } = input
  const tradingFrom = input.firstPaidOrderAt ?? input.registeredAt
  const monthsTrading = tradingFrom ? wholeMonthsBetween(tradingFrom, input.today) : 0

  const averageOrderCents = lifetime.paidOrders > 0 ? Math.round(lifetime.paidCents / lifetime.paidOrders) : 0

  const months: MonthlyRevenue[] = input.months.map((month) => ({
    month: month.month,
    cents: month.cents,
    orders: month.orders,
    display: formatCents(month.cents),
    partial: month.partial,
  }))

  // Month on month compares the last two WHOLE months. The month still running
  // is always behind a finished one, and showing that as a decline would be a
  // lie told by a calendar.
  const whole = months.filter((month) => !month.partial)
  const previous = whole[whole.length - 2]
  const latest = whole[whole.length - 1]
  const monthOnMonth =
    previous && latest
      ? {
          from: monthLabel(previous.month),
          to: monthLabel(latest.month),
          changeDisplay: formatCents(Math.abs(latest.cents - previous.cents)),
          direction: (latest.cents > previous.cents ? 'up' : latest.cents < previous.cents ? 'down' : 'flat') as 'up' | 'down' | 'flat',
        }
      : null

  const weekTotals = input.weeks.map((week) => week.cents)
  const meanWeekCents = weekTotals.length > 0 ? Math.round(weekTotals.reduce((sum, value) => sum + value, 0) / weekTotals.length) : 0
  const swingCents = averageSwingCents(weekTotals)
  // 100 means every week was the same; 0 means the swing is as big as the
  // average week itself. Clamped, so a single wild week cannot produce a
  // negative score that looks like a different kind of measurement.
  const rawScore = meanWeekCents > 0 ? 100 - (swingCents / meanWeekCents) * 100 : 0
  const score = Math.max(0, Math.min(100, Math.round(rawScore)))
  const band = bandOf(score, weekTotals.length)

  const repeatRate =
    input.customers.withOrders > 0 ? Math.round((input.customers.withRepeatOrders / input.customers.withOrders) * 100) : 0

  return {
    businessName: input.businessName,
    preparedOn: isoDate(input.today),
    tradingSince: tradingFrom ? isoDate(tradingFrom) : null,
    monthsTrading,
    monthsTradingDisplay:
      monthsTrading === 0 ? 'under a month' : `${monthsTrading} ${monthsTrading === 1 ? 'month' : 'months'}`,
    paidOrders: lifetime.paidOrders,
    revenueTotalCents: lifetime.paidCents,
    revenueTotalDisplay: formatCents(lifetime.paidCents),
    averageOrderCents,
    averageOrderDisplay: formatCents(averageOrderCents),
    months,
    revenueTrend: {
      weekDirection: forecast.trend.direction,
      weekChangeDisplay: forecast.trend.perWeekDisplay,
      monthOnMonth,
    },
    repeatCustomers: {
      total: input.customers.total,
      withOrders: input.customers.withOrders,
      repeat: input.customers.withRepeatOrders,
      ratePercent: repeatRate,
      rateDisplay: `${repeatRate}%`,
    },
    consistency: {
      score,
      band,
      weeksCounted: weekTotals.length,
      meanWeekCents,
      meanWeekDisplay: formatCents(meanWeekCents),
      swingCents,
      swingDisplay: formatCents(swingCents),
      formula: consistencyFormula({ score, weeks: weekTotals.length, meanWeekCents, swingCents, band }),
    },
    forecast: {
      nextWeekDisplay: forecast.weeks[0]?.display ?? formatCents(0),
      fourWeekDisplay: forecast.totalDisplay,
      confidence: forecast.confidence,
    },
    notes: readinessNotes(input, { monthsTrading, averageOrderCents, repeatRate, score, band, weeks: weekTotals.length }),
  }
}

/** The consistency sum, written out so anyone can redo it on paper. */
function consistencyFormula(input: {
  score: number
  weeks: number
  meanWeekCents: number
  swingCents: number
  band: ConsistencyBand
}): string[] {
  if (input.weeks < CONSISTENCY_MIN_WEEKS) {
    return [
      `A consistency score needs at least ${CONSISTENCY_MIN_WEEKS} full weeks of trading; there ${input.weeks === 1 ? 'is' : 'are'} ${input.weeks} so far.`,
      'Until then this page shows the weeks as they are, without a score.',
    ]
  }
  return [
    `Average week: your ${input.weeks} full weeks of takings added up and divided by ${input.weeks} = ${formatCents(input.meanWeekCents)}.`,
    `Average swing: how far each week sat from that average, added up and divided by ${input.weeks} = ${formatCents(input.swingCents)}.`,
    `Score: 100 - (swing / average week) x 100 = 100 - (${formatCents(input.swingCents)} / ${formatCents(input.meanWeekCents)}) x 100 = ${input.score}.`,
    '100 would mean every week was identical. It describes how steady the takings have been — it is not a credit score and says nothing about whether money should be lent.',
  ]
}

/** What the figures add up to, in sentences a lender can read off the page. */
function readinessNotes(
  input: FundingInput,
  computed: { monthsTrading: number; averageOrderCents: number; repeatRate: number; score: number; band: ConsistencyBand; weeks: number },
): string[] {
  const notes: string[] = []

  notes.push(
    computed.monthsTrading === 0
      ? `${input.businessName} has been taking orders on Skhokho for under a month.`
      : `${input.businessName} has been taking orders on Skhokho for ${computed.monthsTrading} ${computed.monthsTrading === 1 ? 'month' : 'months'}.`,
  )

  notes.push(
    `${input.lifetime.paidOrders} paid ${input.lifetime.paidOrders === 1 ? 'order' : 'orders'} in that time, ${formatCents(input.lifetime.paidCents)} in total, averaging ${formatCents(computed.averageOrderCents)} an order.`,
  )

  if (input.customers.withOrders > 0) {
    notes.push(
      `${input.customers.withRepeatOrders} of ${input.customers.withOrders} paying customers have come back for another order — a repeat rate of ${computed.repeatRate}%.`,
    )
  } else {
    notes.push('No customer has paid for an order yet, so there is no repeat rate to report.')
  }

  if (computed.band === 'too early') {
    notes.push(`Too early for a consistency score: that needs ${CONSISTENCY_MIN_WEEKS} full weeks of trading.`)
  } else {
    const words: Record<Exclude<ConsistencyBand, 'too early'>, string> = {
      strong: 'the takings have been steady week to week',
      fair: 'the takings move about a bit week to week',
      uneven: 'the takings are uneven week to week',
    }
    notes.push(`Consistency ${computed.score} out of 100 over ${computed.weeks} full weeks — ${words[computed.band]}.`)
  }

  const trend = input.forecast.trend
  if (trend.direction === 'up') {
    notes.push(`Takings have been climbing by about ${trend.perWeekDisplay} a week, and the next four weeks are forecast at ${input.forecast.totalDisplay}.`)
  } else if (trend.direction === 'down') {
    notes.push(`Takings have been slipping by about ${trend.perWeekDisplay} a week, and the next four weeks are forecast at ${input.forecast.totalDisplay}.`)
  } else {
    notes.push(`Takings have been level, and the next four weeks are forecast at ${input.forecast.totalDisplay}.`)
  }

  notes.push('Every figure here is this business’s own paid orders on Skhokho. Cash taken outside Skhokho is not included, and nothing on this page has been audited.')
  return notes
}
