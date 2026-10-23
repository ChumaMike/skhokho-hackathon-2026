import test from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma/client'
import { resetTestDb } from '@/lib/testing/db'
import { hashPassword } from '@/modules/auth/auth.service'
import { createBusiness } from '@/modules/tenant/tenant.service'
import { getDailySales, getSalesForecast } from './forecast.service'
import { forecastSales } from './forecast'

/**
 * What the forecast counts as takings, against the real database: paid orders
 * only, cancelled and refunded left out, rands converted to exact cents, one
 * business never seeing another's orders, and the window honoured.
 *
 * Orders are inserted with `prisma.order.create` rather than through
 * `createOrder`, because these tests need a specific `created_at` in the past
 * and the service deliberately gives callers no way to backdate an order.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** Thursday, matching the pure fixtures, so a forecast starts on Friday 23rd. */
const TODAY = new Date('2026-10-22T09:00:00Z')

let shopId: string
let otherShopId: string
let orderSeq = 0

async function makeShop(label: string): Promise<string> {
  const { business } = await createBusiness({
    name: `Forecast Shop ${label}`,
    category: 'FOOD_VENDOR' as never,
    owner: {
      firstName: 'Owner',
      lastName: label,
      email: `forecast-${label}-${run}@example.test`,
      passwordHash: await hashPassword('SomePassword123'),
    },
  })
  return business.id
}

/** `rands` is what the shop was paid, the way `orders.total` stores it. */
async function addOrder(
  businessId: string,
  date: string,
  rands: number,
  opts: { paymentStatus?: 'PAID' | 'PENDING' | 'REFUNDED'; status?: 'COMPLETED' | 'CANCELLED' | 'REFUNDED' } = {},
) {
  orderSeq += 1
  await prisma.order.create({
    data: {
      businessId,
      orderNumber: `FC-${run}-${orderSeq}`,
      status: opts.status ?? 'COMPLETED',
      paymentStatus: opts.paymentStatus ?? 'PAID',
      subtotal: rands,
      total: rands,
      createdAt: new Date(`${date}T10:00:00Z`),
    },
  })
}

test.before(async () => {
  await resetTestDb()
  shopId = await makeShop('a')
  otherShopId = await makeShop('b')
})

test('paid orders on the same day are added up, in exact cents', async () => {
  await addOrder(shopId, '2026-10-20', 45.5)
  await addOrder(shopId, '2026-10-20', 120.05)
  const sales = await getDailySales(shopId, { today: TODAY })
  assert.deepEqual(sales, [{ date: '2026-10-20', cents: 16_555, orders: 2 }])
})

test('an unpaid order is not takings', async () => {
  await addOrder(shopId, '2026-10-21', 300, { paymentStatus: 'PENDING', status: 'COMPLETED' })
  const sales = await getDailySales(shopId, { today: TODAY })
  assert.equal(sales.find((day) => day.date === '2026-10-21'), undefined)
})

test('a paid order that was cancelled or refunded is left out', async () => {
  await addOrder(shopId, '2026-10-19', 500, { paymentStatus: 'PAID', status: 'CANCELLED' })
  await addOrder(shopId, '2026-10-19', 500, { paymentStatus: 'REFUNDED', status: 'REFUNDED' })
  await addOrder(shopId, '2026-10-19', 60, { paymentStatus: 'PAID', status: 'COMPLETED' })
  const day = (await getDailySales(shopId, { today: TODAY })).find((d) => d.date === '2026-10-19')
  assert.deepEqual(day, { date: '2026-10-19', cents: 6_000, orders: 1 })
})

test("today's orders are history for the averages, and tomorrow is where the forecast starts", async () => {
  await addOrder(shopId, '2026-10-22', 80)
  const sales = await getDailySales(shopId, { today: TODAY })
  assert.deepEqual(sales.at(-1), { date: '2026-10-22', cents: 8_000, orders: 1 })

  const forecast = await getSalesForecast(shopId, { today: TODAY })
  assert.equal(forecast.from, '2026-10-23')
  assert.equal(forecast.history.lastDate, '2026-10-22')
})

test('orders older than the window are not read', async () => {
  await addOrder(shopId, '2026-01-05', 9_999)
  const sales = await getDailySales(shopId, { today: TODAY, days: 84 })
  assert.equal(sales.find((day) => day.date === '2026-01-05'), undefined)
  assert.ok(sales.every((day) => day.date >= '2026-07-31'), 'the window starts 84 days back')
})

test("one business never sees another's orders", async () => {
  await addOrder(otherShopId, '2026-10-20', 7_777)
  const mine = await getDailySales(shopId, { today: TODAY })
  assert.equal(mine.find((day) => day.cents === 777_700), undefined)
  const theirs = await getDailySales(otherShopId, { today: TODAY })
  assert.deepEqual(theirs, [{ date: '2026-10-20', cents: 777_700, orders: 1 }])
})

test('the service returns exactly what the pure forecast makes of the same history', async () => {
  const history = await getDailySales(shopId, { today: TODAY })
  const expected = forecastSales(history, { today: TODAY })
  const actual = await getSalesForecast(shopId, { today: TODAY })
  assert.deepEqual(actual, expected)
})

test('days are grouped by calendar day in UTC, however the orders fall in them', async () => {
  const quiet = await makeShop('c')
  await prisma.order.create({
    data: {
      businessId: quiet,
      orderNumber: `FC-${run}-dawn`,
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      subtotal: 10,
      total: 10,
      createdAt: new Date('2026-10-20T00:05:00Z'),
    },
  })
  await prisma.order.create({
    data: {
      businessId: quiet,
      orderNumber: `FC-${run}-dusk`,
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      subtotal: 10,
      total: 10,
      createdAt: new Date('2026-10-20T23:55:00Z'),
    },
  })
  const sales = await getDailySales(quiet, { today: TODAY })
  assert.deepEqual(sales, [{ date: '2026-10-20', cents: 2_000, orders: 2 }])
})

test('a business with no orders at all gets an empty history, not an error', async () => {
  const empty = await makeShop('d')
  assert.deepEqual(await getDailySales(empty, { today: TODAY }), [])
  const forecast = await getSalesForecast(empty, { today: TODAY })
  assert.equal(forecast.confidence, 'none')
  assert.equal(forecast.totalCents, 0)
})
