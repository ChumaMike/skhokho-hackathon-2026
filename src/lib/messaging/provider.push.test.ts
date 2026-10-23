import test from 'node:test'
import assert from 'node:assert/strict'
import { __setPushProviderForTests, isPushMessagingConfigured, sendPushMessages } from './provider'
import type { PushProvider, PushTarget } from './providers/webpush'

/**
 * The push half of the messaging seam: selected by the VAPID variables (not
 * MESSAGE_PROVIDER), honest { configured, sent, gone } whatever the push
 * service does, and nothing thrown at a caller.
 */

const payload = { title: 't', body: 'b', url: '/store/order/x', tag: 'order-X' }
const context = { businessId: 'b1', kind: 'customer_order_status' as const }
const targets: PushTarget[] = [
  { id: 'ok', endpoint: 'https://push.example/ok', p256dh: 'p', auth: 'a' },
  { id: 'gone', endpoint: 'https://push.example/gone', p256dh: 'p', auth: 'a' },
  { id: 'fail', endpoint: 'https://push.example/fail', p256dh: 'p', auth: 'a' },
  { id: 'boom', endpoint: 'https://push.example/boom', p256dh: 'p', auth: 'a' },
]

const saved: Record<string, string | undefined> = {}
test.before(() => {
  for (const k of ['WEBPUSH_VAPID_PUBLIC_KEY', 'WEBPUSH_VAPID_PRIVATE_KEY', 'WEBPUSH_SUBJECT']) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})
test.after(() => {
  __setPushProviderForTests(undefined)
  for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v
})

test('without VAPID variables push is unconfigured, and sending to nobody records nothing', async () => {
  __setPushProviderForTests(undefined)
  assert.equal(await isPushMessagingConfigured(), false)
  assert.deepEqual(await sendPushMessages([], payload, context), { configured: false, sent: [], gone: [] })
  assert.deepEqual(await sendPushMessages(targets.slice(0, 1), payload, context), { configured: false, sent: [], gone: [] })
})

test('with the variables set the real provider is selected once and reused', async () => {
  process.env.WEBPUSH_VAPID_PUBLIC_KEY = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'
  process.env.WEBPUSH_VAPID_PRIVATE_KEY = 'tUxYj4zJqM1dK7eVbT1Rn2XGwqv3sLJfQm8bC6hZ0aE'
  process.env.WEBPUSH_SUBJECT = 'mailto:help@skhokho.test'
  try {
    assert.equal(await isPushMessagingConfigured(), true)
    assert.deepEqual(await sendPushMessages([], payload, context), { configured: true, sent: [], gone: [] })
  } finally {
    for (const k of ['WEBPUSH_VAPID_PUBLIC_KEY', 'WEBPUSH_VAPID_PRIVATE_KEY', 'WEBPUSH_SUBJECT']) delete process.env[k]
  }
  assert.equal(await isPushMessagingConfigured(), false, 'unset again: off again')
})

test('each browser is answered on its own: accepted, gone, failed or thrown — and the caller gets ids back', async () => {
  const seen: { id: string; businessId: string }[] = []
  const provider: PushProvider = {
    name: 'fake',
    async send(target, _payload, ctx) {
      seen.push({ id: target.id, businessId: ctx.businessId })
      if (target.id === 'ok') return { accepted: true, gone: false }
      if (target.id === 'gone') return { accepted: false, gone: true, errorName: 'webpush_410' }
      if (target.id === 'boom') throw new Error('socket hang up')
      return { accepted: false, gone: false, errorName: 'webpush_500' }
    },
  }
  __setPushProviderForTests(provider)
  const r = await sendPushMessages(targets, payload, context)
  assert.deepEqual(r, { configured: true, sent: ['ok'], gone: ['gone'] })
  assert.deepEqual(seen.map((s) => s.businessId), ['b1', 'b1', 'b1', 'b1'], 'the shop is passed through for attribution')

  __setPushProviderForTests(null)
  assert.equal(await isPushMessagingConfigured(), false, 'null = behave as unconfigured')
})
