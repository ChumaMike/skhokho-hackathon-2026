import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { resetTestDb, testDb } from '@/lib/testing/db'
import { clearHostnameCache } from '@/lib/tenant/context'
import { registerCustomer } from '@/modules/customers/customer.service'
import { listPushDevices, savePushSubscription } from '@/modules/customers/push-subscriptions.service'
import { POST } from './route'

/**
 * Switching order updates off: this browser only, or everything at this
 * shop; only for the membership the claim resolves to; and it works even
 * with Web Push unconfigured, because stopping must always be possible.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const HOST = 'skhokho.sgdataint.co.za'
const P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'
const AUTH = 'tBHItJI5svbpez7KI4CCXg'
const endpoint = (n: string) => `https://push.example/${run}/${n}`

let shopA: string
let shopB: string
let membershipA: string
let membershipB: string
let orderA: string

function post(body: unknown) {
  return new NextRequest(`https://${HOST}/api/account/push/unsubscribe`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { host: HOST, 'content-type': 'application/json', 'x-forwarded-for': `10.3.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
  })
}

async function membershipAt(businessId: string, phone: string) {
  const reg = await registerCustomer(businessId, phone, 'Naledi', 'storefront_order')
  return (await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM memberships WHERE public_id = ${reg.public_id}::uuid LIMIT 1`)[0].id
}

test.before(async () => {
  await resetTestDb()
  for (const k of ['WEBPUSH_VAPID_PUBLIC_KEY', 'WEBPUSH_VAPID_PRIVATE_KEY', 'WEBPUSH_SUBJECT']) delete process.env[k]
  shopA = (await prisma.business.create({ data: { name: 'Unsub Kota', slug: `unsub-a-${run}`, status: 'ACTIVE' }, select: { id: true } })).id
  shopB = (await prisma.business.create({ data: { name: 'Unsub Braids', slug: `unsub-b-${run}`, status: 'ACTIVE' }, select: { id: true } })).id
  membershipA = await membershipAt(shopA, '+27821700401')
  membershipB = await membershipAt(shopB, '+27821700401')
  orderA = (
    await prisma.order.create({
      data: { businessId: shopA, membershipId: membershipA, orderNumber: `ORD-${run}-U`.toUpperCase(), status: 'PENDING', subtotal: 60, total: 60 },
      select: { id: true },
    })
  ).id
  await savePushSubscription(membershipA, { endpoint: endpoint('phone'), p256dh: P256DH, auth: AUTH }, 'Android phone')
  await savePushSubscription(membershipA, { endpoint: endpoint('laptop'), p256dh: P256DH, auth: AUTH }, 'Computer')
  await savePushSubscription(membershipB, { endpoint: endpoint('phone'), p256dh: P256DH, auth: AUTH }, 'Android phone')
})
test.beforeEach(clearHostnameCache)
test.after(async () => {
  await resetTestDb()
  await testDb.$disconnect()
})

test('this browser only, then everything at this shop — the same browser at another shop is untouched', async () => {
  const one = await POST(post({ businessId: shopA, orderId: orderA, endpoint: endpoint('phone') }))
  assert.deepEqual(await one.json(), { ok: true, removed: 1 })
  assert.deepEqual((await listPushDevices(membershipA)).map((d) => d.deviceLabel), ['Computer'])
  assert.equal((await listPushDevices(membershipB)).length, 1, "shop B's row for the same browser stays")

  const again = await POST(post({ businessId: shopA, orderId: orderA, endpoint: endpoint('phone') }))
  assert.deepEqual(await again.json(), { ok: true, removed: 0 }, 'already off is still a success')

  const all = await POST(post({ businessId: shopA, orderId: orderA }))
  assert.deepEqual(await all.json(), { ok: true, removed: 1 })
  assert.equal((await listPushDevices(membershipA)).length, 0)
  assert.equal((await listPushDevices(membershipB)).length, 1)
})

test("a claim that resolves to nobody removes nothing, and shop A's order cannot touch shop B", async () => {
  const wrongShop = await POST(post({ businessId: shopB, orderId: orderA }))
  assert.deepEqual(await wrongShop.json(), { ok: true, removed: 0 })
  assert.equal((await listPushDevices(membershipB)).length, 1)

  const anonymous = await POST(post({ businessId: shopA, endpoint: endpoint('phone') }))
  assert.equal(anonymous.status, 401)
  const malformed = await POST(post({ businessId: shopA, orderId: orderA, endpoint: 'not a url' }))
  assert.equal(malformed.status, 400)
})
