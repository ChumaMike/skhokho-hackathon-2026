import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fillDailyHistory,
  forecastSales,
  weekdayAverages,
  weeklyTotals,
  weeklyTrendCents,
  SLOW_DAY_SHARE,
  TREND_CAP,
  type DailySales,
} from './forecast'
import {
  buildDailyHistory,
  COLLAPSING_SHOP,
  FADING_SHOP,
  FIXTURE_TODAY,
  GROWING_SHOP,
  NEW_SHOP,
  NO_SALES,
  ONE_GOOD_SATURDAY,
  STEADY_SHOP,
  WEEKEND_KITCHEN,
} from './forecast.fixtures'

const at = (history: readonly DailySales[]) => forecastSales(history, { today: FIXTURE_TODAY })

// ---------------------------------------------------------------------------
// The history, before any forecasting
// ---------------------------------------------------------------------------

test('a day with no orders between two trading days is kept as a zero, not dropped', () => {
  const filled = fillDailyHistory([
    { date: '2026-10-19', cents: 50_000, orders: 5 },
    { date: '2026-10-22', cents: 10_000, orders: 1 },
  ])
  assert.deepEqual(
    filled.map((d) => [d.date, d.cents]),
    [
      ['2026-10-19', 50_000],
      ['2026-10-20', 0],
      ['2026-10-21', 0],
      ['2026-10-22', 10_000],
    ],
  )
})

test('days before the first order are not invented', () => {
  const filled = fillDailyHistory(NEW_SHOP)
  assert.equal(filled.length, 5)
  assert.equal(filled[0]?.date, '2026-10-18')
})

test('history older than the window is left out', () => {
  const filled = fillDailyHistory(
    [{ date: '2026-01-01', cents: 999_000, orders: 9 }, ...STEADY_SHOP],
    84,
  )
  assert.equal(filled[0]?.date, '2026-09-11')
  assert.equal(filled.length, 42)
})

test('two rows for the same day are added together, not one overwriting the other', () => {
  const filled = fillDailyHistory([
    { date: '2026-10-22', cents: 10_000, orders: 1 },
    { date: '2026-10-22', cents: 2_500, orders: 1 },
  ])
  assert.deepEqual(filled, [{ date: '2026-10-22', cents: 12_500, orders: 2 }])
})

// ---------------------------------------------------------------------------
// Day-of-week averages
// ---------------------------------------------------------------------------

test('weekday averages are listed Monday first', () => {
  assert.deepEqual(
    weekdayAverages(fillDailyHistory(STEADY_SHOP)).map((a) => a.name),
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  )
})

test('six level weeks average to the daily takings on every weekday', () => {
  for (const average of weekdayAverages(fillDailyHistory(STEADY_SHOP))) {
    assert.equal(average.averageCents, 40_000)
    assert.equal(average.daysCounted, 6)
    assert.equal(average.averageDisplay, 'R 400.00')
  }
})

test('one good Saturday is divided by every Saturday in the history, not treated as the norm', () => {
  const saturday = weekdayAverages(fillDailyHistory(ONE_GOOD_SATURDAY)).find((a) => a.name === 'Saturday')
  assert.ok(saturday)
  assert.equal(saturday.daysCounted, 3)
  assert.equal(saturday.averageCents, 33_333)
  assert.equal(saturday.averageDisplay, 'R 333.33')
})

test('a quiet day is flagged slow against this business own average day', () => {
  const averages = weekdayAverages(fillDailyHistory(WEEKEND_KITCHEN))
  const mean = averages.reduce((sum, a) => sum + a.averageCents, 0) / averages.length
  const monday = averages.find((a) => a.name === 'Monday')!
  const tuesday = averages.find((a) => a.name === 'Tuesday')!
  const saturday = averages.find((a) => a.name === 'Saturday')!

  assert.ok(monday.averageCents < mean * SLOW_DAY_SHARE)
  assert.equal(monday.slow, true)
  assert.equal(averages.find((a) => a.name === 'Sunday')!.slow, true)
  assert.equal(tuesday.slow, false)
  assert.equal(saturday.slow, false)
})

test('every weekday being equal means no day is slow', () => {
  assert.deepEqual(at(STEADY_SHOP).slowWeekdays, [])
})

test('a weekday with no history yet is not called slow — only a day that traded and took little', () => {
  // Five days to Thursday: the Sunday in that window took nothing, while
  // Friday and Saturday have not come round yet.
  const partWeek = buildDailyHistory({
    endDate: '2026-10-22',
    days: 5,
    weekdayCents: { 1: 30_000, 2: 30_000, 3: 30_000, 4: 30_000 },
  })
  const averages = weekdayAverages(fillDailyHistory(partWeek))
  assert.deepEqual(
    averages.filter((a) => a.daysCounted === 0).map((a) => a.name),
    ['Friday', 'Saturday'],
  )
  // A weekday that never traded has no average to judge, so it is left alone.
  for (const average of averages) {
    if (average.daysCounted === 0) assert.equal(average.slow, false, average.name)
  }
  // The Sunday they were open and took nothing is a genuine slow day.
  assert.deepEqual(averages.filter((a) => a.slow).map((a) => a.name), ['Sunday'])
})

// ---------------------------------------------------------------------------
// The trend
// ---------------------------------------------------------------------------

test('weekly totals are whole weeks counted back from the last day, dropping a part week', () => {
  const totals = weeklyTotals(fillDailyHistory(STEADY_SHOP).slice(2))
  assert.equal(totals.length, 5)
  for (const total of totals) assert.equal(total, 280_000)
})

test('a level history has no trend rather than a small invented one', () => {
  assert.equal(weeklyTrendCents([280_000, 280_000, 280_000]), 0)
  const forecast = at(STEADY_SHOP)
  assert.equal(forecast.trend.perWeekCents, 0)
  assert.equal(forecast.trend.direction, 'flat')
})

test('one week of history is not enough for a trend', () => {
  assert.equal(weeklyTrendCents([280_000]), 0)
  assert.equal(weeklyTrendCents([]), 0)
})

test('the slope through rising weekly totals is the step between them', () => {
  assert.equal(weeklyTrendCents([100_000, 110_000, 120_000]), 10_000)
  assert.equal(weeklyTrendCents([120_000, 110_000, 100_000]), -10_000)
})

// ---------------------------------------------------------------------------
// The forecast itself
// ---------------------------------------------------------------------------

test('the forecast is 4 weeks of 7 days, starting the day after today', () => {
  const forecast = at(STEADY_SHOP)
  assert.equal(forecast.from, '2026-10-23')
  assert.equal(forecast.weeks.length, 4)
  assert.equal(forecast.days.length, 28)
  assert.equal(forecast.days[0]?.date, '2026-10-23')
  assert.equal(forecast.days[0]?.name, 'Friday')
  assert.equal(forecast.days[27]?.date, '2026-11-19')
  assert.deepEqual(
    forecast.weeks.map((w) => [w.weekStart, w.weekEnd]),
    [
      ['2026-10-23', '2026-10-29'],
      ['2026-10-30', '2026-11-05'],
      ['2026-11-06', '2026-11-12'],
      ['2026-11-13', '2026-11-19'],
    ],
  )
})

test('a level shop is forecast at exactly what it has been taking', () => {
  const forecast = at(STEADY_SHOP)
  for (const day of forecast.days) assert.equal(day.cents, 40_000)
  for (const week of forecast.weeks) {
    assert.equal(week.cents, 280_000)
    assert.equal(week.display, 'R 2 800.00')
  }
  assert.equal(forecast.totalCents, 1_120_000)
  assert.equal(forecast.totalDisplay, 'R 11 200.00')
  assert.equal(forecast.confidence, 'good')
})

test('each forecast day carries its weekday average, so the weekend peak survives', () => {
  const forecast = at(WEEKEND_KITCHEN)
  const firstWeek = forecast.weeks[0]!
  const byName = new Map(firstWeek.days.map((d) => [d.name, d]))
  assert.equal(byName.get('Saturday')!.cents, 72_000)
  assert.equal(byName.get('Saturday')!.display, 'R 720.00')
  assert.equal(byName.get('Monday')!.cents, 21_000)
  assert.equal(byName.get('Monday')!.slow, true)
  assert.equal(byName.get('Saturday')!.slow, false)
  assert.deepEqual(forecast.slowWeekdays, ['Monday', 'Sunday'])
  // The busiest forecast day is a Saturday, in every one of the four weeks.
  for (const week of forecast.weeks) {
    const busiest = [...week.days].sort((a, b) => b.cents - a.cents)[0]!
    assert.equal(busiest.name, 'Saturday')
  }
})

test('a growing shop is forecast higher week by week', () => {
  const forecast = at(GROWING_SHOP)
  assert.equal(forecast.trend.direction, 'up')
  assert.ok(forecast.trend.perWeekCents > 0)
  assert.equal(forecast.trend.capped, false)
  const totals = forecast.weeks.map((w) => w.cents)
  for (let i = 1; i < totals.length; i++) assert.ok(totals[i]! > totals[i - 1]!, `week ${i + 1} should beat week ${i}`)
})

test('a fading shop is forecast lower week by week', () => {
  const forecast = at(FADING_SHOP)
  assert.equal(forecast.trend.direction, 'down')
  assert.ok(forecast.trend.perWeekCents < 0)
  const totals = forecast.weeks.map((w) => w.cents)
  for (let i = 1; i < totals.length; i++) assert.ok(totals[i]! < totals[i - 1]!, `week ${i + 1} should be under week ${i}`)
})

test('a collapse is not carried four weeks to zero — the trend is capped and said so', () => {
  const forecast = at(COLLAPSING_SHOP)
  assert.equal(forecast.trend.capped, true)
  assert.equal(forecast.trend.weekFactors.at(-1), 1 - TREND_CAP)
  assert.ok(forecast.totalCents > 0)
  assert.ok(forecast.method.some((line) => line.includes('held to 50% up or down')))
})

test('no forecast day is ever negative', () => {
  for (const history of [COLLAPSING_SHOP, FADING_SHOP, ONE_GOOD_SATURDAY, NEW_SHOP]) {
    for (const day of at(history).days) assert.ok(day.cents >= 0, `${day.date} was ${day.cents}`)
  }
})

test('a shop open five days gets a thin forecast with no trend applied', () => {
  const forecast = at(NEW_SHOP)
  assert.equal(forecast.confidence, 'thin')
  assert.equal(forecast.history.completeWeeks, 0)
  assert.equal(forecast.trend.perWeekCents, 0)
  assert.ok(forecast.method.some((line) => line.includes('less than two full weeks')))
  // The three weekdays it has traded are forecast; the two it hasn't stay at zero.
  const week = forecast.weeks[0]!
  assert.equal(week.days.filter((d) => d.cents === 12_000).length, 5)
  assert.equal(week.days.filter((d) => d.cents === 0).length, 2)
})

test('a business with no orders is told there is nothing to forecast, not shown zeroes as a prediction', () => {
  const forecast = at(NO_SALES)
  assert.equal(forecast.confidence, 'none')
  assert.equal(forecast.totalCents, 0)
  assert.equal(forecast.totalDisplay, 'R 0.00')
  assert.equal(forecast.history.daysCovered, 0)
  assert.equal(forecast.history.firstDate, null)
  assert.deepEqual(forecast.method, [
    'There are no paid orders to work from yet, so there is nothing to forecast. Take a few orders and this page fills itself in.',
  ])
})

// ---------------------------------------------------------------------------
// What the page shows
// ---------------------------------------------------------------------------

test('every money figure is formatted R 1 234.56', () => {
  const forecast = at(WEEKEND_KITCHEN)
  const money = [
    forecast.totalDisplay,
    forecast.history.totalDisplay,
    ...forecast.weeks.map((w) => w.display),
    ...forecast.days.map((d) => d.display),
    ...forecast.weekdayAverages.map((a) => a.averageDisplay),
  ]
  for (const value of money) assert.match(value, /^R (\d{1,3}( \d{3})*)\.\d{2}$/, value)
})

test('the method explains the sums behind the numbers on the page', () => {
  const forecast = at(GROWING_SHOP)
  const method = forecast.method.join(' ')
  assert.match(method, /divided by how many of those days/)
  assert.match(method, /a week/)
  assert.match(method, /weeks ahead/)
  assert.match(method, /Paid orders only/)
})

test('the past weeks behind the trend are returned for the chart, oldest first', () => {
  const forecast = at(WEEKEND_KITCHEN)
  assert.equal(forecast.historyWeeks.length, 6)
  assert.deepEqual(forecast.historyWeeks[0], {
    weekStart: '2026-09-11',
    weekEnd: '2026-09-17',
    cents: 249_000,
    display: 'R 2 490.00',
  })
  assert.equal(forecast.historyWeeks.at(-1)?.weekEnd, '2026-10-22')
  // The blocks the trend was measured on, and nothing else.
  assert.deepEqual(forecast.historyWeeks.map((w) => w.cents), weeklyTotals(fillDailyHistory(WEEKEND_KITCHEN)))
})

test('a shop with no full week yet has no past weeks to chart', () => {
  assert.deepEqual(at(NEW_SHOP).historyWeeks, [])
})

test('the history summary is the window actually used', () => {
  const forecast = at(WEEKEND_KITCHEN)
  assert.deepEqual(forecast.history, {
    firstDate: '2026-09-11',
    lastDate: '2026-10-22',
    daysCovered: 42,
    completeWeeks: 6,
    tradingDays: 42,
    totalCents: 1_494_000,
    totalDisplay: 'R 14 940.00',
  })
})
