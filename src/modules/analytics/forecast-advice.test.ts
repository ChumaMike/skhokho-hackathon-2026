import test from 'node:test'
import assert from 'node:assert/strict'
import { forecastSales } from './forecast'
import { explainForecast, explainForecastAsAnswer } from './forecast-advice'
import {
  COLLAPSING_SHOP,
  FADING_SHOP,
  FIXTURE_TODAY,
  GROWING_SHOP,
  NEW_SHOP,
  NO_SALES,
  STEADY_SHOP,
  WEEKEND_KITCHEN,
} from './forecast.fixtures'
import type { DailySales } from './forecast'

const explain = (history: readonly DailySales[]) => explainForecast(forecastSales(history, { today: FIXTURE_TODAY }))

test('the explanation leads with next week and the four-week total', () => {
  const [first] = explain(STEADY_SHOP)
  assert.ok(first)
  assert.match(first, /Next week looks like about R 2 800\.00/)
  assert.match(first, /four weeks to 19 Nov come to about R 11 200\.00/)
})

test('a growing shop is told it is growing, with the weekly step', () => {
  const lines = explain(GROWING_SHOP).join(' ')
  assert.match(lines, /climbing by about R \d/)
  assert.match(lines, /forecast climbs with them/)
})

test('a fading shop is told plainly that it is slipping', () => {
  const lines = explain(FADING_SHOP).join(' ')
  assert.match(lines, /slipping by about R \d/)
  assert.doesNotMatch(lines, /climbing/)
})

test('a steady shop is not given an invented trend', () => {
  const lines = explain(STEADY_SHOP).join(' ')
  assert.match(lines, /steady, so the forecast holds level/)
})

test('a capped forecast says so rather than quietly flattening the curve', () => {
  const lines = explain(COLLAPSING_SHOP).join(' ')
  assert.match(lines, /held the forecast to 50% up or down/)
})

test('the big day and the quiet days are named, with the money', () => {
  const lines = explain(WEEKEND_KITCHEN).join(' ')
  assert.match(lines, /Saturday is your big day, averaging R 720\.00/)
  assert.match(lines, /Monday and Sunday are quiet/)
  assert.match(lines, /under 60% of your average day/)
})

test('one quiet day reads as one day, not a list', () => {
  // Thursday to Saturday busy, Sunday closed, Monday to Wednesday ordinary.
  const history: DailySales[] = []
  for (let week = 0; week < 6; week++) {
    const pattern: Record<number, number> = { 1: 40_000, 2: 40_000, 3: 40_000, 4: 40_000, 5: 40_000, 6: 40_000, 0: 0 }
    for (let day = 0; day < 7; day++) {
      const date = new Date(Date.UTC(2026, 8, 11) + (week * 7 + day) * 86_400_000)
      const weekday = date.getUTCDay()
      history.push({ date: date.toISOString().slice(0, 10), cents: pattern[weekday]!, orders: pattern[weekday] ? 4 : 0 })
    }
  }
  const lines = explain(history).join(' ')
  assert.match(lines, /Sunday is quiet/)
  assert.doesNotMatch(lines, / and Sunday are quiet/)
})

test('a short history is called a first sketch, not a plan', () => {
  const lines = explain(NEW_SHOP).join(' ')
  assert.match(lines, /built on 5 days of trading/)
  assert.match(lines, /first sketch/)
})

test('a few weeks of history is honest about what it is worth', () => {
  const threeWeeks = STEADY_SHOP.slice(-21)
  const lines = explain(threeWeeks).join(' ')
  assert.match(lines, /built on 3 full weeks of trading/)
  assert.match(lines, /not enough to bank on yet/)
})

test('a business with no orders is told there is nothing to forecast', () => {
  assert.deepEqual(explain(NO_SALES), [
    'There are no paid orders yet, so there is nothing to forecast. Take a few orders and this page starts filling itself in.',
  ])
})

test('the buddy answer is the same sentences in one paragraph', () => {
  const forecast = forecastSales(WEEKEND_KITCHEN, { today: FIXTURE_TODAY })
  assert.equal(explainForecastAsAnswer(forecast), explainForecast(forecast).join(' '))
})

test('nothing in the explanation names a customer or a phone number', () => {
  for (const history of [STEADY_SHOP, WEEKEND_KITCHEN, GROWING_SHOP, NEW_SHOP]) {
    const lines = explain(history).join(' ')
    assert.doesNotMatch(lines, /\+27|\b0\d{9}\b/)
  }
})
