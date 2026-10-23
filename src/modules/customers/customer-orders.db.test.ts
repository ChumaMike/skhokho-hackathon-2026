import test from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma/client'
import { resetTestDb, testDb } from '@/lib/testing/db'
import { __setEmailTransportForTests } from '@/lib/email'
import { __setMessageProviderForTests } from '@/lib/messaging/provider'
import { hashPassword } from '@/modules/auth/auth.service'
import { createBusiness } from '@/modules/tenant/tenant.service'
import { createProduct } from '@/modules/catalog/catalog.service'
import { createOptionGroup, createOption, assignOptionGroupToProduct } from '@/modules/catalog/menu-options.service'
import { createOrder, advanceOrderStatus } from '@/modules/orders/order.service'
import { registerCustomer } from './customer.service'
import { findMembershipForSession } from './customer-account.service'
import { cancelOrderAsCustomer, CustomerOrderError, listCustomerOrders } from './customer-orders.service'

/**
 * "My orders" scoping and self-service cancel against the real database:
 * a customer sees only their own orders at the shop they're signed in to,
 * reorder lines carry the chosen option ids, cancel works only while the
 * shop hasn't confirmed, and the merchant is told.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const emails: { to: string; subject: string }[] = []
const settle = () => new Promise((r) => setTimeout(r, 3000))

interface Shop { id: string; ownerEmail: string; productId: string; optionId: string }
let shopA: Shop
let shopB: Shop
const session = { type: 'customer' as const, channel: 'phone' as const, identifier: '+27821500001' }
const PHONE = '082 150 0001'
const OTHER_PHONE = '082 150 0002'

async function makeShop(label: string): Promise<Shop> {
  const ownerEmail = `orders-${label}-${run}@example.test`
  const { business } = await createBusiness({
    name: `Orders Shop ${label}`,
    category: 'FOOD_VENDOR' as never,
    owner: { firstName: 'Owner', lastName: label, email: ownerEmail, passwordHash: await hashPassword('SomePassword123') },
  })
  // As /api/platform/join does: the owner's AppUser is what the "new order" / "cancelled" emails go to.
  const owner = await prisma.appUser.create({ data: { email: ownerEmail, role: 'OWNER', passwordHash: await hashPassword('SomePassword123') }, select: { id: true } })
  await prisma.business.update({ where: { id: business.id }, data: { ownerUserId: owner.id } })
  const product = await createProduct(business.id, { name: `Kota ${label}`, price: 45 } as never)
  const group = await createOptionGroup(business.id, { name: 'Size', selectionType: 'SINGLE', minSelections: 0, maxSelections: 1 } as never)
  const option = await createOption(business.id, group.id, { name: 'Large', priceDelta: 10 } as never)
  await assignOptionGroupToProduct(business.id, product.id, group.id)
  return { id: business.id, ownerEmail, productId: product.id, optionId: option.id }
}

async function placeOrder(shop: Shop, phone: string, opts: { withOption?: boolean } = {}) {
  const reg = await registerCustomer(shop.id, phone, undefined, 'storefront_order')
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM memberships WHERE public_id = ${reg.public_id}::uuid LIMIT 1`
  const order = await createOrder(shop.id, {
    membershipId: rows[0].id,
    source: 'online',
    items: [
      {
        productId: shop.productId,
        name: 'Kota',
        quantity: 2,
        unitPrice: opts.withOption ? 55 : 45,
        discount: 0,
        options: opts.withOption ? [{ groupId: undefined, optionId: shop.optionId, groupName: 'Size', optionName: 'Large', priceDelta: 10 }] : [],
      },
    ],
    discount: 0,
    paymentStatus: 'PENDING',
    paymentMethod: 'CASH',
    fulfilmentMethod: 'COLLECTION',
    deliveryFee: 0,
    checkoutIdempotencyKey: `k-${run}-${Math.random().toString(36).slice(2)}`,
  })
  return order!
}

test.before(async () => {
  await resetTestDb()
  __setEmailTransportForTests(async (msg) => { emails.push({ to: msg.to, subject: msg.subject }); return { id: `m-${emails.length}` } })
  __setMessageProviderForTests(null)
  shopA = await makeShop('a')
  shopB = await makeShop('b')
})
test.after(async () => {
  __setEmailTransportForTests(null)
  __setMessageProviderForTests(undefined)
  await resetTestDb()
  await testDb.$disconnect()
})

test('a customer sees only their own orders at the shop they are signed in to', async () => {
  const mine = await placeOrder(shopA, PHONE, { withOption: true })
  await placeOrder(shopA, OTHER_PHONE)
  const elsewhere = await placeOrder(shopB, PHONE)

  const atA = await findMembershipForSession(shopA.id, session)
  const atB = await findMembershipForSession(shopB.id, session)
  assert.ok(atA && atB)

  const ordersA = await listCustomerOrders(shopA.id, atA.membershipId)
  assert.deepEqual(ordersA.map((o) => o.orderNumber), [mine.orderNumber], 'not the other customer, not the other shop')
  const view = ordersA[0]
  assert.equal(view.live, true)
  assert.equal(view.statusLabel, 'Sent to the shop')
  assert.equal(view.canCancel, true)
  assert.equal(view.totalFormatted, 'R 110.00')
  assert.equal(view.paymentLine, 'Pay when you collect')
  assert.equal(view.trackingPath, `/store/order/${mine.id}`)
  assert.equal(view.deliveryPageUrl, null, 'a collection order has no delivery page')
  assert.deepEqual(view.items, [{ name: 'Kota', quantity: 2, options: ['Large'] }])
  assert.deepEqual(view.reorderLines, [{ productId: shopA.productId, quantity: 2, optionIds: [shopA.optionId] }])
  assert.ok(!JSON.stringify(view).includes(atA.membershipId), 'the view carries no internal ids')

  const ordersB = await listCustomerOrders(shopB.id, atB.membershipId)
  assert.deepEqual(ordersB.map((o) => o.orderNumber), [elsewhere.orderNumber])
  assert.deepEqual(ordersB[0].reorderLines, [{ productId: shopB.productId, quantity: 2 }])

  // Scoping with the wrong membership (another shop's) yields nothing, even with the right business id.
  assert.deepEqual(await listCustomerOrders(shopA.id, atB.membershipId), [])
})

test('cancel works while PENDING with a reason the merchant can read, and refuses once the shop has confirmed', async () => {
  const atA = (await findMembershipForSession(shopA.id, session))!
  const order = await placeOrder(shopA, PHONE)
  emails.length = 0

  const result = await cancelOrderAsCustomer(shopA.id, atA.membershipId, order.id, 'TAKING_TOO_LONG', 'Need to leave for work')
  assert.equal(result.orderNumber, order.orderNumber)
  const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, notes: true } })
  assert.equal(after.status, 'CANCELLED')
  assert.ok(after.notes?.includes("It's taking too long") && after.notes.includes('Need to leave for work'), `reason on the order: ${after.notes}`)

  const notice = await prisma.businessNotification.findFirst({ where: { businessId: shopA.id, type: 'order_cancelled' }, orderBy: { createdAt: 'desc' } })
  assert.ok(notice?.message.includes(order.orderNumber) && notice.message.includes("It's taking too long"), `the merchant sees the reason on the dashboard: ${notice?.message}`)
  await settle()
  assert.ok(
    emails.some((m) => m.to === shopA.ownerEmail && m.subject.includes(order.orderNumber) && /cancelled by the customer/i.test(m.subject)),
    `and by email: ${JSON.stringify(emails)}`,
  )

  await assert.rejects(() => cancelOrderAsCustomer(shopA.id, atA.membershipId, order.id, 'OTHER'), (e: unknown) => e instanceof CustomerOrderError && e.code === 'TOO_LATE')

  const confirmed = await placeOrder(shopA, PHONE)
  await advanceOrderStatus(shopA.id, confirmed.id)
  await assert.rejects(
    () => cancelOrderAsCustomer(shopA.id, atA.membershipId, confirmed.id, 'CHANGED_MIND'),
    (e: unknown) => e instanceof CustomerOrderError && e.code === 'TOO_LATE' && /contact the shop/.test(e.message),
  )
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: confirmed.id } })).status, 'CONFIRMED')
  const views = await listCustomerOrders(shopA.id, atA.membershipId)
  assert.equal(views.find((v) => v.id === confirmed.id)?.canCancel, false)
  assert.equal(views.find((v) => v.id === order.id)?.statusLabel, 'Cancelled')
})

test("another customer's order at the same shop cannot be cancelled, and a bad reason is refused", async () => {
  const atA = (await findMembershipForSession(shopA.id, session))!
  const theirs = await placeOrder(shopA, OTHER_PHONE)
  await assert.rejects(() => cancelOrderAsCustomer(shopA.id, atA.membershipId, theirs.id, 'CHANGED_MIND'), (e: unknown) => e instanceof CustomerOrderError && e.code === 'NOT_FOUND')
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: theirs.id } })).status, 'PENDING')
  await assert.rejects(() => cancelOrderAsCustomer(shopA.id, atA.membershipId, theirs.id, 'HACK' as never), (e: unknown) => e instanceof CustomerOrderError && e.code === 'INVALID_REASON')
})
