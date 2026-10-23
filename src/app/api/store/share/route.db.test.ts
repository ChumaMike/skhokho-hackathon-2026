import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { resetTestDb, testDb } from '@/lib/testing/db'
import { clearHostnameCache } from '@/lib/tenant/context'
import { POST } from './route'

/**
 * Counting a share: the product's number and the day's counter both move,
 * only for this shop's own live product, with nothing about the sharer
 * received or kept — and the answer is always 204.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const HOST = 'skhokho.sgdataint.co.za'
let shopA: string
let shopB: string
let liveA: string
let hiddenA: string
let liveB: string

function post(body: unknown) {
  return POST(
    new NextRequest(`https://${HOST}/api/store/share`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { host: HOST, 'content-type': 'application/json', 'x-forwarded-for': `10.4.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
    }),
  )
}

async function shareCount(id: string) {
  return (await prisma.product.findUniqueOrThrow({ where: { id }, select: { shareCount: true } })).shareCount
}

async function dayCount(businessId: string, itemId: string) {
  const rows = await prisma.storefrontDailyStat.findMany({ where: { businessId, event: 'PRODUCT_SHARE', itemId }, select: { count: true, page: true, device: true } })
  return { total: rows.reduce((n, r) => n + r.count, 0), rows }
}

test.before(async () => {
  await resetTestDb()
  shopA = (await prisma.business.create({ data: { name: 'Share Kota', slug: `share-a-${run}`, status: 'ACTIVE' }, select: { id: true } })).id
  shopB = (await prisma.business.create({ data: { name: 'Share Braids', slug: `share-b-${run}`, status: 'ACTIVE' }, select: { id: true } })).id
  liveA = (await prisma.product.create({ data: { businessId: shopA, name: 'Kota', price: 45 }, select: { id: true } })).id
  hiddenA = (await prisma.product.create({ data: { businessId: shopA, name: 'Gone', price: 45, isActive: false }, select: { id: true } })).id
  liveB = (await prisma.product.create({ data: { businessId: shopB, name: 'Braids', price: 300 }, select: { id: true } })).id
})
test.beforeEach(clearHostnameCache)
test.after(async () => {
  await resetTestDb()
  await testDb.$disconnect()
})

test('each completed share adds one to the product and one to the day, with no identity attached', async () => {
  assert.equal((await post({ businessId: shopA, productId: liveA })).status, 204)
  assert.equal((await post({ businessId: shopA, productId: liveA })).status, 204)
  assert.equal(await shareCount(liveA), 2)
  const day = await dayCount(shopA, liveA)
  assert.equal(day.total, 2)
  assert.ok(day.rows.every((r) => r.page === 'PRODUCT' && r.device === ''), 'a product-page counter, no device class, nothing else')
})

test("a hidden product, another shop's product, a made-up one and a malformed body count nothing — and still get 204", async () => {
  for (const body of [
    { businessId: shopA, productId: hiddenA },
    { businessId: shopA, productId: liveB },
    { businessId: shopA, productId: 'no-such-product' },
    { businessId: 'not-a-uuid', productId: liveA },
    { businessId: shopA, productId: liveA, who: 'me' },
    'not json',
  ]) {
    assert.equal((await post(body)).status, 204)
  }
  assert.equal(await shareCount(hiddenA), 0)
  assert.equal(await shareCount(liveB), 0)
  assert.equal(await shareCount(liveA), 2, 'the strict body with an extra field was refused')
  assert.equal((await dayCount(shopA, hiddenA)).total, 0)
  assert.equal((await dayCount(shopB, liveB)).total, 0)
})
