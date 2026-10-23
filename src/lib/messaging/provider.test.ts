import test from 'node:test'
import assert from 'node:assert/strict'
import {
  __setMessageProviderForTests,
  consoleMessageProvider,
  isPhoneMessagingConfigured,
  maskPhone,
  sendPhoneMessage,
  toE164Mobile,
  type MessageProvider,
  type OutboundMessage,
} from './provider'

/**
 * The phone-messaging seam. Nothing here talks to a carrier: the point is
 * that callers get an honest { sent, configured } whatever the provider
 * does, and that the dev console provider can never run in production.
 */

function capturing(): { provider: MessageProvider; sent: OutboundMessage[] } {
  const sent: OutboundMessage[] = []
  return {
    sent,
    provider: {
      name: 'test',
      async send(m) {
        sent.push(m)
        return { accepted: true, providerId: `t-${sent.length}` }
      },
    },
  }
}

test('phone numbers: any common SA format becomes E.164, anything else is refused and masked numbers keep three digits', () => {
  assert.equal(toE164Mobile('082 123 4567'), '+27821234567')
  assert.equal(toE164Mobile('+27 82 123 4567'), '+27821234567')
  assert.equal(toE164Mobile('27821234567'), '+27821234567')
  assert.equal(toE164Mobile('011 123 4567'), null, 'a landline is not a mobile')
  assert.equal(toE164Mobile('12345'), null)
  assert.equal(maskPhone('+27821234567'), '+27 ** *** *567')
})

test('a configured provider gets the message and the result is honest about acceptance', async (t) => {
  t.after(() => __setMessageProviderForTests(undefined))
  const { provider, sent } = capturing()
  __setMessageProviderForTests(provider)
  assert.equal(isPhoneMessagingConfigured(), true)
  assert.deepEqual(await sendPhoneMessage({ to: '+27821234567', text: 'Hi', kind: 'customer_order_status' }), { sent: true, configured: true })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, '+27821234567')

  __setMessageProviderForTests({ name: 'refusing', async send() { return { accepted: false, errorName: 'carrier_down' } } })
  assert.deepEqual(await sendPhoneMessage({ to: '+27821234567', text: 'Hi', kind: 'customer_order_status' }), { sent: false, configured: true })

  __setMessageProviderForTests({ name: 'throwing', async send() { throw new Error('boom') } })
  assert.deepEqual(await sendPhoneMessage({ to: '+27821234567', text: 'Hi', kind: 'customer_order_status' }), { sent: false, configured: true }, 'a provider exception never escapes')
})

test('an invalid number is never handed to a provider', async (t) => {
  t.after(() => __setMessageProviderForTests(undefined))
  const { provider, sent } = capturing()
  __setMessageProviderForTests(provider)
  assert.deepEqual(await sendPhoneMessage({ to: '0821234567', text: 'Hi', kind: 'customer_login_code' }), { sent: false, configured: true })
  assert.equal(sent.length, 0, 'callers must normalise first (toE164Mobile)')
})

test('unconfigured: nothing is sent and callers are told so, so they can fall back to email', async (t) => {
  t.after(() => __setMessageProviderForTests(undefined))
  __setMessageProviderForTests(null)
  assert.equal(isPhoneMessagingConfigured(), false)
  assert.deepEqual(await sendPhoneMessage({ to: '+27821234567', text: 'Hi', kind: 'customer_login_code' }), { sent: false, configured: false })
})

test('MESSAGE_PROVIDER=console is the dev provider, and is refused in production', async (t) => {
  // NODE_ENV is typed read-only by Next's ambient types; go through the env record.
  const env = process.env as Record<string, string | undefined>
  const saved = { MESSAGE_PROVIDER: env.MESSAGE_PROVIDER, VERCEL_ENV: env.VERCEL_ENV, NODE_ENV: env.NODE_ENV }
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete env[k]
      else env[k] = v
    }
    __setMessageProviderForTests(undefined)
    t.mock.restoreAll()
  })
  __setMessageProviderForTests(undefined)
  delete env.VERCEL_ENV
  env.NODE_ENV = 'development'
  env.MESSAGE_PROVIDER = 'console'
  const logged: string[] = []
  t.mock.method(console, 'log', (line: string) => logged.push(String(line)))
  assert.equal(isPhoneMessagingConfigured(), true)
  const r = await sendPhoneMessage({ to: '+27821234567', text: 'Your code is 123456', kind: 'customer_login_code' })
  assert.deepEqual(r, { sent: true, configured: true })
  assert.ok(logged.some((l) => l.includes('123456')), 'the dev provider prints the whole message so the code can be read')
  assert.ok(logged.every((l) => !l.includes('+27821234567')), 'but never the full number')

  process.env.VERCEL_ENV = 'production'
  assert.equal(isPhoneMessagingConfigured(), false, 'console output of sign-in codes is not a production channel')
  assert.equal(consoleMessageProvider.name, 'console')
})
