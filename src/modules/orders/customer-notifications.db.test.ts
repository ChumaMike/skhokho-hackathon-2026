import test from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma/client'
import { resetTestDb, testDb } from '@/lib/testing/db'
import { __setEmailTransportForTests } from '@/lib/email'
import { __setMessageProviderForTests, type OutboundMessage } from '@/lib/messaging/provider'
import { notifyCustomerOrderPlacedByPhone, notifyCustomerOrderStatus, notifyTargets } from './customer-notifications'

/**
 * Every status message that goes by email also goes to the phone typed at
 * checkout, through the MessageProvider — and a phone-only order gets the
 * same milestones. Nothing secret rides along.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const texts: OutboundMessage[] = []
const emails: { to: string; subject: string; text?: string }[] = []
let businessId: string

async function order(metadata: Record<string, string> | undefined, n: string) {
  return prisma.order.create({
    data: { businessId, orderNumber: `ORD-${run}-${n}`.toUpperCase(), status: 'PENDING', subtotal: 80, total: 80, metadata },
    select: { id: true, orderNumber: true },
  })
}

test.before(async () => {
  await resetTestDb()
  __setMessageProviderForTests({ name: 'test', async send(m) { texts.push(m); return { accepted: true } } })
  __setEmailTransportForTests(async (msg) => { emails.push({ to: msg.to, subject: msg.subject, text: msg.text }); return { id: `m-${emails.length}` } })
  const biz = await prisma.business.create({ data: { name: 'Notify Kota', slug: `notify-${run}`, status: 'ACTIVE', whatsapp: '082 999 0000' }, select: { id: true } })
  businessId = biz.id
})
test.after(async () => {
  __setMessageProviderForTests(undefined)
  __setEmailTransportForTests(null)
  await resetTestDb()
  await testDb.$disconnect()
})

test('notify targets come from the order only, and a malformed phone is ignored', () => {
  assert.deepEqual(notifyTargets(null), { email: null, phone: null })
  assert.deepEqual(notifyTargets({ notifyEmail: 'a@b.test', notifyPhone: '+27821234567' }), { email: 'a@b.test', phone: '+27821234567' })
  assert.deepEqual(notifyTargets({ notifyPhone: '0821234567' }), { email: null, phone: null })
})

test('a status change reaches both the email and the phone typed at checkout', async () => {
  const o = await order({ notifyEmail: `both-${run}@example.test`, notifyPhone: '+27821234501' }, 'a')
  await notifyCustomerOrderStatus(o.id, 'CONFIRMED')
  const mail = emails.find((m) => m.to === `both-${run}@example.test`)
  const text = texts.find((t) => t.to === '+27821234501')
  assert.ok(mail && mail.subject.includes(o.orderNumber))
  assert.ok(text && text.text.includes(o.orderNumber) && text.text.includes('Notify Kota') && text.text.includes('082 999 0000'))
  assert.equal(text.kind, 'customer_order_status')
})

test('a phone-only customer gets every milestone by text, with no code or token in it', async () => {
  const o = await order({ notifyPhone: '+27821234502' }, 'b')
  texts.length = 0
  emails.length = 0
  for (const status of ['CONFIRMED', 'READY_FOR_COLLECTION', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'] as const) {
    await notifyCustomerOrderStatus(o.id, status)
  }
  assert.equal(texts.length, 5)
  assert.equal(emails.length, 0)
  for (const t of texts) {
    assert.equal(t.to, '+27821234502')
    assert.ok(!/https?:\/\//.test(t.text) && !/\b\d{6}\b/.test(t.text))
  }
})

test('the confirmation text carries the order number, the total and the customer page link; an email-only order sends none', async () => {
  const o = await order({ notifyPhone: '+27821234503' }, 'c')
  texts.length = 0
  await notifyCustomerOrderPlacedByPhone(o.id, { trackingUrl: 'https://skhokho.test/store/order/x', deliveryUrl: null, paymentMessage: 'Pay when you collect.' })
  assert.equal(texts.length, 1)
  assert.ok(texts[0].text.includes(o.orderNumber) && texts[0].text.includes('R 80.00') && texts[0].text.includes('Pay when you collect.') && texts[0].text.includes('/store/order/x'))
  assert.equal(texts[0].kind, 'customer_order_confirmation')

  const emailOnly = await order({ notifyEmail: `only-${run}@example.test` }, 'd')
  texts.length = 0
  await notifyCustomerOrderPlacedByPhone(emailOnly.id, { trackingUrl: 'https://skhokho.test/store/order/y', deliveryUrl: null, paymentMessage: '' })
  assert.equal(texts.length, 0)
})

test('with no phone provider configured, the email still goes and nothing throws', async (t) => {
  __setMessageProviderForTests(null)
  t.after(() => __setMessageProviderForTests({ name: 'test', async send(m) { texts.push(m); return { accepted: true } } }))
  const o = await order({ notifyEmail: `fallback-${run}@example.test`, notifyPhone: '+27821234504' }, 'e')
  emails.length = 0
  await notifyCustomerOrderStatus(o.id, 'READY_FOR_COLLECTION')
  assert.equal(emails.length, 1)
})
