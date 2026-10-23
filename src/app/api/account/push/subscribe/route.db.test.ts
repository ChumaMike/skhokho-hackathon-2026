import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { resetTestDb, testDb } from '@/lib/testing/db'
import { clearHostnameCache } from '@/lib/tenant/context'
import { registerCustomer } from '@/modules/customers/customer.service'
import { listPushDevices } from '@/modules/customers/push-subscriptions.service'
import { POST } from './route'

/**
 * The subscribe route from a browser that just placed an order (no session
 * cookie — the order id is the claim). Hidden when unconfigured, strict
 * about the subscription shape, and an order id only counts at its own shop.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const HOST = 'skhokho.sgdataint.co.za'
const P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'
const AUTH = 'tBHItJI5svbpez7KI4CCXg'
const VAPID_PUBLIC = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'
const VAPID_PRIVATE = 'tUxYj4zJqM1dK7eVbT1Rn2XGwqv3sLJfQm8bC6hZ0aE'

let shopA: string
let shopB: string
let membershipA: string
let orderA: string
const saved: Record<string, string | undefined> = {}

function post(body: unknown, ua = 'Mozilla/5.0 (Linux; Android 14) Chrome/124.0 Mobile Safari/537.36') {
  return new NextRequest(`https://${HOST}/api/account/push/subscribe`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { host: HOST, 'content-type': 'application/json', 'user-agent': ua, 'x-forwarded-for': `10.2.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
  })
}
const subscription = (n: string) => ({ endpoint: `https://push.example/${run}/${n}`, keys: { p256dh: P256DH, auth: AUTH } })

test.before(async () => {
  await resetTestDb()
  for (const k of ['WEBPUSH_VAPID_PUBLIC_KEY', 'WEBPUSH_VAPID_PRIVATE_KEY', 'WEBPUSH_SUBJECT']) saved[k] = process.env[k]
  process.env.WEBPUSH_VAPID_PUBLIC_KEY = VAPID_PUBLIC
  process.env.WEBPUSH_VAPID_PRIVATE_KEY = VAPID_PRIVATE
  process.env.WEBPUSH_SUBJECT = 'mailto:help@skhokho.test'
  shopA = (await prisma.business.create({ data: { name: 'Push Route Kota', slug: `pushr-a-${run}`, status: 'ACTIVE' }, select: { id: true } })).id
  shopB = (await prisma.business.create({ data: { name: 'Push Route Braids', slug: `pushr-b-${run}`, status: 'ACTIVE' }, select: { id: true } })).id
  const reg = await registerCustomer(shopA, '+27821700201', 'Sipho', 'storefront_order')
  membershipA = (await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM memberships WHERE public_id = ${reg.public_id}::uuid LIMIT 1`)[0].id
  orderA = (
    await prisma.order.create({
      data: { businessId: shopA, membershipId: membershipA, orderNumber: `ORD-${run}-R`.toUpperCase(), status: 'PENDING', subtotal: 60, total: 60 },
      select: { id: true },
    })
  ).id
})
test.beforeEach(clearHostnameCache)
test.after(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  await resetTestDb()
  await testDb.$disconnect()
})

test('the browser that just placed an order can switch updates on with the order id, at that shop only', async () => {
  const ok = await POST(post({ businessId: shopA, orderId: orderA, subscription: subscription('phone') }))
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { ok: true, deviceLabel: 'Android phone' })
  assert.deepEqual((await listPushDevices(membershipA)).map((d) => d.deviceLabel), ['Android phone'])

  // Twice is still one browser.
  await POST(post({ businessId: shopA, orderId: orderA, subscription: subscription('phone') }))
  assert.equal((await listPushDevices(membershipA)).length, 1)

  // Shop A's order id is nobody's at shop B.
  const wrongShop = await POST(post({ businessId: shopB, orderId: orderA, subscription: subscription('phone') }))
  assert.equal((await wrongShop.json()).code, 'NO_MEMBERSHIP')
  assert.equal(await prisma.customerPushSubscription.count(), 1)

  // No session and no order: nothing to tie the browser to.
  const anonymous = await POST(post({ businessId: shopA, subscription: subscription('phone') }))
  assert.equal(anonymous.status, 401)
})

test('a malformed subscription or request is refused before anything is stored', async () => {
  const bad = await POST(post({ businessId: shopA, orderId: orderA, subscription: { endpoint: 'http://push.example/x', keys: { p256dh: P256DH, auth: AUTH } } }))
  assert.equal(bad.status, 400)
  assert.equal((await bad.json()).code, 'INVALID_SUBSCRIPTION')
  const notUuid = await POST(post({ businessId: 'nope', orderId: orderA, subscription: subscription('x') }))
  assert.equal(notUuid.status, 400)
  const notJson = await POST(new NextRequest(`https://${HOST}/api/account/push/subscribe`, { method: 'POST', body: '{', headers: { host: HOST, 'content-type': 'application/json' } }))
  assert.equal(notJson.status, 400)
  assert.equal(await prisma.customerPushSubscription.count(), 1, 'only the good one from the first test')
})

test('without VAPID keys the route does not exist for the browser', async () => {
  const before = process.env.WEBPUSH_VAPID_PRIVATE_KEY
  delete process.env.WEBPUSH_VAPID_PRIVATE_KEY
  try {
    const hidden = await POST(post({ businessId: shopA, orderId: orderA, subscription: subscription('phone') }))
    assert.equal(hidden.status, 404)
  } finally {
    process.env.WEBPUSH_VAPID_PRIVATE_KEY = before
  }
})
