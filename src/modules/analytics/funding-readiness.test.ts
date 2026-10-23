import test from 'node:test'
import assert from 'node:assert/strict'
import {
  averageSwingCents,
  buildFundingReadiness,
  monthLabel,
  wholeMonthsBetween,
  CONSISTENCY_MIN_WEEKS,
  type FundingInput,
} from './funding-readiness'
import { fillDailyHistory, forecastSales, weeklyBlocks, type HistoryWeek } from './forecast'
import { FIXTURE_TODAY, STEADY_SHOP, WEEKEND_KITCHEN } from './forecast.fixtures'

const TODAY = FIXTURE_TODAY

/** Four whole weeks ending the day before the forecast starts, at `cents` each. */
function weeksOf(totals: readonly number[]): HistoryWeek[] {
  return totals.map((cents, index) => ({
    weekStart: `2026-09-${String(14 + index * 7).padStart(2, '0')}`,
    weekEnd: `2026-09-${String(20 + index * 7).padStart(2, '0')}`,
    cents,
    display: `R ${cents / 100}`,
  }))
}

function input(over: Partial<FundingInput> = {}): FundingInput {
  const history = over.forecast ? [] : STEADY_SHOP
  return {
    businessName: 'Kota Tainment',
    today: TODAY,
    registeredAt: new Date('2026-05-02T08:00:00Z'),
    firstPaidOrderAt: new Date('2026-05-20T08:00:00Z'),
    lifetime: { paidOrders: 240, paidCents: 1_440_000 },
    months: [
      { month: '2026-08', cents: 400_000, orders: 70, partial: false },
      { month: '2026-09', cents: 500_000, orders: 85, partial: false },
      { month: '2026-10', cents: 300_000, orders: 55, partial: true },
    ],
    weeks: weeklyBlocks(fillDailyHistory(STEADY_SHOP)),
    customers: { total: 90, withOrders: 60, withRepeatOrders: 24 },
    forecast: forecastSales(history, { today: TODAY }),
    ...over,
  }
}

// ---------------------------------------------------------------------------
// The small sums
// ---------------------------------------------------------------------------

test('whole months counts completed months only, and never goes negative', () => {
  assert.equal(wholeMonthsBetween(new Date('2026-05-20T00:00:00Z'), new Date('2026-10-22T00:00:00Z')), 5)
  assert.equal(wholeMonthsBetween(new Date('2026-05-23T00:00:00Z'), new Date('2026-10-22T00:00:00Z')), 4)
  assert.equal(wholeMonthsBetween(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-22T00:00:00Z')), 0)
  assert.equal(wholeMonthsBetween(new Date('2027-01-01T00:00:00Z'), new Date('2026-10-22T00:00:00Z')), 0)
})

test('the average swing is the plain average distance from the average week', () => {
  assert.equal(averageSwingCents([200_000, 200_000, 200_000, 200_000]), 0)
  assert.equal(averageSwingCents([100_000, 300_000, 100_000, 300_000]), 100_000)
  assert.equal(averageSwingCents([]), 0)
})

test('a month reads as a month and a year', () => {
  assert.equal(monthLabel('2026-10'), 'October 2026')
  assert.equal(monthLabel('2026-01'), 'January 2026')
})

// ---------------------------------------------------------------------------
// The figures on the report
// ---------------------------------------------------------------------------

test('months trading runs from the first paid order, not from registration', () => {
  const report = buildFundingReadiness(input())
  assert.equal(report.tradingSince, '2026-05-20')
  assert.equal(report.monthsTrading, 5)
  assert.equal(report.monthsTradingDisplay, '5 months')
})

test('a business that has never been paid falls back to when it registered', () => {
  const report = buildFundingReadiness(input({ firstPaidOrderAt: null }))
  assert.equal(report.tradingSince, '2026-05-02')
})

test('under a month trading is said in words, not as 0 months', () => {
  const report = buildFundingReadiness(input({ firstPaidOrderAt: new Date('2026-10-14T08:00:00Z') }))
  assert.equal(report.monthsTrading, 0)
  assert.equal(report.monthsTradingDisplay, 'under a month')
  assert.match(report.notes[0]!, /for under a month/)
})

test('the average order is the lifetime revenue over the paid orders', () => {
  const report = buildFundingReadiness(input())
  assert.equal(report.averageOrderCents, 6_000)
  assert.equal(report.averageOrderDisplay, 'R 60.00')
  assert.equal(report.revenueTotalDisplay, 'R 14 400.00')
  assert.equal(report.paidOrders, 240)
})

test('no paid orders means no average order, not a division by zero', () => {
  const report = buildFundingReadiness(input({ lifetime: { paidOrders: 0, paidCents: 0 } }))
  assert.equal(report.averageOrderCents, 0)
  assert.equal(report.averageOrderDisplay, 'R 0.00')
})

test('the repeat rate is customers who ordered again over customers who ordered', () => {
  const report = buildFundingReadiness(input())
  assert.equal(report.repeatCustomers.ratePercent, 40)
  assert.equal(report.repeatCustomers.rateDisplay, '40%')
  assert.equal(report.repeatCustomers.withOrders, 60)
  assert.equal(report.repeatCustomers.repeat, 24)
  // The customer LIST is reported separately: a business can hold customers
  // who have never ordered, and they must not dilute the rate.
  assert.equal(report.repeatCustomers.total, 90)
  assert.match(report.notes.join(' '), /24 of 60 paying customers have come back/)
})

test('nobody has paid yet: the rate is not reported as 0% success', () => {
  const report = buildFundingReadiness(input({ customers: { total: 12, withOrders: 0, withRepeatOrders: 0 } }))
  assert.equal(report.repeatCustomers.ratePercent, 0)
  assert.match(report.notes.join(' '), /No customer has paid for an order yet/)
})

test('month on month compares the last two WHOLE months, never the one still running', () => {
  const report = buildFundingReadiness(input())
  assert.deepEqual(report.revenueTrend.monthOnMonth, {
    from: 'August 2026',
    to: 'September 2026',
    changeDisplay: 'R 1 000.00',
    direction: 'up',
  })
  // The partial month is still shown, flagged as incomplete.
  assert.equal(report.months.at(-1)?.month, '2026-10')
  assert.equal(report.months.at(-1)?.partial, true)
})

test('one whole month is not enough to compare', () => {
  const report = buildFundingReadiness(
    input({ months: [{ month: '2026-10', cents: 300_000, orders: 55, partial: true }] }),
  )
  assert.equal(report.revenueTrend.monthOnMonth, null)
})

// ---------------------------------------------------------------------------
// Consistency
// ---------------------------------------------------------------------------

test('identical weeks score 100 and read as strong', () => {
  const report = buildFundingReadiness(input({ weeks: weeksOf([200_000, 200_000, 200_000, 200_000]) }))
  assert.equal(report.consistency.score, 100)
  assert.equal(report.consistency.band, 'strong')
  assert.equal(report.consistency.swingDisplay, 'R 0.00')
})

test('weeks that swing half the average week score 50 and read as fair', () => {
  const report = buildFundingReadiness(input({ weeks: weeksOf([100_000, 300_000, 100_000, 300_000]) }))
  assert.equal(report.consistency.meanWeekCents, 200_000)
  assert.equal(report.consistency.swingCents, 100_000)
  assert.equal(report.consistency.score, 50)
  assert.equal(report.consistency.band, 'fair')
})

test('a swing as big as the average week scores 0 and reads as uneven, never negative', () => {
  const report = buildFundingReadiness(input({ weeks: weeksOf([0, 400_000, 0, 400_000]) }))
  assert.equal(report.consistency.score, 0)
  assert.equal(report.consistency.band, 'uneven')
})

test('too few weeks is said plainly instead of being scored', () => {
  const report = buildFundingReadiness(input({ weeks: weeksOf([200_000, 210_000]) }))
  assert.equal(report.consistency.band, 'too early')
  assert.equal(report.consistency.weeksCounted, 2)
  assert.match(report.consistency.formula[0]!, new RegExp(`at least ${CONSISTENCY_MIN_WEEKS} full weeks`))
  assert.match(report.notes.join(' '), /Too early for a consistency score/)
})

test('the formula shows the real numbers, so the score can be redone by hand', () => {
  const report = buildFundingReadiness(input({ weeks: weeksOf([100_000, 300_000, 100_000, 300_000]) }))
  const formula = report.consistency.formula.join(' ')
  assert.match(formula, /divided by 4 = R 2 000\.00/)
  assert.match(formula, /100 - \(R 1 000\.00 \/ R 2 000\.00\) x 100 = 50/)
  assert.match(formula, /not a credit score/)
})

// ---------------------------------------------------------------------------
// What the report says it is
// ---------------------------------------------------------------------------

test('the forecast figures on the report are the forecast page figures', () => {
  const forecast = forecastSales(WEEKEND_KITCHEN, { today: TODAY })
  const report = buildFundingReadiness(input({ forecast }))
  assert.equal(report.forecast.nextWeekDisplay, forecast.weeks[0]!.display)
  assert.equal(report.forecast.fourWeekDisplay, forecast.totalDisplay)
  assert.equal(report.forecast.confidence, forecast.confidence)
})

test('the report is dated, and says it is unaudited and not a credit decision', () => {
  const report = buildFundingReadiness(input())
  assert.equal(report.preparedOn, '2026-10-22')
  assert.match(report.notes.at(-1)!, /has been audited/)
  assert.match(report.notes.at(-1)!, /Cash taken outside Skhokho is not included/)
})

test('every money figure on the report is formatted R 1 234.56', () => {
  const report = buildFundingReadiness(input())
  const money = [
    report.revenueTotalDisplay,
    report.averageOrderDisplay,
    report.consistency.meanWeekDisplay,
    report.consistency.swingDisplay,
    report.forecast.nextWeekDisplay,
    report.forecast.fourWeekDisplay,
    ...report.months.map((month) => month.display),
  ]
  for (const value of money) assert.match(value, /^R (\d{1,3}( \d{3})*)\.\d{2}$/, value)
})

test('no customer name, phone number or global id can reach the report', () => {
  const report = buildFundingReadiness(input())
  const text = [...report.notes, ...report.consistency.formula, report.businessName].join(' ')
  assert.doesNotMatch(text, /\+27|\b0\d{9}\b/)
  assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/)
})
