import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { resetTestDb, testDb } from '@/lib/testing/db'
import { withRequestScope } from '@/lib/testing/request-scope'
import { __setEmailTransportForTests } from '@/lib/email'
import { __setMessageProviderForTests, type OutboundMessage } from '@/lib/messaging/provider'
import { customerOrderStatusText } from '@/lib/messaging/templates'
import { STOP_REPLY_TEXT, START_REPLY_TEXT } from '@/lib/messaging/whatsapp-templates'
import { createWhatsAppMetaProvider, type FetchLike } from '@/lib/messaging/providers/whatsapp-meta'
import { GET, POST as webhook } from '@/app/api/messaging/whatsapp/webhook/route'
import { POST as checkout } from '@/app/api/store/checkout/route'
import { hashPassword } from '@/modules/auth/auth.service'
import { createBusiness } from '@/modules/tenant/tenant.service'
import { setBusinessCapabilities } from '@/modules/tenant/capabilities'
import { createProduct } from '@/modules/catalog/catalog.service'
import { TERMS_VERSION } from '@/lib/legal/documents'
import { registerCustomer } from './customer.service'
import { isPhoneOptedOut, recordChannelConsent } from './channel-consent'

/**
 * The order_updates consent ledger against a real database, end to end:
 *
 *  - a STOP that arrives through the signed webhook is recorded for every
 *    shop the number belongs to (one platform number cannot name a shop),
 *    acknowledged once, and from then on the WhatsApp provider refuses that
 *    number's order messages — while a sign-in code still goes;
 *  - START puts it back, with its own acknowledgement;
 *  - a STOP from a number nobody knows records nothing and is not answered;
 *  - a bad signature and a wrong verify token are refused (and audited);
 *  - checkout writes the grant with the order number and Terms version as
 *    evidence, so the ledger shows what the customer agreed to and when.
 *
 * All writes go through set_channel_consent (migration 20261022142000);
 * nothing here touches consents through Prisma.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const ENV = { WHATSAPP_PHONE_NUMBER_ID: '106540352242922', WHATSAPP_ACCESS_TOKEN: 'tok', WHATSAPP_VERIFY_TOKEN: `verify-${run}`, WHATSAPP_APP_SECRET: `secret-${run}` }
const env = process.env as Record<string, string | undefined>
const savedEnv = Object.fromEntries(Object.keys(ENV).map((k) => [k, env[k]]))

const PHONE = `+2782${Math.floor(1_000_000 + Math.random() * 8_999_999)}`
const STRANGER = `+2783${Math.floor(1_000_000 + Math.random() * 8_999_999)}`
const sent: OutboundMessage[] = []
let shopA = ''
let shopB = ''

const sign = (body: string) => `sha256=${createHmac('sha256', ENV.WHATSAPP_APP_SECRET).update(body).digest('hex')}`

function inboundText(from: string, text: string, id = `wamid.${Math.random().toString(36).slice(2)}`) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: ENV.WHATSAPP_PHONE_NUMBER_ID }, messages: [{ from: from.replace('+', ''), id, timestamp: '1', type: 'text', text: { body: text } }] } }] }],
  })
}

function post(body: string, signature: string | null) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.9' }
  if (signature) headers['x-hub-signature-256'] = signature
  return webhook(new NextRequest('https://app.example.test/api/messaging/whatsapp/webhook', { method: 'POST', body, headers }))
}

async function ledger(businessId: string) {
  return prisma.$queryRaw<{ granted_at: Date; revoked_at: Date | null; source: string; evidence: Record<string, unknown> }[]>`
    SELECT c.granted_at, c.revoked_at, c.source, c.evidence
    FROM consents c JOIN customer_identifiers ci ON ci.customer_id = c.customer_id
    WHERE ci.type = 'phone' AND ci.value = ${PHONE} AND c.business_id = ${businessId}::uuid
      AND c.purpose = 'order_updates' AND c.channel = 'whatsapp'
    ORDER BY c.granted_at ASC, c.id ASC`
}

test.before(async () => {
  await resetTestDb()
  Object.assign(env, ENV)
  __setMessageProviderForTests({ name: 'capture', async send(m) { sent.push(m); return { accepted: true, providerId: `cap-${sent.length}` } } })
  __setEmailTransportForTests(async () => ({ id: 'test' }))
  const a = await prisma.business.create({ data: { name: `WA Shop A ${run}`, slug: `wa-a-${run}`, status: 'ACTIVE' }, select: { id: true } })
  const b = await prisma.business.create({ data: { name: `WA Shop B ${run}`, slug: `wa-b-${run}`, status: 'ACTIVE' }, select: { id: true } })
  shopA = a.id
  shopB = b.id
  await registerCustomer(shopA, PHONE, 'Thandi', 'storefront_order')
  await registerCustomer(shopB, PHONE, 'Thandi', 'storefront_order')
})
test.after(async () => {
  __setMessageProviderForTests(undefined)
  __setEmailTransportForTests(null)
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete env[k]
    else env[k] = v
  }
  await resetTestDb()
  await testDb.$disconnect()
})

test('a grant at one shop is the latest decision there and is not an opt-out anywhere', async () => {
  const r = await recordChannelConsent({ phone: PHONE, channel: 'whatsapp', purpose: 'order_updates', granted: true, source: 'test_grant', evidence: { order_number: 'ORD-1' }, businessId: shopA })
  assert.deepEqual(r, { memberships: 1 })
  assert.equal(await isPhoneOptedOut(PHONE, 'whatsapp', shopA), false)
  assert.equal(await isPhoneOptedOut(PHONE, 'whatsapp', shopB), false, 'no row at B = never said STOP')
  assert.equal(await isPhoneOptedOut(PHONE, 'whatsapp'), false)
  const rows = await ledger(shopA)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].revoked_at, null)
  assert.deepEqual(rows[0].evidence, { order_number: 'ORD-1' })
})

test('STOP through the signed webhook withdraws at every shop, is acknowledged once, and the provider then refuses order messages but not a sign-in code', async () => {
  sent.length = 0
  const body = inboundText(PHONE, 'Stop', 'wamid.stop1')
  const res = await post(body, sign(body))
  assert.equal(res.status, 200)

  assert.equal(await isPhoneOptedOut(PHONE, 'whatsapp', shopA), true)
  assert.equal(await isPhoneOptedOut(PHONE, 'whatsapp', shopB), true)
  assert.equal(await isPhoneOptedOut(PHONE, 'whatsapp'), true)
  const a = await ledger(shopA)
  assert.equal(a.length, 2, 'the grant, now revoked, plus the withdrawal record')
  assert.ok(a[0].revoked_at, 'the open grant was revoked')
  assert.equal(a[1].source, 'whatsapp_stop')
  assert.ok(a[1].revoked_at && a[1].granted_at.getTime() === a[1].revoked_at.getTime(), 'a standalone withdrawal: granted_at = revoked_at')
  assert.deepEqual(a[1].evidence, { provider_message_id: 'wamid.stop1' })
  const b = await ledger(shopB)
  assert.equal(b.length, 1, 'B had nothing to revoke; the withdrawal is still on record there')
  assert.equal(b[0].source, 'whatsapp_stop')

  assert.equal(sent.length, 1, 'one acknowledgement')
  assert.equal(sent[0].to, PHONE)
  assert.equal(sent[0].text, STOP_REPLY_TEXT)
  assert.equal(sent[0].kind, 'unspecified')

  // The real provider, with a fake network and the REAL ledger lookup.
  const calls: string[] = []
  const fetchImpl: FetchLike = async (_url, init) => {
    calls.push(JSON.parse(init.body).type)
    return { ok: true, status: 200, text: async () => JSON.stringify({ messages: [{ id: 'wamid.sent' }] }) }
  }
  const provider = createWhatsAppMetaProvider({ phoneNumberId: '1', accessToken: 't', verifyToken: 'v', appSecret: 's', apiVersion: 'v24.0' }, { fetch: fetchImpl })
  const status = customerOrderStatusText({ status: 'CONFIRMED', businessName: `WA Shop A ${run}`, orderNumber: 'ORD-1', contact: null })
  assert.deepEqual(await provider.send({ to: PHONE, text: status, kind: 'customer_order_status' }), { accepted: false, errorName: 'whatsapp_opted_out' })
  assert.deepEqual(await provider.send({ to: PHONE, text: status, kind: 'customer_order_status', businessId: shopB } as never), { accepted: false, errorName: 'whatsapp_opted_out' })
  assert.deepEqual(calls, [], 'nothing reached Meta')
  const code = await provider.send({ to: PHONE, text: 'Your Skhokho sign-in code is 123456. It works for 10 minutes.', kind: 'customer_login_code' })
  assert.equal(code.accepted, true)
  assert.deepEqual(calls, ['template'], 'the code the customer asked for still goes')
})

test('START grants again at every shop and is acknowledged; the provider sends order messages once more', async () => {
  sent.length = 0
  const body = inboundText(PHONE, 'START', 'wamid.start1')
  assert.equal((await post(body, sign(body))).status, 200)
  assert.equal(await isPhoneOptedOut(PHONE, 'whatsapp', shopA), false)
  assert.equal(await isPhoneOptedOut(PHONE, 'whatsapp', shopB), false)
  const b = await ledger(shopB)
  assert.equal(b.at(-1)?.source, 'whatsapp_start')
  assert.equal(b.at(-1)?.revoked_at, null)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].text, START_REPLY_TEXT)
})

test('a STOP from a number nobody knows records nothing and gets no reply; chatter is ignored', async () => {
  sent.length = 0
  const body = inboundText(STRANGER, 'STOP')
  assert.equal((await post(body, sign(body))).status, 200)
  assert.equal(sent.length, 0)
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n FROM consents c JOIN customer_identifiers ci ON ci.customer_id = c.customer_id WHERE ci.value = ${STRANGER}`
  assert.equal(Number(rows[0].n), 0)
  const chatter = inboundText(PHONE, 'is my kota ready?')
  assert.equal((await post(chatter, sign(chatter))).status, 200)
  assert.equal(sent.length, 0)
})

test('a missigned body is refused with 401 and a wrong verify token with 403, both audited as SECURITY / DENIED', async () => {
  const body = inboundText(PHONE, 'STOP')
  const before = await prisma.platformAuditEvent.count({ where: { action: 'messaging_webhook_rejected' } })
  assert.equal((await post(body, 'sha256=' + '0'.repeat(64))).status, 401)
  assert.equal((await post(body, null)).status, 401)
  const bad = await GET(new NextRequest(`https://app.example.test/api/messaging/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`))
  assert.equal(bad.status, 403)
  // The events are fire-and-forget; give them a tick.
  await new Promise((r) => setTimeout(r, 300))
  const after = await prisma.platformAuditEvent.count({ where: { action: 'messaging_webhook_rejected', category: 'SECURITY', outcome: 'DENIED' } })
  assert.equal(after - before, 3)
  assert.equal(await isPhoneOptedOut(PHONE, 'whatsapp'), false, 'the refused STOP changed nothing')
})

test('checkout records the order-updates grant with the order number and the Terms version as evidence', async () => {
  const { business } = await createBusiness({
    name: `WA Checkout ${run}`,
    category: 'RETAIL_STORE' as never,
    owner: { firstName: 'Owner', lastName: 'WA', email: `wa-${run}@example.test`, passwordHash: await hashPassword('SomePassword123') },
  })
  await setBusinessCapabilities(business.id, ['PRODUCTS', 'ORDERS'] as never)
  await prisma.business.update({ where: { id: business.id }, data: { status: 'ACTIVE' } })
  const product = await createProduct(business.id, { name: 'Kota', price: 35 } as never)
  const phone = `+2784${Math.floor(1_000_000 + Math.random() * 8_999_999)}`
  const req = new NextRequest('https://app.example.test/api/store/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.7.7.7' },
    body: JSON.stringify({
      businessId: business.id,
      lines: [{ productId: product.id, quantity: 1 }],
      fulfilmentMethod: 'COLLECTION',
      phone,
      name: 'Sipho',
      consent: true,
      termsVersion: TERMS_VERSION,
      idempotencyKey: `idem-wa-${run}`,
    }),
  })
  const res = await withRequestScope(() => checkout(req))
  const json = (await res.json()) as { ok: boolean; orderNumber?: string }
  assert.equal(json.ok, true, JSON.stringify(json))

  const rows = await prisma.$queryRaw<{ source: string; revoked_at: Date | null; evidence: Record<string, unknown> }[]>`
    SELECT c.source, c.revoked_at, c.evidence
    FROM consents c JOIN customer_identifiers ci ON ci.customer_id = c.customer_id
    WHERE ci.type = 'phone' AND ci.value = ${phone} AND c.business_id = ${business.id}::uuid
      AND c.purpose = 'order_updates' AND c.channel = 'whatsapp'`
  assert.equal(rows.length, 1)
  assert.equal(rows[0].source, 'storefront_checkout')
  assert.equal(rows[0].revoked_at, null)
  assert.deepEqual(rows[0].evidence, { order_number: json.orderNumber, terms_version: TERMS_VERSION })
  assert.equal(await isPhoneOptedOut(phone, 'whatsapp', business.id), false)
})
