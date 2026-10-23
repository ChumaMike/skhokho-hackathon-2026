/**
 * The message log and the daily cap, against the real database.
 *
 * The adapter's own tests (sms-bulksms.test.ts) are pure and need no database.
 * These cover what only real rows can show: that the cap counts the right
 * statuses over the right window, that a send refused by the cap is recorded
 * rather than lost, that a delivery report cannot be replayed into a different
 * answer, and that the seam in provider.ts is actually wired to all of it.
 *
 * Every row is scoped to a business created for this run and removed in
 * `after`, so a concurrent run on the same database cannot interfere.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma/client'
import { withinCap, recordSend, applyDeliveryReport, startOfSaDay, DEFAULT_DAILY_CAP } from './message-log'
import { sendPhoneMessage, __setMessageProviderForTests, maskPhone, type MessageProvider } from './provider'

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
let businessId = ''

const NUMBER = '+27821234567'

test.before(async () => {
  const b = await prisma.business.create({
    data: { name: `SMS Log ${run}`, slug: `sms-log-${run}`, status: 'ACTIVE' },
    select: { id: true },
  })
  businessId = b.id
})

test.after(async () => {
  // SetNull on the FK means logs outlive a business, so they go first and by
  // business id — never a blanket delete of the table.
  await prisma.messageLog.deleteMany({ where: { businessId } })
  await prisma.business.deleteMany({ where: { id: businessId } })
  __setMessageProviderForTests(undefined)
  delete process.env.SMS_DAILY_CAP_PER_BUSINESS
})

/** A row, with `createdAt` forced so the day-window logic can be exercised. */
async function logRow(status: 'ACCEPTED' | 'REJECTED' | 'CAPPED', createdAt?: Date) {
  await recordSend({
    businessId,
    kind: 'customer_order_status',
    provider: 'bulksms',
    toMasked: maskPhone(NUMBER),
    bodyChars: 42,
    status,
  })
  if (createdAt) {
    const newest = await prisma.messageLog.findFirst({ where: { businessId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
    await prisma.messageLog.update({ where: { id: newest!.id }, data: { createdAt } })
  }
}

test('a send is recorded with a masked number and no way back to the message', async () => {
  await recordSend({
    businessId,
    kind: 'customer_login_code',
    provider: 'bulksms',
    toMasked: maskPhone(NUMBER),
    bodyChars: 19,
    status: 'ACCEPTED',
    providerMessageId: `pm-${run}-1`,
    costCredits: 0.3,
  })
  const row = await prisma.messageLog.findUnique({ where: { providerMessageId: `pm-${run}-1` } })
  assert.equal(row?.status, 'ACCEPTED')
  assert.equal(row?.bodyChars, 19)
  assert.equal(Number(row?.costCredits), 0.3)
  // The whole point of the masking: the stored value cannot be dialled.
  assert.equal(row?.toMasked.includes('821234567'), false)
  assert.match(row!.toMasked, /\*567$|\*\d{3}$/)
  // There is no column that could hold the text.
  assert.equal('body' in (row as object), false)
  await prisma.messageLog.delete({ where: { id: row!.id } })
})

test('only sends that cost money consume the daily allowance', async () => {
  await logRow('ACCEPTED')
  await logRow('REJECTED') // the provider refused — charged nothing
  await logRow('CAPPED') // never left the building
  const verdict = await withinCap(businessId)
  assert.equal(verdict.used, 1, 'a refusal and a cap must not eat the allowance')
  assert.equal(verdict.cap, DEFAULT_DAILY_CAP)
  assert.equal(verdict.allowed, true)
})

test("yesterday's messages do not count against today", async () => {
  const before = (await withinCap(businessId)).used
  // One second before today's SA midnight is yesterday, however it looks in UTC.
  await logRow('ACCEPTED', new Date(startOfSaDay(new Date()).getTime() - 1000))
  assert.equal((await withinCap(businessId)).used, before, 'a message from before SA midnight still counted')
})

test('at the cap the verdict is refusal, and a cap of zero stops everything', async () => {
  process.env.SMS_DAILY_CAP_PER_BUSINESS = '1'
  const atCap = await withinCap(businessId)
  assert.equal(atCap.cap, 1)
  assert.equal(atCap.allowed, false, 'one accepted message already exists, so a cap of 1 is reached')

  process.env.SMS_DAILY_CAP_PER_BUSINESS = '0'
  assert.equal((await withinCap(businessId)).allowed, false)
  delete process.env.SMS_DAILY_CAP_PER_BUSINESS
})

test('the cap refuses the send, records why, and nothing reaches the provider', async () => {
  process.env.SMS_DAILY_CAP_PER_BUSINESS = '0'
  let called = 0
  const provider: MessageProvider = {
    name: 'fake-sms',
    async send() {
      called += 1
      return { accepted: true, providerId: 'should-never-happen' }
    },
  }
  __setMessageProviderForTests(provider)
  try {
    const result = await sendPhoneMessage({ to: NUMBER, text: 'Your order is ready', kind: 'customer_order_status', businessId })
    assert.equal(result.configured, true, 'a cap is not the same as an unconfigured provider')
    assert.equal(result.sent, false)
    assert.equal(called, 0, 'the provider must not be called once the cap is reached')

    const capped = await prisma.messageLog.findFirst({
      where: { businessId, status: 'CAPPED' },
      orderBy: { createdAt: 'desc' },
    })
    assert.equal(capped?.errorName, 'daily_cap_0', 'an owner has to be able to see why nothing was sent')
    assert.equal(capped?.provider, 'fake-sms')
  } finally {
    __setMessageProviderForTests(undefined)
    delete process.env.SMS_DAILY_CAP_PER_BUSINESS
  }
})

test('an accepted send through the seam is logged with the provider id and cost', async () => {
  __setMessageProviderForTests({
    name: 'fake-sms',
    async send() {
      return { accepted: true, providerId: `pm-${run}-seam`, costCredits: 0.6 }
    },
  })
  try {
    const result = await sendPhoneMessage({ to: NUMBER, text: 'hello', kind: 'customer_order_confirmation', businessId })
    assert.equal(result.sent, true)
    const row = await prisma.messageLog.findUnique({ where: { providerMessageId: `pm-${run}-seam` } })
    assert.equal(row?.status, 'ACCEPTED')
    assert.equal(row?.businessId, businessId, 'the cost must be attributable to the shop it was sent for')
    assert.equal(Number(row?.costCredits), 0.6)
  } finally {
    __setMessageProviderForTests(undefined)
  }
})

test('a provider refusal is logged as REJECTED and reported as not sent', async () => {
  __setMessageProviderForTests({
    name: 'fake-sms',
    async send() {
      return { accepted: false, errorName: 'bulksms_status_failed' }
    },
  })
  try {
    const result = await sendPhoneMessage({ to: NUMBER, text: 'hello', kind: 'customer_order_status', businessId })
    assert.equal(result.sent, false)
    assert.equal(result.configured, true)
    const row = await prisma.messageLog.findFirst({ where: { businessId, status: 'REJECTED' }, orderBy: { createdAt: 'desc' } })
    assert.equal(row?.errorName, 'bulksms_status_failed')
  } finally {
    __setMessageProviderForTests(undefined)
  }
})

test('a provider that throws is logged, and the seam still never throws', async () => {
  __setMessageProviderForTests({
    name: 'fake-sms',
    async send() {
      const e = new Error('boom')
      e.name = 'TypeError'
      throw e
    },
  })
  try {
    const result = await sendPhoneMessage({ to: NUMBER, text: 'hello', kind: 'customer_order_status', businessId })
    assert.equal(result.sent, false)
    const row = await prisma.messageLog.findFirst({ where: { businessId, errorName: 'TypeError' }, orderBy: { createdAt: 'desc' } })
    assert.equal(row?.status, 'REJECTED')
  } finally {
    __setMessageProviderForTests(undefined)
  }
})

test('a delivery report moves an accepted message to delivered, once', async () => {
  await recordSend({
    businessId,
    kind: 'customer_order_status',
    provider: 'bulksms',
    toMasked: maskPhone(NUMBER),
    bodyChars: 10,
    status: 'ACCEPTED',
    providerMessageId: `pm-${run}-dr`,
  })

  assert.equal(await applyDeliveryReport({ providerMessageId: `pm-${run}-dr`, delivered: true }), true)
  const delivered = await prisma.messageLog.findUnique({ where: { providerMessageId: `pm-${run}-dr` } })
  assert.equal(delivered?.status, 'DELIVERED')
  assert.notEqual(delivered?.deliveredAt, null)
  assert.notEqual(delivered?.reportedAt, null)

  // A replayed report — BulkSMS retries, and retries can duplicate — must not
  // flip a final state back, and must say it changed nothing.
  assert.equal(await applyDeliveryReport({ providerMessageId: `pm-${run}-dr`, delivered: false }), false)
  const after = await prisma.messageLog.findUnique({ where: { providerMessageId: `pm-${run}-dr` } })
  assert.equal(after?.status, 'DELIVERED', 'a late duplicate undid a delivered status')
})

test('a non-delivery is recorded with its reason, and an unknown id is simply ignored', async () => {
  await recordSend({
    businessId,
    kind: 'customer_order_status',
    provider: 'bulksms',
    toMasked: maskPhone(NUMBER),
    bodyChars: 10,
    status: 'ACCEPTED',
    providerMessageId: `pm-${run}-fail`,
  })
  assert.equal(await applyDeliveryReport({ providerMessageId: `pm-${run}-fail`, delivered: false, errorName: 'bulksms_failed' }), true)
  const row = await prisma.messageLog.findUnique({ where: { providerMessageId: `pm-${run}-fail` } })
  assert.equal(row?.status, 'UNDELIVERED')
  assert.equal(row?.errorName, 'bulksms_failed')
  assert.equal(row?.deliveredAt, null)

  // Not an error: a replay, or a message sent before this table existed.
  assert.equal(await applyDeliveryReport({ providerMessageId: `pm-${run}-never-existed`, delivered: true }), false)
})

test('a sign-in code is recorded without a business, so it cannot be billed to one', async () => {
  __setMessageProviderForTests({
    name: 'fake-sms',
    async send() {
      return { accepted: true, providerId: `pm-${run}-platform` }
    },
  })
  try {
    // No businessId: login codes are deliberately not attributed to a shop.
    await sendPhoneMessage({ to: NUMBER, text: 'Your code is 123456', kind: 'customer_login_code' })
    const row = await prisma.messageLog.findUnique({ where: { providerMessageId: `pm-${run}-platform` } })
    assert.equal(row?.businessId, null)
    assert.equal(row?.kind, 'customer_login_code')
    await prisma.messageLog.delete({ where: { id: row!.id } })
  } finally {
    __setMessageProviderForTests(undefined)
  }
})

test('a repeated provider id keeps the spend row, because the cap guards money', async () => {
  // The unique index on provider_message_id is there so a replayed delivery
  // report cannot be applied twice. If a provider ever hands back an id we
  // already hold, the row must still be written: an uncounted send is a send
  // past the cap, and the cap is the only thing standing between a shop and a
  // bill it did not agree to.
  delete process.env.SMS_DAILY_CAP_PER_BUSINESS
  const duplicateId = `dup-${run}`
  const before = await withinCap(businessId, new Date())

  for (let i = 0; i < 2; i += 1) {
    await recordSend({
      businessId,
      kind: 'customer_order_status',
      provider: 'bulksms',
      toMasked: maskPhone(NUMBER),
      bodyChars: 777,
      status: 'ACCEPTED',
      providerMessageId: duplicateId,
      costCredits: 0.3,
    })
  }

  const after = await withinCap(businessId, new Date())
  assert.equal(after.used, before.used + 2, 'both charged sends must count against the allowance')

  const rows = await prisma.messageLog.findMany({
    where: { businessId, bodyChars: 777 },
    select: { providerMessageId: true, status: true },
    orderBy: { createdAt: 'asc' },
  })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].providerMessageId, duplicateId)
  // The id is dropped, not the row — so the report can still only ever match one.
  assert.equal(rows[1].providerMessageId, null)
  assert.deepEqual(
    rows.map((r) => r.status),
    ['ACCEPTED', 'ACCEPTED'],
  )

  const holdingTheId = await prisma.messageLog.count({ where: { providerMessageId: duplicateId } })
  assert.equal(holdingTheId, 1, 'exactly one row may hold a given provider id')
})
