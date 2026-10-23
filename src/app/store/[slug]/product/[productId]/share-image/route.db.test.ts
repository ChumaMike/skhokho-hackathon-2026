import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { resetTestDb, testDb } from '@/lib/testing/db'
import { SHARE_IMAGE_HEIGHT, SHARE_IMAGE_WIDTH } from '@/lib/storefront/share'
import { GET } from './route'

/**
 * The composed share card: a real PNG of the right size for a live product,
 * nothing at all for a product that is hidden, from another shop, or made up.
 * Rendered without a photo or logo here (no network in tests) — the branch
 * with remote images is the same tree with an <img> in place of the initial.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
let slug: string
let liveId: string
let hiddenId: string

function get(forSlug: string, productId: string) {
  return GET(new NextRequest(`https://skhokho.sgdataint.co.za/store/${forSlug}/product/${productId}/share-image`, { headers: { 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 250)}.7` } }), {
    params: Promise.resolve({ slug: forSlug, productId }),
  })
}

test.before(async () => {
  await resetTestDb()
  slug = `share-img-${run}`
  const business = await prisma.business.create({ data: { name: 'Kota-Tainment', slug, status: 'ACTIVE', primaryColor: '#E8A020' }, select: { id: true } })
  liveId = (await prisma.product.create({ data: { businessId: business.id, name: 'Kasi Kota with everything on it', price: 1234.5, hashtags: ['kota', 'soweto'] }, select: { id: true } })).id
  hiddenId = (await prisma.product.create({ data: { businessId: business.id, name: 'Old special', price: 10, isActive: false }, select: { id: true } })).id
})
test.after(async () => {
  await resetTestDb()
  await testDb.$disconnect()
})

test('a live product gets a 1200×630 PNG, cached for a day', async () => {
  const res = await get(slug, liveId)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/png')
  assert.match(res.headers.get('cache-control') ?? '', /max-age=86400/)
  const bytes = new Uint8Array(await res.arrayBuffer())
  assert.deepEqual([...bytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature')
  // IHDR: width and height are the first two big-endian 32-bit fields after the chunk header.
  const view = new DataView(bytes.buffer, bytes.byteOffset)
  assert.equal(view.getUint32(16), SHARE_IMAGE_WIDTH)
  assert.equal(view.getUint32(20), SHARE_IMAGE_HEIGHT)
})

test('a hidden product, an unknown product and an unknown shop are plain 404s', async () => {
  assert.equal((await get(slug, hiddenId)).status, 404)
  assert.equal((await get(slug, 'nope-not-a-product')).status, 404)
  assert.equal((await get(`no-such-shop-${run}`, liveId)).status, 404)
})
