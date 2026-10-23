import test from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma/client'
import { resetTestDb, testDb } from '@/lib/testing/db'
import { registerCustomer } from './customer.service'
import {
  forgetDeadEndpoint,
  listPushDevices,
  markPushSent,
  membershipIdForClaim,
  pushSubscriptionsForMembership,
  removeAllPushSubscriptions,
  removePushSubscription,
  savePushSubscription,
} from './push-subscriptions.service'

/**
 * Web Push subscriptions against a real database: a browser is tied to the
 * customer's membership at ONE shop, by session or by the order the browser
 * just placed, and nothing leaks across shops or to a page.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const session = { type: 'customer' as const, channel: 'phone' as const, identifier: '+27821700101' }
const P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'
const AUTH = 'tBHItJI5svbpez7KI4CCXg'
const sub = (n: string) => ({ endpoint: `https://push.example/${run}/${n}`, p256dh: P256DH, auth: AUTH })

let shopA: string
let shopB: string

async function membershipAt(businessId: string): Promise<string> {
  const reg = await registerCustomer(businessId, session.identifier, 'Thandi', 'storefront_order')
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM memberships WHERE public_id = ${reg.public_id}::uuid LIMIT 1`
  return rows[0].id
}

test.before(async () => {
  await resetTestDb()
  shopA = (await prisma.business.create({ data: { name: 'Push Kota', slug: `push-a-${run}`, status: 'ACTIVE' }, select: { id: true } })).id
  shopB = (await prisma.business.create({ data: { name: 'Push Braids', slug: `push-b-${run}`, status: 'ACTIVE' }, select: { id: true } })).id
})
test.after(async () => {
  await resetTestDb()
  await testDb.$disconnect()
})

test('a claim resolves to a membership at this shop only — by session, or by the order the browser placed', async () => {
  assert.equal(await membershipIdForClaim(shopA, { session }), null, 'not a customer here yet')
  const mA = await membershipAt(shopA)
  assert.equal(await membershipIdForClaim(shopA, { session }), mA)
  assert.equal(await membershipIdForClaim(shopB, { session }), null, 'the same phone is nobody at shop B')

  const order = await prisma.order.create({
    data: { businessId: shopA, membershipId: mA, orderNumber: `ORD-${run}-1`.toUpperCase(), status: 'PENDING', subtotal: 50, total: 50 },
    select: { id: true },
  })
  assert.equal(await membershipIdForClaim(shopA, { orderId: order.id }), mA)
  assert.equal(await membershipIdForClaim(shopB, { orderId: order.id }), null, "shop A's order id counts for nothing at shop B")
  assert.equal(await membershipIdForClaim(shopA, { orderId: '00000000-0000-0000-0000-000000000000' }), null)
})

test('a browser is stored once per membership, listed without its keys, and removed by the customer or when the push service says it is gone', async () => {
  const mA = await membershipAt(shopA)
  const first = await savePushSubscription(mA, sub('phone'), 'Android phone')
  const again = await savePushSubscription(mA, { ...sub('phone'), auth: 'AAAAAAAAAAAAAAAAAAAAAA' }, 'Android phone')
  assert.equal(again.id, first.id, 'same browser, same row — keys refreshed')
  await savePushSubscription(mA, sub('laptop'), 'Computer')

  const devices = await listPushDevices(mA)
  assert.deepEqual(devices.map((d) => d.deviceLabel), ['Android phone', 'Computer'])
  assert.ok(!('endpoint' in devices[0]) && !('auth' in devices[0]), 'a page never sees endpoints or keys')

  const deliverable = await pushSubscriptionsForMembership(mA)
  assert.equal(deliverable.length, 2)
  assert.equal(deliverable.find((d) => d.id === first.id)?.auth, 'AAAAAAAAAAAAAAAAAAAAAA')
  await markPushSent([first.id])
  const sent = await prisma.customerPushSubscription.findUniqueOrThrow({ where: { id: first.id }, select: { lastSentAt: true } })
  assert.ok(sent.lastSentAt)

  // The same browser at another shop is its own row, under that membership.
  const mB = await membershipAt(shopB)
  await savePushSubscription(mB, sub('phone'), 'Android phone')
  assert.equal((await listPushDevices(mB)).length, 1)
  assert.equal((await listPushDevices(mA)).length, 2, 'shop A unchanged')

  // Switching off at shop A leaves shop B's row alone.
  assert.equal(await removePushSubscription(mA, sub('phone').endpoint), 1)
  assert.equal(await removePushSubscription(mA, sub('phone').endpoint), 0, 'already off')
  assert.equal((await listPushDevices(mB)).length, 1)

  // The push service reporting the browser gone forgets it everywhere.
  await savePushSubscription(mA, sub('phone'), 'Android phone')
  assert.equal(await forgetDeadEndpoint(sub('phone').endpoint), 2)
  assert.deepEqual((await listPushDevices(mA)).map((d) => d.deviceLabel), ['Computer'])
  assert.equal((await listPushDevices(mB)).length, 0)

  assert.equal(await removeAllPushSubscriptions(mA), 1)
  assert.equal((await pushSubscriptionsForMembership(mA)).length, 0)
})
