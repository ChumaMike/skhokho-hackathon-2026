import test from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma/client'
import { resetTestDb } from '@/lib/testing/db'
import { hashPassword } from '@/modules/auth/auth.service'
import { createBusiness } from '@/modules/tenant/tenant.service'
import { registerCustomer } from '@/modules/customers/customer.service'
import { getFundingReadiness } from './funding-readiness.service'

/**
 * The funding report against the real database: lifetime figures, the monthly
 * table, and above all the repeat-customer rate, which must be counted by
 * ORDERS PER MEMBERSHIP. Counting by `first_seen` would make a business that
 * registered its customer list in one afternoon look as though nobody had ever
 * come back — which is exactly the shape of the demo data.
 *
 * Customers are created through the identity RPC (`registerCustomer`), as the
 * hard rules require; only the orders are inserted directly, because these
 * tests need past dates the order service deliberately won't accept.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** Thursday, as in the pure fixtures. */
const TODAY = new Date('2026-10-22T09:00:00Z')

let shopId: string
let orderSeq = 0
/** membership ids, in the order the customers were registered. */
const members: string[] = []

async function membershipFor(businessId: string, phone: string): Promise<string> {
  const registration = await registerCustomer(businessId, phone, undefined, 'owner_dashboard')
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM memberships WHERE public_id = ${registration.public_id}::uuid LIMIT 1`
  return rows[0]!.id
}

async function addOrder(
  businessId: string,
  date: string,
  rands: number,
  opts: { membershipId?: string | null; paymentStatus?: 'PAID' | 'PENDING'; status?: 'COMPLETED' | 'CANCELLED' } = {},
) {
  orderSeq += 1
  await prisma.order.create({
    data: {
      businessId,
      membershipId: opts.membershipId ?? null,
      orderNumber: `FR-${run}-${orderSeq}`,
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
  const { business } = await createBusiness({
    name: 'Kota Tainment',
    category: 'FOOD_VENDOR' as never,
    owner: {
      firstName: 'Owner',
      lastName: 'Funding',
      email: `funding-${run}@example.test`,
      passwordHash: await hashPassword('SomePassword123'),
    },
  })
  shopId = business.id

  // Four customers, all registered today — the demo data's shape.
  for (let i = 0; i < 4; i++) members.push(await membershipFor(shopId, `082 160 100${i}`))

  // Customer 0: three paid orders across three months — a repeat customer.
  await addOrder(shopId, '2026-08-12', 100, { membershipId: members[0] })
  await addOrder(shopId, '2026-09-14', 150, { membershipId: members[0] })
  await addOrder(shopId, '2026-10-16', 200, { membershipId: members[0] })
  // Customer 1: two paid orders — also a repeat customer.
  await addOrder(shopId, '2026-10-12', 50, { membershipId: members[1] })
  await addOrder(shopId, '2026-10-19', 50, { membershipId: members[1] })
  // Customer 2: one paid order — ordered, but has not come back.
  await addOrder(shopId, '2026-10-20', 75, { membershipId: members[2] })
  // Customer 3: two orders that do not count — one unpaid, one cancelled.
  await addOrder(shopId, '2026-10-20', 500, { membershipId: members[3], paymentStatus: 'PENDING' })
  await addOrder(shopId, '2026-10-21', 500, { membershipId: members[3], status: 'CANCELLED' })
  // A walk-in sale with no customer attached at all.
  await addOrder(shopId, '2026-10-21', 25, { membershipId: null })
})

test('the lifetime figures count paid orders only', async () => {
  const report = (await getFundingReadiness(shopId, { today: TODAY }))!
  assert.ok(report)
  // 100 + 150 + 200 + 50 + 50 + 75 + 25 = 650, over 7 paid orders.
  assert.equal(report.paidOrders, 7)
  assert.equal(report.revenueTotalCents, 65_000)
  assert.equal(report.revenueTotalDisplay, 'R 650.00')
  assert.equal(report.averageOrderDisplay, 'R 92.86')
})

test('months trading runs from the first paid order', async () => {
  const report = (await getFundingReadiness(shopId, { today: TODAY }))!
  assert.equal(report.tradingSince, '2026-08-12')
  assert.equal(report.monthsTrading, 2)
})

test('the monthly table holds one row per month with paid orders, the current one flagged', async () => {
  const report = (await getFundingReadiness(shopId, { today: TODAY }))!
  assert.deepEqual(
    report.months.map((month) => [month.month, month.orders, month.cents, month.partial]),
    [
      ['2026-08', 1, 10_000, false],
      ['2026-09', 1, 15_000, false],
      ['2026-10', 5, 40_000, true],
    ],
  )
  assert.deepEqual(report.revenueTrend.monthOnMonth, {
    from: 'August 2026',
    to: 'September 2026',
    changeDisplay: 'R 50.00',
    direction: 'up',
  })
})

test('the repeat rate counts orders per membership, not when the customer was first seen', async () => {
  const report = (await getFundingReadiness(shopId, { today: TODAY }))!
  // Every customer was registered today, so a first_seen-based rate would be 0.
  assert.equal(report.repeatCustomers.withOrders, 3)
  assert.equal(report.repeatCustomers.repeat, 2)
  assert.equal(report.repeatCustomers.ratePercent, 67)
  // All four memberships are on the customer list, including the one whose
  // orders never counted.
  assert.equal(report.repeatCustomers.total, 4)
})

test('a walk-in order with no customer attached is revenue but not a customer', async () => {
  const report = (await getFundingReadiness(shopId, { today: TODAY }))!
  // The R 25.00 walk-in is in the revenue above; it adds nobody to the 3.
  assert.equal(report.repeatCustomers.withOrders, 3)
})

test('the consistency score reads the same weeks the forecast does', async () => {
  const report = (await getFundingReadiness(shopId, { today: TODAY }))!
  assert.ok(report.consistency.weeksCounted > 0)
  assert.equal(report.consistency.meanWeekDisplay.startsWith('R '), true)
  assert.ok(report.consistency.score >= 0 && report.consistency.score <= 100)
})

test('a business with no orders at all still produces a report that says so', async () => {
  const { business } = await createBusiness({
    name: 'Quiet Shop',
    category: 'FOOD_VENDOR' as never,
    owner: {
      firstName: 'Owner',
      lastName: 'Quiet',
      email: `funding-quiet-${run}@example.test`,
      passwordHash: await hashPassword('SomePassword123'),
    },
  })
  const report = (await getFundingReadiness(business.id, { today: TODAY }))!
  assert.equal(report.paidOrders, 0)
  assert.equal(report.revenueTotalDisplay, 'R 0.00')
  assert.deepEqual(report.months, [])
  assert.equal(report.repeatCustomers.withOrders, 0)
  assert.equal(report.consistency.band, 'too early')
  assert.match(report.notes.join(' '), /No customer has paid for an order yet/)
})

test('an unknown business is null, not an empty report', async () => {
  assert.equal(await getFundingReadiness('00000000-0000-0000-0000-000000000000', { today: TODAY }), null)
})
