import test from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma/client'
import { resetTestDb, testDb } from '@/lib/testing/db'
import { registerCustomer, logVisit, redeemReward } from './customer.service'
import { findMembershipForSession, getRewardsCard, joinRewards, listMembershipsAcrossBusinesses } from './customer-account.service'

/**
 * The per-business rewards card from the customer's side: joining records
 * Consent 1 and nothing else, stamps and redeems derive from the ledger the
 * owner already stamps, and nothing crosses businesses unless the s57 flag
 * is on.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const session = { type: 'customer' as const, channel: 'phone' as const, identifier: '+27821700001' }
let shopA: string
let shopB: string

async function customerIdAt(businessId: string) {
  const rows = await prisma.$queryRaw<{ customer_id: string }[]>`
    SELECT m.customer_id FROM memberships m JOIN customer_identifiers ci ON ci.customer_id = m.customer_id
    WHERE m.business_id = ${businessId}::uuid AND ci.type = 'phone' AND ci.value = ${session.identifier} LIMIT 1`
  return rows[0]?.customer_id ?? null
}

test.before(async () => {
  await resetTestDb()
  shopA = (await prisma.business.create({ data: { name: 'Rewards Kota', slug: `rewards-a-${run}`, status: 'ACTIVE', config: { loyalty_stamps_required: 3 } }, select: { id: true } })).id
  shopB = (await prisma.business.create({ data: { name: 'Rewards Braids', slug: `rewards-b-${run}`, status: 'ACTIVE' }, select: { id: true } })).id
})
test.after(async () => {
  await resetTestDb()
  await testDb.$disconnect()
})

test('joining from the account records Consent 1 only, and an email-only session cannot join', async () => {
  assert.equal(await findMembershipForSession(shopA, session), null)
  const membership = await joinRewards(shopA, session, '10.0.0.9')
  assert.match(membership.shortCode, /^[0-9A-Z]{3}-[0-9A-Z]{4}$/)
  const cid = await customerIdAt(shopA)
  assert.ok(cid)
  const purposes = (await prisma.consent.findMany({ where: { customerId: cid! }, select: { purpose: true, businessId: true } })).map((c) => `${c.purpose}@${c.businessId === shopA ? 'A' : 'platform'}`)
  assert.deepEqual(purposes, ['loyalty_program@A'], 'no marketing, no cross-business link')
  assert.equal(await prisma.customerIdentifier.count({ where: { customerId: cid!, type: 'email' } }), 0)

  // Joining twice is the same card (find-or-create), not a second one.
  const again = await joinRewards(shopA, session)
  assert.equal(again.publicId, membership.publicId)

  await assert.rejects(() => joinRewards(shopB, { type: 'customer', channel: 'email', identifier: `e-${run}@example.test` }), /phone number/)
  assert.equal(await findMembershipForSession(shopB, session), null, 'shop B is untouched')
})

test('the card shows the current round of stamps, the reward when full, and resets after a redeem', async () => {
  const membership = (await findMembershipForSession(shopA, session))!
  assert.deepEqual(await getRewardsCard(shopA, membership), { shortCode: membership.shortCode, stamps: 0, redeems: 0, required: 3, progress: 0, rewardReady: false })

  await logVisit(shopA, membership.publicId, 'stamp')
  await logVisit(shopA, membership.publicId, 'stamp')
  let card = await getRewardsCard(shopA, membership)
  assert.equal(card.progress, 2)
  assert.equal(card.rewardReady, false)

  await logVisit(shopA, membership.publicId, 'stamp')
  card = await getRewardsCard(shopA, membership)
  assert.equal(card.progress, 3)
  assert.equal(card.rewardReady, true)

  await redeemReward(shopA, membership.publicId)
  card = await getRewardsCard(shopA, membership)
  assert.deepEqual({ stamps: card.stamps, redeems: card.redeems, progress: card.progress, ready: card.rewardReady }, { stamps: 3, redeems: 1, progress: 0, ready: false })

  // Someone who ordered at the shop before signing in already has a card (register_customer at checkout).
  const walkIn = await registerCustomer(shopB, '082 170 0001', 'Thandi', 'storefront_order')
  const atB = (await findMembershipForSession(shopB, session))!
  assert.equal(atB.publicId, walkIn.public_id)
  const cardB = await getRewardsCard(shopB, atB)
  assert.equal(cardB.required, 10, 'the default threshold when the shop never set one')
  assert.equal(cardB.progress, 0)
})

test('one shop never sees the other, and the all-my-shops view needs the s57 flag', async (t) => {
  const original = process.env.CROSS_BUSINESS_LINKING_ENABLED
  t.after(() => {
    if (original === undefined) delete process.env.CROSS_BUSINESS_LINKING_ENABLED
    else process.env.CROSS_BUSINESS_LINKING_ENABLED = original
  })
  const atA = (await findMembershipForSession(shopA, session))!
  const atB = (await findMembershipForSession(shopB, session))!
  assert.notEqual(atA.publicId, atB.publicId)
  assert.notEqual(await customerIdAt(shopA), await customerIdAt(shopB), 'two customers rows: nothing linked')

  delete process.env.CROSS_BUSINESS_LINKING_ENABLED
  await assert.rejects(() => listMembershipsAcrossBusinesses(session), /not available yet/)
  process.env.CROSS_BUSINESS_LINKING_ENABLED = 'true'
  const all = await listMembershipsAcrossBusinesses(session)
  assert.deepEqual(all.map((m) => [m.businessName, m.stamps, m.redeems, m.required]).sort(), [['Rewards Braids', 0, 0, 10], ['Rewards Kota', 3, 1, 3]])
})
