import test from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma/client'
import { resetTestDb, testDb } from '@/lib/testing/db'
import { __setMessageProviderForTests, type OutboundMessage } from '@/lib/messaging/provider'
import { __setEmailTransportForTests } from '@/lib/email'
import { CODE_TTL_MS, MAX_CODE_ATTEMPTS, hashLoginCode, issueLoginCode, purgeExpiredLoginCodes, verifyLoginCode } from './customer-auth.service'
import { findMembershipForSession, listMembershipsAcrossBusinesses } from './customer-account.service'
import { registerCustomer } from './customer.service'
import { verifyToken } from '@/modules/auth/auth.service'

/**
 * Phone-first sign-in against the real test database: codes are stored
 * hashed, used once, locked after wrong tries, and the resulting session
 * resolves a DIFFERENT pairwise membership at each business without ever
 * surfacing the global customer id.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const texts: OutboundMessage[] = []
const emails: { to: string; subject: string; text?: string }[] = []
const codeIn = (s: string) => /\b(\d{6})\b/.exec(s)![1]

test.before(async () => {
  await resetTestDb()
  process.env.JWT_SECRET ??= 'test-secret-that-is-at-least-32-characters-long'
  __setMessageProviderForTests({ name: 'test', async send(m) { texts.push(m); return { accepted: true, providerId: 'x' } } })
  __setEmailTransportForTests(async (msg) => { emails.push({ to: msg.to, subject: msg.subject, text: msg.text }); return { id: `m-${emails.length}` } })
})
test.after(async () => {
  __setMessageProviderForTests(undefined)
  __setEmailTransportForTests(null)
  await resetTestDb()
  await testDb.$disconnect()
})

const PHONE = { channel: 'phone' as const, identifier: '+27821000001' }

test('a code goes to the phone, is stored only as a hash, and signs the customer in exactly once', async () => {
  const issued = await issueLoginCode(PHONE, { shopName: 'Kota Kings', ip: '10.0.0.1' })
  assert.equal(issued.delivery, 'phone')
  const code = codeIn(texts.at(-1)!.text)
  assert.ok(texts.at(-1)!.text.includes('Kota Kings'))

  const row = await prisma.customerLoginCode.findFirstOrThrow({ where: { identifier: PHONE.identifier }, orderBy: { createdAt: 'desc' } })
  assert.notEqual(row.codeHash, code)
  assert.equal(row.codeHash, hashLoginCode(row.id, code))
  assert.ok(row.expiresAt.getTime() - Date.now() <= CODE_TTL_MS)

  const wrong = await verifyLoginCode(PHONE, '000000')
  assert.deepEqual(wrong, { ok: false, reason: 'INVALID' })
  assert.equal((await prisma.customerLoginCode.findUniqueOrThrow({ where: { id: row.id } })).attempts, 1)

  const right = await verifyLoginCode(PHONE, code, { ip: '10.0.0.1' })
  assert.ok(right.ok)
  const payload = await verifyToken(right.token)
  assert.deepEqual(payload, { type: 'customer', channel: 'phone', identifier: PHONE.identifier })

  const again = await verifyLoginCode(PHONE, code)
  assert.deepEqual(again, { ok: false, reason: 'NONE' }, 'a code is consumed on success')

  const audit = await prisma.auditLog.findMany({ where: { actorType: 'customer', action: { in: ['login_code_issued', 'customer_login'] } } })
  assert.equal(audit.length, 2)
  assert.ok(audit.every((a) => a.objectId === '001'), 'the audit row carries three digits, never the number')
})

test('five wrong tries lock the code; an expired code is refused; a newer code supersedes an older one', async () => {
  const id = { channel: 'phone' as const, identifier: '+27821000002' }
  await issueLoginCode(id)
  const first = codeIn(texts.at(-1)!.text)
  for (let i = 0; i < MAX_CODE_ATTEMPTS - 1; i++) assert.equal((await verifyLoginCode(id, '111111')).ok, false)
  assert.deepEqual(await verifyLoginCode(id, '111111'), { ok: false, reason: 'LOCKED' })
  assert.deepEqual(await verifyLoginCode(id, first), { ok: false, reason: 'LOCKED' }, 'even the right code no longer works')

  await issueLoginCode(id)
  const second = codeIn(texts.at(-1)!.text)
  await prisma.customerLoginCode.updateMany({ where: { identifier: id.identifier, consumedAt: null, attempts: 0 }, data: { expiresAt: new Date(Date.now() - 1000) } })
  assert.deepEqual(await verifyLoginCode(id, second), { ok: false, reason: 'EXPIRED' })

  await issueLoginCode(id)
  const third = codeIn(texts.at(-1)!.text)
  assert.equal((await verifyLoginCode(id, second)).ok, false, 'the older code is not the current one')
  assert.equal((await verifyLoginCode(id, third)).ok, true)

  const purged = await purgeExpiredLoginCodes(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000))
  assert.ok(purged >= 3)
})

test('email is the fallback channel, and with no phone provider a phone request sends nothing and leaves no live code', async (t) => {
  const email = { channel: 'email' as const, identifier: `thandi-${run}@example.test` }
  const issued = await issueLoginCode(email, { shopName: 'Braids by B' })
  assert.equal(issued.delivery, 'email')
  const mail = emails.at(-1)!
  assert.equal(mail.to, email.identifier)
  const code = codeIn(mail.text!)
  const ok = await verifyLoginCode(email, code)
  assert.ok(ok.ok && ok.session.channel === 'email')

  __setMessageProviderForTests(null)
  t.after(() => __setMessageProviderForTests({ name: 'test', async send(m) { texts.push(m); return { accepted: true } } }))
  const none = await issueLoginCode({ channel: 'phone', identifier: '+27821000003' })
  assert.equal(none.delivery, 'none')
  assert.equal(await prisma.customerLoginCode.count({ where: { identifier: '+27821000003', consumedAt: null } }), 0)

  // A provider that accepts nothing: the row is closed so the unsent code can't be guessed later.
  __setMessageProviderForTests({ name: 'down', async send() { return { accepted: false, errorName: 'down' } } })
  const failed = await issueLoginCode({ channel: 'phone', identifier: '+27821000004' })
  assert.equal(failed.delivery, 'none')
  assert.equal(await prisma.customerLoginCode.count({ where: { identifier: '+27821000004', consumedAt: null } }), 0)
})

test('one verified phone resolves a different pairwise membership at each shop, and never the global customer id', async (t) => {
  const a = await prisma.business.create({ data: { name: 'Shop A', slug: `acct-a-${run}`, status: 'ACTIVE' }, select: { id: true } })
  const b = await prisma.business.create({ data: { name: 'Shop B', slug: `acct-b-${run}`, status: 'ACTIVE' }, select: { id: true } })
  const c = await prisma.business.create({ data: { name: 'Shop C', slug: `acct-c-${run}`, status: 'ACTIVE' }, select: { id: true } })
  const phone = '082 100 0005'
  const regA = await registerCustomer(a.id, phone, 'Thandi', 'storefront_order')
  const regB = await registerCustomer(b.id, phone, undefined, 'customer_registration')
  const session = { type: 'customer' as const, channel: 'phone' as const, identifier: '+27821000005' }

  const atA = await findMembershipForSession(a.id, session)
  const atB = await findMembershipForSession(b.id, session)
  const atC = await findMembershipForSession(c.id, session)
  assert.equal(atA?.publicId, regA.public_id)
  assert.equal(atA?.shortCode, regA.short_code)
  assert.equal(atA?.displayName, 'Thandi')
  assert.equal(atB?.publicId, regB.public_id)
  assert.notEqual(atA?.publicId, atB?.publicId, 'pairwise: a shop can never correlate the two')
  assert.equal(atC, null, 'no membership where the customer never dealt with the shop')
  for (const m of [atA!, atB!]) {
    assert.deepEqual(Object.keys(m).sort(), ['displayName', 'membershipId', 'publicId', 'shortCode'])
  }
  const customerIds = await prisma.$queryRaw<{ customer_id: string }[]>`SELECT DISTINCT customer_id FROM memberships WHERE business_id IN (${a.id}::uuid, ${b.id}::uuid)`
  assert.equal(customerIds.length, 2, 'two separate customers rows — the verified session links nothing')

  // The "all my shops" view stays dark until the s57 flag is on.
  const original = process.env.CROSS_BUSINESS_LINKING_ENABLED
  t.after(() => {
    if (original === undefined) delete process.env.CROSS_BUSINESS_LINKING_ENABLED
    else process.env.CROSS_BUSINESS_LINKING_ENABLED = original
  })
  delete process.env.CROSS_BUSINESS_LINKING_ENABLED
  await assert.rejects(() => listMembershipsAcrossBusinesses(session), /not available yet/)
  process.env.CROSS_BUSINESS_LINKING_ENABLED = 'true'
  const all = await listMembershipsAcrossBusinesses(session)
  assert.deepEqual(all.map((m) => m.businessName).sort(), ['Shop A', 'Shop B'])
  assert.ok(all.every((m) => !('customerId' in m)))
})
