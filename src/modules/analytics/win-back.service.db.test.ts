import test from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma/client'
import { resetTestDb } from '@/lib/testing/db'
import { hashPassword } from '@/modules/auth/auth.service'
import { createBusiness } from '@/modules/tenant/tenant.service'
import { registerCustomer } from '@/modules/customers/customer.service'
import { getWinBackList } from './win-back.service'

/**
 * The win-back list against the real database: whose orders are read, which
 * customers can be reached, and — the part that matters most — that nothing
 * identifying leaves the business's own pairwise view.
 *
 * Customers are created through the identity RPC, as the hard rules require.
 * Orders are inserted directly because these tests need past dates.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const TODAY = new Date('2026-10-22T09:00:00Z')
const DAY_MS = 86_400_000

const daysAgo = (days: number): string => new Date(TODAY.getTime() - days * DAY_MS).toISOString().slice(0, 10)

let shopId: string
let otherShopId: string
let orderSeq = 0

interface Member {
  publicId: string
  shortCode: string
  membershipId: string
}

async function makeShop(name: string, label: string): Promise<string> {
  const { business } = await createBusiness({
    name,
    category: 'FOOD_VENDOR' as never,
    owner: {
      firstName: 'Owner',
      lastName: label,
      email: `winback-${label}-${run}@example.test`,
      passwordHash: await hashPassword('SomePassword123'),
    },
  })
  return business.id
}

async function makeMember(businessId: string, phone: string, name?: string): Promise<Member> {
  const registration = await registerCustomer(businessId, phone, undefined, 'owner_dashboard')
  const rows = await prisma.$queryRaw<{ id: string; short_code: string }[]>`
    SELECT id, short_code FROM memberships WHERE public_id = ${registration.public_id}::uuid LIMIT 1`
  if (name) {
    await prisma.$executeRaw`UPDATE memberships SET display_name = ${name} WHERE id = ${rows[0]!.id}::uuid`
  }
  return { publicId: registration.public_id, shortCode: rows[0]!.short_code, membershipId: rows[0]!.id }
}

async function addOrder(
  businessId: string,
  membershipId: string | null,
  date: string,
  rands: number,
  opts: { paymentStatus?: 'PAID' | 'PENDING'; status?: 'COMPLETED' | 'CANCELLED'; deliveryPhone?: string } = {},
) {
  orderSeq += 1
  const order = await prisma.order.create({
    data: {
      businessId,
      membershipId,
      orderNumber: `WB-${run}-${orderSeq}`,
      status: opts.status ?? 'COMPLETED',
      paymentStatus: opts.paymentStatus ?? 'PAID',
      subtotal: rands,
      total: rands,
      fulfilmentMethod: opts.deliveryPhone ? 'DELIVERY' : 'COLLECTION',
      createdAt: new Date(`${date}T10:00:00Z`),
    },
    select: { id: true },
  })
  if (opts.deliveryPhone) {
    await prisma.orderDelivery.create({
      data: {
        businessId,
        orderId: order.id,
        contactPhone: opts.deliveryPhone,
        deliveryAddressSnapshot: '1 Main Road, Soweto',
      },
    })
  }
}

let weekly: Member
let lapsed: Member
let delivered: Member
let fresh: Member

test.before(async () => {
  await resetTestDb()
  shopId = await makeShop('Kota Tainment', 'a')
  otherShopId = await makeShop('Other Shop', 'b')

  // Orders every 7 days, last one 3 days ago — inside their rhythm.
  fresh = await makeMember(shopId, '082 170 1000', 'Lerato Dlamini')
  for (const days of [24, 17, 10, 3]) await addOrder(shopId, fresh.membershipId, daysAgo(days), 60)

  // Orders every 7 days, last one 30 days ago — overdue.
  weekly = await makeMember(shopId, '082 170 1001', 'Thandi Mokoena')
  for (const days of [51, 44, 37, 30]) await addOrder(shopId, weekly.membershipId, daysAgo(days), 100)

  // One order, long ago, and no name was ever taken.
  lapsed = await makeMember(shopId, '082 170 1002')
  await addOrder(shopId, lapsed.membershipId, daysAgo(80), 250)

  // Weekly, slipped, and left a mobile number on a delivery order.
  delivered = await makeMember(shopId, '082 170 1003', 'Sipho Ndlovu')
  for (const days of [40, 33, 26] as number[]) await addOrder(shopId, delivered.membershipId, daysAgo(days), 80)
  await addOrder(shopId, delivered.membershipId, daysAgo(19), 80, { deliveryPhone: '082 555 0100' })

  // Orders that must never count: unpaid and cancelled.
  await addOrder(shopId, weekly.membershipId, daysAgo(1), 999, { paymentStatus: 'PENDING' })
  await addOrder(shopId, weekly.membershipId, daysAgo(1), 999, { status: 'CANCELLED' })
})

test('a customer inside their own rhythm is not on the list, but is counted as considered', async () => {
  const list = await getWinBackList(shopId, { today: TODAY })
  assert.equal(list.consideredCount, 4)
  assert.equal(list.customers.find((row) => row.publicId === fresh.publicId), undefined)
})

test('an unpaid or cancelled order does not reset how long a customer has been away', async () => {
  const list = await getWinBackList(shopId, { today: TODAY })
  const row = list.customers.find((candidate) => candidate.publicId === weekly.publicId)
  assert.ok(row, 'the weekly customer should be on the list')
  // Their last PAID order was 30 days ago; yesterday's unpaid and cancelled
  // orders must not make them look like they just came in.
  assert.equal(row.daysSince, 30)
  assert.equal(row.orders, 4)
  assert.equal(row.spentDisplay, 'R 400.00')
  assert.equal(row.typicalGapDays, 7)
  // Thirty days is more than four of this customer's seven-day gaps, so they
  // read as gone rather than overdue — the bands are their own rhythm, not a
  // calendar month.
  assert.equal(row.status, 'gone')
})

test('the list shows the first name and short code, never the full name or a global id', async () => {
  const list = await getWinBackList(shopId, { today: TODAY })
  const row = list.customers.find((candidate) => candidate.publicId === weekly.publicId)!
  assert.equal(row.name, 'Thandi')
  assert.equal(row.shortCode, weekly.shortCode)

  const serialised = JSON.stringify(list)
  assert.equal(serialised.includes('Mokoena'), false)
  // The membership's internal row id and the global customer id are both
  // server-side only; only the pairwise public_id may travel.
  assert.equal(serialised.includes(weekly.membershipId), false)
  const globalIds = await prisma.$queryRaw<{ id: string }[]>`SELECT id::text FROM customers`
  for (const customer of globalIds) assert.equal(serialised.includes(customer.id), false)
})

test('a customer with no name is shown by short code', async () => {
  const list = await getWinBackList(shopId, { today: TODAY })
  const row = list.customers.find((candidate) => candidate.publicId === lapsed.publicId)!
  assert.equal(row.name, row.shortCode)
  assert.equal(row.orders, 1)
  assert.equal(row.typicalGapDays, null)
})

test('a WhatsApp link appears only when contact numbers are allowed AND one was left', async () => {
  const withNumbers = await getWinBackList(shopId, { today: TODAY, includeContactNumbers: true })
  const sipho = withNumbers.customers.find((row) => row.publicId === delivered.publicId)!
  assert.ok(sipho.whatsappUrl?.startsWith('https://wa.me/27825550100?text='))
  assert.match(decodeURIComponent(sipho.whatsappUrl!), /Hi Sipho, it's Kota Tainment\./)
  // The collection-only customers have no number to use.
  const thandi = withNumbers.customers.find((row) => row.publicId === weekly.publicId)!
  assert.equal(thandi.whatsappUrl, null)
  assert.match(thandi.contactNote!, /No contact number on file/)

  // And with the permission withheld, no number is even read.
  const withoutNumbers = await getWinBackList(shopId, { today: TODAY, includeContactNumbers: false })
  for (const row of withoutNumbers.customers) assert.equal(row.whatsappUrl, null)
  assert.equal(JSON.stringify(withoutNumbers).includes('27825550100'), false)
  assert.equal(JSON.stringify(withoutNumbers).includes('0825550100'), false)
})

test("one business never sees another's customers", async () => {
  const theirs = await makeMember(otherShopId, '082 170 2000', 'Zanele Khumalo')
  await addOrder(otherShopId, theirs.membershipId, daysAgo(60), 500)

  const mine = await getWinBackList(shopId, { today: TODAY })
  assert.equal(mine.customers.find((row) => row.publicId === theirs.publicId), undefined)
  assert.equal(JSON.stringify(mine).includes('Zanele'), false)
  assert.equal(JSON.stringify(mine).includes(theirs.shortCode), false)

  const list = await getWinBackList(otherShopId, { today: TODAY })
  assert.deepEqual(list.customers.map((row) => row.publicId), [theirs.publicId])
})

test('the message names this business, not the platform', async () => {
  const list = await getWinBackList(shopId, { today: TODAY, includeContactNumbers: true })
  const sipho = list.customers.find((row) => row.publicId === delivered.publicId)!
  const message = decodeURIComponent(sipho.whatsappUrl!.split('?text=')[1]!)
  assert.match(message, /Kota Tainment/)
  assert.equal(message.includes('Skhokho'), false)
})

test('a business whose customers have never paid gets an empty list, not an error', async () => {
  const quiet = await makeShop('Quiet Shop', 'c')
  const member = await makeMember(quiet, '082 170 3000', 'Nobody Yet')
  await addOrder(quiet, member.membershipId, daysAgo(40), 100, { paymentStatus: 'PENDING' })
  const list = await getWinBackList(quiet, { today: TODAY })
  assert.equal(list.consideredCount, 0)
  assert.deepEqual(list.customers, [])
  assert.equal(list.businessGapDays, null)
})
