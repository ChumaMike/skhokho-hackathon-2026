import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { GET, POST } from './route'

/**
 * The webhook as a route, without a database: Meta's URL verification and
 * a signed status / chatter payload, which need no writes. STOP / START and
 * the refusals that raise security events are proven against a real
 * database in src/modules/customers/channel-consent.db.test.ts.
 */

const ENV = { WHATSAPP_PHONE_NUMBER_ID: '106540352242922', WHATSAPP_ACCESS_TOKEN: 'tok', WHATSAPP_VERIFY_TOKEN: 'verify-me-please', WHATSAPP_APP_SECRET: 'app-secret' }
const env = process.env as Record<string, string | undefined>
const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, env[k]]))

test.before(() => Object.assign(env, ENV))
test.after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
})

const sign = (body: string) => `sha256=${createHmac('sha256', ENV.WHATSAPP_APP_SECRET).update(body).digest('hex')}`

function post(body: string, signature: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (signature) headers['x-hub-signature-256'] = signature
  return POST(new NextRequest('https://app.example.test/api/messaging/whatsapp/webhook', { method: 'POST', body, headers }))
}

test("GET echoes Meta's challenge for our verify token only", async () => {
  const ok = await GET(new NextRequest('https://app.example.test/api/messaging/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me-please&hub.challenge=1158201444'))
  assert.equal(ok.status, 200)
  assert.equal(await ok.text(), '1158201444')
  assert.equal(ok.headers.get('content-type'), 'text/plain')

  const noChallenge = await GET(new NextRequest('https://app.example.test/api/messaging/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me-please'))
  assert.equal(noChallenge.status, 403)
})

test('unconfigured: both methods answer 404 — nothing is verified or processed on a deployment without the variables', async () => {
  delete env.WHATSAPP_APP_SECRET
  try {
    assert.equal((await GET(new NextRequest('https://app.example.test/api/messaging/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=verify-me-please&hub.challenge=1'))).status, 404)
    assert.equal((await post('{}', sign('{}'))).status, 404)
  } finally {
    env.WHATSAPP_APP_SECRET = ENV.WHATSAPP_APP_SECRET
  }
})

test('a signed status payload and a signed non-keyword reply are acknowledged with 200 and need no writes', async () => {
  const body = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '27600000000', phone_number_id: ENV.WHATSAPP_PHONE_NUMBER_ID },
              statuses: [{ id: 'wamid.1', status: 'read', timestamp: '1', recipient_id: '27821234567', pricing: { category: 'utility', type: 'regular' } }],
              messages: [{ from: '27821234567', id: 'wamid.2', timestamp: '2', type: 'text', text: { body: 'where is my order?' } }],
            },
          },
        ],
      },
    ],
  })
  const res = await post(body, sign(body))
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })

  const junk = 'not json'
  const res2 = await post(junk, sign(junk))
  assert.equal(res2.status, 200, 'a verified body we cannot read is still 200 — Meta would only retry it')
})
