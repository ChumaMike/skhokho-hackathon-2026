import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { __setMessageProviderForTests, isPhoneMessagingConfigured, sendPhoneMessage } from '../provider'
import { customerOrderStatusText } from '../templates'
import {
  DEFAULT_API_VERSION,
  buildTemplatePayload,
  buildTextPayload,
  classifyInboundText,
  createWhatsAppMetaProvider,
  fromWaId,
  parseWebhookPayload,
  readWhatsAppConfig,
  toWaId,
  verifyWebhookSignature,
  type FetchLike,
  type WhatsAppConfig,
} from './whatsapp-meta'

/**
 * The Meta provider without a network: a fake HTTP client captures the
 * exact request the Cloud API would receive and answers as Meta does. The
 * seam's own tests already prove the seam; here it is only the wire shape,
 * the error mapping, the opt-out gate, the webhook signature and the
 * payload parsing — field names as in Meta's reference.
 */

const config: WhatsAppConfig = { phoneNumberId: '106540352242922', accessToken: 'EAAG-test-token-abcdef', verifyToken: 'verify-me', appSecret: 'app-secret', apiVersion: 'v24.0' }

function fakeFetch(reply: { status: number; body: string } | Error) {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init })
    if (reply instanceof Error) throw reply
    return { ok: reply.status < 400, status: reply.status, text: async () => reply.body }
  }
  return { calls, fetchImpl }
}

const statusText = customerOrderStatusText({ status: 'CONFIRMED', businessName: 'Kota Kings', orderNumber: 'ORD-AB12-CD34', contact: '+27 82 999 0000' })

test('configuration needs all four variables; the API version defaults and can be overridden', () => {
  const full = { WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_VERIFY_TOKEN: 'v', WHATSAPP_APP_SECRET: 's' }
  assert.equal(readWhatsAppConfig(full)?.apiVersion, DEFAULT_API_VERSION)
  assert.equal(readWhatsAppConfig({ ...full, WHATSAPP_API_VERSION: 'v25.0' })?.apiVersion, 'v25.0')
  for (const key of Object.keys(full)) {
    assert.equal(readWhatsAppConfig({ ...full, [key]: ' ' }), null, `${key} missing → unconfigured`)
  }
})

test('wa_id ↔ E.164: Meta gets digits without the plus; only SA mobiles come back as numbers', () => {
  assert.equal(toWaId('+27821234567'), '27821234567')
  assert.equal(fromWaId('27821234567'), '+27821234567')
  assert.equal(fromWaId('16505551234'), null)
  assert.equal(fromWaId('27111234567'), null, 'a landline is not messaged')
})

test('an order status is sent as its approved template, to the right endpoint, with the bearer token', async () => {
  const { calls, fetchImpl } = fakeFetch({ status: 200, body: JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.ABC' }] }) })
  const provider = createWhatsAppMetaProvider(config, { fetch: fetchImpl, isOptedOut: async () => false })
  const result = await provider.send({ to: '+27821234567', text: statusText, kind: 'customer_order_status' })
  assert.deepEqual(result, { accepted: true, providerId: 'wamid.ABC' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://graph.facebook.com/v24.0/106540352242922/messages')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.authorization, 'Bearer EAAG-test-token-abcdef')
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
  assert.ok(calls[0].init.signal instanceof AbortSignal, 'a send has a timeout')
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '27821234567',
    type: 'template',
    template: {
      name: 'skhokho_order_confirmed',
      language: { code: 'en' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'ORD-AB12-CD34' }, { type: 'text', text: 'Kota Kings' }, { type: 'text', text: '+27 82 999 0000' }] }],
    },
  })
})

test('a sign-in code goes as the authentication template with the code as body variable and copy-button value', () => {
  const payload = buildTemplatePayload('+27821234567', { key: 'login_code', name: 'skhokho_login_code', language: 'en', category: 'authentication', variables: ['482913'], buttons: ['482913'] })
  assert.deepEqual((payload.template as { components: unknown[] }).components, [
    { type: 'body', parameters: [{ type: 'text', text: '482913' }] },
    { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '482913' }] },
  ])
  assert.deepEqual(buildTextPayload('+27821234567', 'hi'), { messaging_product: 'whatsapp', recipient_type: 'individual', to: '27821234567', type: 'text', text: { preview_url: false, body: 'hi' } })
})

test("Meta's refusals map to the numeric error code; unparseable and id-less answers are failures too; a text that matches no template is never sent", async () => {
  const outsideWindow = fakeFetch({ status: 400, body: JSON.stringify({ error: { message: '(#131047) Re-engagement message', type: 'OAuthException', code: 131047 } }) })
  let provider = createWhatsAppMetaProvider(config, { fetch: outsideWindow.fetchImpl, isOptedOut: async () => false })
  assert.deepEqual(await provider.send({ to: '+27821234567', text: statusText, kind: 'customer_order_status' }), { accepted: false, errorName: 'whatsapp_131047' })

  const html = fakeFetch({ status: 502, body: '<html>Bad gateway</html>' })
  provider = createWhatsAppMetaProvider(config, { fetch: html.fetchImpl, isOptedOut: async () => false })
  assert.deepEqual(await provider.send({ to: '+27821234567', text: statusText, kind: 'customer_order_status' }), { accepted: false, errorName: 'whatsapp_http_502_unparseable' })

  const noId = fakeFetch({ status: 200, body: JSON.stringify({ messaging_product: 'whatsapp', messages: [] }) })
  provider = createWhatsAppMetaProvider(config, { fetch: noId.fetchImpl, isOptedOut: async () => false })
  assert.deepEqual(await provider.send({ to: '+27821234567', text: statusText, kind: 'customer_order_status' }), { accepted: false, errorName: 'whatsapp_no_message_id' })

  const unmatched = fakeFetch({ status: 200, body: '{}' })
  provider = createWhatsAppMetaProvider(config, { fetch: unmatched.fetchImpl, isOptedOut: async () => false })
  assert.deepEqual(await provider.send({ to: '+27821234567', text: 'Some wording the catalogue has never seen', kind: 'customer_order_status' }), { accepted: false, errorName: 'whatsapp_template_unmatched' })
  assert.equal(unmatched.calls.length, 0, 'nothing reached Meta')

  const down = fakeFetch(new Error('ECONNRESET'))
  provider = createWhatsAppMetaProvider(config, { fetch: down.fetchImpl, isOptedOut: async () => false })
  await assert.rejects(() => provider.send({ to: '+27821234567', text: statusText, kind: 'customer_order_status' }), /ECONNRESET/, 'a network error propagates; the seam turns it into message.failed')
})

test('a STOP is honoured at send time for order messages — but a sign-in code the customer asked for still goes, and a reply is plain text', async () => {
  const asked: { phone: string; businessId: string | null }[] = []
  const { calls, fetchImpl } = fakeFetch({ status: 200, body: JSON.stringify({ messages: [{ id: 'wamid.1' }] }) })
  const provider = createWhatsAppMetaProvider(config, {
    fetch: fetchImpl,
    isOptedOut: async (phone, businessId) => {
      asked.push({ phone, businessId })
      return true
    },
  })
  assert.deepEqual(await provider.send({ to: '+27821234567', text: statusText, kind: 'customer_order_status', businessId: 'biz-1' } as never), { accepted: false, errorName: 'whatsapp_opted_out' })
  assert.deepEqual(asked, [{ phone: '+27821234567', businessId: 'biz-1' }], 'the shop on the message, when the seam carries one, scopes the check')
  assert.equal(calls.length, 0)

  const code = await provider.send({ to: '+27821234567', text: 'Your Skhokho sign-in code is 123456. It works for 10 minutes.', kind: 'customer_login_code' })
  assert.equal(code.accepted, true)
  assert.equal(asked.length, 1, 'no opt-out check for a code')

  const reply = await provider.send({ to: '+27821234567', text: 'You said STOP. Done.', kind: 'unspecified' })
  assert.equal(reply.accepted, true)
  assert.equal(JSON.parse(calls[1].init.body).type, 'text')
})

test('MESSAGE_PROVIDER=whatsapp resolves through the seam only when all four variables are set', async (t) => {
  const env = process.env as Record<string, string | undefined>
  const keys = ['MESSAGE_PROVIDER', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET'] as const
  const saved = Object.fromEntries(keys.map((k) => [k, env[k]]))
  t.after(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete env[k]
      else env[k] = saved[k]
    }
    __setMessageProviderForTests(undefined)
  })
  __setMessageProviderForTests(undefined)
  env.MESSAGE_PROVIDER = 'whatsapp'
  delete env.WHATSAPP_APP_SECRET
  env.WHATSAPP_PHONE_NUMBER_ID = '1'
  env.WHATSAPP_ACCESS_TOKEN = 't'
  env.WHATSAPP_VERIFY_TOKEN = 'v'
  assert.equal(isPhoneMessagingConfigured(), false, 'three of four is unconfigured')
  assert.deepEqual(await sendPhoneMessage({ to: '+27821234567', text: 'x', kind: 'unspecified' }), { sent: false, configured: false })
  env.WHATSAPP_APP_SECRET = 's'
  assert.equal(isPhoneMessagingConfigured(), true)
})

test('webhook signatures: HMAC-SHA256 of the raw body with the app secret, constant-time, prefix required', () => {
  const body = '{"object":"whatsapp_business_account","entry":[]}'
  const good = `sha256=${createHmac('sha256', 'app-secret').update(body).digest('hex')}`
  assert.equal(verifyWebhookSignature(body, good, 'app-secret'), true)
  assert.equal(verifyWebhookSignature(body, good.toUpperCase().replace('SHA256=', 'sha256='), 'app-secret'), true, 'hex case does not matter')
  assert.equal(verifyWebhookSignature(body + ' ', good, 'app-secret'), false, 'any change to the bytes')
  assert.equal(verifyWebhookSignature(body, good, 'other-secret'), false)
  assert.equal(verifyWebhookSignature(body, good.slice('sha256='.length), 'app-secret'), false, 'prefix required')
  assert.equal(verifyWebhookSignature(body, 'sha256=abc', 'app-secret'), false, 'wrong length is a mismatch, not a crash')
  assert.equal(verifyWebhookSignature(body, null, 'app-secret'), false)
})

test("parsing Meta's envelope: statuses with pricing and errors, text / button / interactive replies, foreign numbers ignored", () => {
  const body = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '27600000000', phone_number_id: '106540352242922' },
              statuses: [
                { id: 'wamid.s1', status: 'delivered', timestamp: '1', recipient_id: '27821234567', conversation: { id: 'c', origin: { type: 'utility' } }, pricing: { billable: true, pricing_model: 'PMP', category: 'utility', type: 'regular' } },
                { id: 'wamid.s2', status: 'failed', timestamp: '2', recipient_id: '27821234567', errors: [{ code: 131026, title: 'Message undeliverable', message: 'x', error_data: { details: 'y' } }] },
                { id: 'wamid.s3', status: 'played', timestamp: '3', recipient_id: '27821234567' },
                { id: 'wamid.s4', status: 'teleported', timestamp: '4', recipient_id: '27821234567' },
              ],
              contacts: [{ profile: { name: 'Thandi' }, wa_id: '27821234567' }],
              messages: [
                { from: '27821234567', id: 'wamid.m1', timestamp: '5', type: 'text', text: { body: 'STOP' } },
                { from: '27821234567', id: 'wamid.m2', timestamp: '6', type: 'button', button: { payload: 'Unsubscribe', text: 'Unsubscribe' }, context: { from: '27600000000', id: 'wamid.s1' } },
                { from: '27821234567', id: 'wamid.m3', timestamp: '7', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'start', title: 'Start' } } },
                { from: '16505551234', id: 'wamid.m4', timestamp: '8', type: 'image', image: { id: 'img' } },
              ],
            },
          },
          { field: 'messages', value: { metadata: { phone_number_id: 'someone-elses-number' }, messages: [{ from: '27821234567', id: 'wamid.x', type: 'text', text: { body: 'STOP' } }] } },
        ],
      },
    ],
  }
  const parsed = parseWebhookPayload(body, '106540352242922')
  assert.deepEqual(parsed.statuses, [
    { messageId: 'wamid.s1', status: 'delivered', errorCodes: [], pricingCategory: 'utility', pricingType: 'regular' },
    { messageId: 'wamid.s2', status: 'failed', errorCodes: [131026], pricingCategory: null, pricingType: null },
    { messageId: 'wamid.s3', status: 'played', errorCodes: [], pricingCategory: null, pricingType: null },
  ])
  assert.deepEqual(parsed.inbound, [
    { messageId: 'wamid.m1', from: '+27821234567', type: 'text', text: 'STOP' },
    { messageId: 'wamid.m2', from: '+27821234567', type: 'button', text: 'Unsubscribe' },
    { messageId: 'wamid.m3', from: '+27821234567', type: 'interactive', text: 'Start' },
    { messageId: 'wamid.m4', from: null, type: 'image', text: null },
  ])
  assert.equal(parsed.foreign, 1)
  assert.deepEqual(parseWebhookPayload('garbage', '1'), { statuses: [], inbound: [], foreign: 0 })
  assert.deepEqual(parseWebhookPayload({ entry: [{ changes: [{ value: null }] }] }, '1'), { statuses: [], inbound: [], foreign: 0 })
})

test('STOP and START are whole-message keywords in any case and spelling; other text is neither', () => {
  for (const s of ['STOP', 'stop', 'Stop.', ' stop all ', 'UNSUBSCRIBE', 'Cancel', 'opt out', 'quit!']) assert.equal(classifyInboundText(s), 'STOP', s)
  for (const s of ['START', 'start', 'Unstop', 'resume', 'subscribe']) assert.equal(classifyInboundText(s), 'START', s)
  for (const s of ['please stop sending', 'where is my order', 'stop? no', '', null]) assert.equal(classifyInboundText(s), null, String(s))
})
