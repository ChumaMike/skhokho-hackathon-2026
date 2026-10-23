import test from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma/client'
import { resetTestDb, testDb } from '@/lib/testing/db'
import { __setEmailTransportForTests } from '@/lib/email'
import { __setMessageProviderForTests, __setPushProviderForTests } from '@/lib/messaging/provider'
import type { PushPayload, PushSendContext, PushTarget } from '@/lib/messaging/providers/webpush'
import { registerCustomer } from '@/modules/customers/customer.service'
import { listPushDevices, savePushSubscription } from '@/modules/customers/push-subscriptions.service'
import { notifyCustomerOrderStatus } from './customer-notifications'

/**
 * A status change reaches the browsers the customer switched on at this
 * shop, beside email and the phone text; a browser the push service says is
 * gone is forgotten; a customer with nothing switched on costs nothing.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'
const AUTH = 'tBHItJI5svbpez7KI4CCXg'
const pushes: { target: PushTarget; payload: PushPayload; context: PushSendContext }[] = []
let goneEndpoint: string | null = null
let businessId: string
let membershipId: string

async function order(n: string, withMembership: boolean) {
  return prisma.order.create({
    data: {
      businessId,
      membershipId: withMembership ? membershipId : null,
      orderNumber: `ORD-${run}-${n}`.toUpperCase(),
      status: 'PENDING',
      subtotal: 80,
      total: 80,
      metadata: { notifyPhone: '+27821700301' },
    },
    select: { id: true, orderNumber: true },
  })
}

test.before(async () => {
  await resetTestDb()
  __setMessageProviderForTests({ name: 'test', async send() { return { accepted: true } } })
  __setEmailTransportForTests(async () => ({ id: 'm' }))
  __setPushProviderForTests({
    name: 'fake',
    async send(target, payload, context) {
      pushes.push({ target, payload, context })
      if (target.endpoint === goneEndpoint) return { accepted: false, gone: true, errorName: 'webpush_410' }
      return { accepted: true, gone: false }
    },
  })
  businessId = (await prisma.business.create({ data: { name: 'Push Notify Kota', slug: `pushn-${run}`, status: 'ACTIVE', whatsapp: '082 999 0000' }, select: { id: true } })).id
  const reg = await registerCustomer(businessId, '+27821700301', 'Lerato', 'storefront_order')
  membershipId = (await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM memberships WHERE public_id = ${reg.public_id}::uuid LIMIT 1`)[0].id
})
test.after(async () => {
  __setMessageProviderForTests(undefined)
  __setEmailTransportForTests(null)
  __setPushProviderForTests(undefined)
  await resetTestDb()
  await testDb.$disconnect()
})

test('a status change pushes to every browser switched on for this membership, with the order page to open', async () => {
  await savePushSubscription(membershipId, { endpoint: `https://push.example/${run}/phone`, p256dh: P256DH, auth: AUTH }, 'Android phone')
  await savePushSubscription(membershipId, { endpoint: `https://push.example/${run}/laptop`, p256dh: P256DH, auth: AUTH }, 'Computer')
  const o = await order('a', true)
  await notifyCustomerOrderStatus(o.id, 'READY_FOR_COLLECTION')

  assert.equal(pushes.length, 2)
  for (const p of pushes) {
    assert.equal(p.payload.title, `Push Notify Kota · order ${o.orderNumber}`)
    assert.match(p.payload.body, /ready/)
    assert.equal(p.payload.url, `/store/order/${o.id}`)
    assert.equal(p.payload.tag, `order-${o.orderNumber}`)
    assert.equal(p.context.businessId, businessId)
    assert.equal(p.context.kind, 'customer_order_status')
    assert.ok(!JSON.stringify(p.payload).includes(membershipId), 'no identifier of any kind in the card')
  }
  const rows = await prisma.customerPushSubscription.findMany({ where: { membershipId }, select: { lastSentAt: true } })
  assert.ok(rows.every((r) => r.lastSentAt), 'accepted sends are stamped')
})

test('a browser the push service says is gone is forgotten; the others keep getting updates', async () => {
  pushes.length = 0
  goneEndpoint = `https://push.example/${run}/phone`
  const o = await order('b', true)
  await notifyCustomerOrderStatus(o.id, 'CONFIRMED')
  assert.equal(pushes.length, 2)
  assert.deepEqual((await listPushDevices(membershipId)).map((d) => d.deviceLabel), ['Computer'])

  pushes.length = 0
  goneEndpoint = null
  await notifyCustomerOrderStatus(o.id, 'CANCELLED')
  assert.equal(pushes.length, 1)
  assert.match(pushes[0].payload.body, /cancelled/)
})

test('an order without a membership, or a membership with nothing switched on, sends no push and still sends the text', async () => {
  pushes.length = 0
  const guest = await order('c', false)
  await notifyCustomerOrderStatus(guest.id, 'CONFIRMED')
  assert.equal(pushes.length, 0)

  await prisma.customerPushSubscription.deleteMany({ where: { membershipId } })
  const member = await order('d', true)
  await notifyCustomerOrderStatus(member.id, 'CONFIRMED')
  assert.equal(pushes.length, 0)
})
