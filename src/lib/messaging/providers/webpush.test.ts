import test from 'node:test'
import assert from 'node:assert/strict'
import { WebPushError } from 'web-push'
import { createWebPushProvider, encodePushPayload, type PushTransport } from './webpush'
import { customerOrderStatusPush } from '../templates'

/**
 * The Web Push provider against a fake push service: what it hands the
 * library, and how each answer comes back — accepted, gone, or failed —
 * without ever throwing.
 */

const config = {
  publicKey: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  privateKey: 'tUxYj4zJqM1dK7eVbT1Rn2XGwqv3sLJfQm8bC6hZ0aE',
  subject: 'mailto:help@skhokho.test',
}
const target = { id: 's1', endpoint: 'https://push.example/abc', p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) }
const payload = { title: 'Mzansi Kota · order ORD-1', body: 'Your order is ready — come and fetch it at Mzansi Kota.', url: '/store/order/o1', tag: 'order-ORD-1' }
const context = { businessId: 'b1', kind: 'customer_order_status' as const }

test('a successful send hands the library the subscription, the encoded payload and this deployment\'s VAPID details', async () => {
  const calls: Parameters<PushTransport>[] = []
  const transport: PushTransport = async (...args) => {
    calls.push(args)
    return { statusCode: 201, body: '', headers: {} }
  }
  const provider = createWebPushProvider(config, transport)
  assert.equal(provider.name, 'webpush')
  const r = await provider.send(target, payload, context)
  assert.deepEqual(r, { accepted: true, gone: false })
  assert.equal(calls.length, 1)
  const [sub, body, options] = calls[0]
  assert.deepEqual(sub, { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } })
  assert.deepEqual(JSON.parse(body), payload)
  assert.deepEqual(options.vapidDetails, { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey })
  assert.equal(options.TTL, 86400)
  assert.equal(options.urgency, 'high')
  assert.equal(options.topic, 'order-ORD-1')
  assert.ok(!body.includes('b1'), 'the business id is attribution only, never in the payload')
})

test('404 and 410 mean the browser is gone; other failures are reported, and nothing ever throws', async () => {
  const failing = (status: number) => createWebPushProvider(config, async () => { throw new WebPushError('push service said no', status, {}, '', target.endpoint) })
  assert.deepEqual(await failing(410).send(target, payload, context), { accepted: false, gone: true, errorName: 'webpush_410' })
  assert.deepEqual(await failing(404).send(target, payload, context), { accepted: false, gone: true, errorName: 'webpush_404' })
  assert.deepEqual(await failing(429).send(target, payload, context), { accepted: false, gone: false, errorName: 'webpush_429' })
  assert.deepEqual(await failing(500).send(target, payload, context), { accepted: false, gone: false, errorName: 'webpush_500' })

  const network = createWebPushProvider(config, async () => { throw new TypeError('fetch failed') })
  assert.deepEqual(await network.send(target, payload, context), { accepted: false, gone: false, errorName: 'TypeError' })

  const odd = createWebPushProvider(config, async () => ({ statusCode: 302, body: '', headers: {} }))
  assert.deepEqual(await odd.send(target, payload, context), { accepted: false, gone: false, errorName: 'webpush_302' })
})

test('the order-status card is small, names the shop and order, opens the order page, and carries nothing secret', () => {
  const card = customerOrderStatusPush({ status: 'OUT_FOR_DELIVERY', businessName: 'Mzansi Kota', orderNumber: 'ORD-7', orderPath: '/store/order/o7' })
  assert.equal(card.title, 'Mzansi Kota · order ORD-7')
  assert.match(card.body, /on its way/)
  assert.equal(card.url, '/store/order/o7')
  assert.equal(card.tag, 'order-ORD-7')
  assert.ok(encodePushPayload(card).length < 1000)
  for (const status of ['CONFIRMED', 'READY_FOR_COLLECTION', 'DRIVER_ASSIGNED', 'DELIVERED', 'CANCELLED'] as const) {
    const c = customerOrderStatusPush({ status, businessName: 'Mzansi Kota', orderNumber: 'ORD-7', orderPath: '/store/order/o7' })
    assert.ok(c.body.length > 10 && !/token|code=/i.test(c.body))
  }
})
