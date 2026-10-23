import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { hashPassword } from "@/modules/auth/auth.service";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { setDeliverySettings } from "@/modules/tenant/capabilities";
import { inviteStaff } from "@/modules/staff/staff.service";
import { createOrder } from "@/modules/orders/order.service";
import { issueCustomerDeliveryKey } from "@/modules/skhokholetha/customer-key";
import { getCustomerDeliveryView } from "@/modules/skhokholetha/delivery.service";
import { assignDriver, markPickedUp, markDelivered, listMyDeliveries, listDeliveriesForManagement } from "./order-delivery.service";
import { DeliveryCodeError, MAX_CODE_FAILURES, dropoffCodeFor, rotateDropoffCode } from "./delivery-code";

/**
 * Proof of delivery for own drivers: the customer's page shows a code once a
 * driver is assigned; the driver can't mark delivered without it; wrong codes
 * count and lock; a manager can reissue, or complete with a recorded reason.
 */

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
let counter = 0;

async function makeBusiness(label: string) {
  const { business } = await createBusiness({
    name: `Delivery Code Test ${label}`,
    category: "FOOD_VENDOR",
    owner: { firstName: "Owner", lastName: label, email: `dc-owner-${label}-${suffix}@example.test`, passwordHash: await hashPassword("SomePassword123") },
  });
  await setDeliverySettings(business.id, { enabled: true, feeCents: 2000 });
  const product = await prisma.product.create({ data: { businessId: business.id, name: "Kota", price: 45, trackStock: false } });
  const { staff: driver } = await inviteStaff(business.id, { firstName: "Driver", lastName: label, email: `dc-driver-${label}-${suffix}-${counter++}@example.test`, preset: "DRIVER" });
  return { business, product, driver };
}

async function deliveryOrder(businessId: string, productId: string, withCustomerKey = true) {
  const order = await createOrder(businessId, {
    source: "online",
    items: [{ productId, name: "Kota", quantity: 1, unitPrice: 45, discount: 0 }],
    discount: 0,
    paymentStatus: "PAID",
    fulfilmentMethod: "DELIVERY",
    deliveryFee: 20,
    deliveryAddress: "12 Vilakazi Street, Orlando West",
    deliveryContactPhone: "0821234567",
  });
  await prisma.order.update({ where: { id: order!.id }, data: { status: "READY" } });
  const delivery = await prisma.orderDelivery.findUniqueOrThrow({ where: { orderId: order!.id } });
  const key = withCustomerKey ? await issueCustomerDeliveryKey(delivery.id) : null;
  return { order: order!, delivery, key };
}

test.after(async () => {
  const businesses = await prisma.business.findMany({ where: { name: { startsWith: "Delivery Code Test " } }, select: { id: true } });
  for (const { id } of businesses) {
    await prisma.orderDelivery.deleteMany({ where: { businessId: id } });
    await prisma.orderItem.deleteMany({ where: { order: { businessId: id } } });
    await prisma.order.deleteMany({ where: { businessId: id } });
    await prisma.product.deleteMany({ where: { businessId: id } });
    await prisma.businessNotification.deleteMany({ where: { businessId: id } });
    await prisma.businessStaff.deleteMany({ where: { businessId: id } });
    await prisma.businessRole.deleteMany({ where: { businessId: id } });
    await prisma.businessSubscription.deleteMany({ where: { businessId: id } });
    await prisma.business.delete({ where: { id } });
  }
  await prisma.appUser.deleteMany({ where: { email: { startsWith: "dc-owner-" } } });
});

test("assigning an own driver issues a code the customer's page shows and the driver must enter", async () => {
  const { business, product, driver } = await makeBusiness("flow");
  const { order, delivery, key } = await deliveryOrder(business.id, product.id);

  assert.equal(await prisma.orderDeliveryCode.findUnique({ where: { orderDeliveryId: delivery.id } }), null, "no code before assignment");
  await assignDriver(business.id, delivery.id, driver.id);
  const row = await prisma.orderDeliveryCode.findUniqueOrThrow({ where: { orderDeliveryId: delivery.id } });
  const code = dropoffCodeFor(delivery.id, row.nonce);
  assert.match(code, /^\d{6}$/);

  // The customer sees it on their own page; the business-facing views never carry it.
  const view = await getCustomerDeliveryView(key!);
  assert.equal(view?.ownDelivery?.dropoffCode, code);
  const mine = await listMyDeliveries(business.id, driver.id);
  assert.equal(mine[0]?.needsCode, true);
  assert.equal(JSON.stringify(mine).includes(code), false);
  assert.equal(JSON.stringify(await listDeliveriesForManagement(business.id)).includes(code), false);

  await markPickedUp(business.id, delivery.id);
  await assert.rejects(markDelivered(business.id, delivery.id, driver.id), (e: unknown) => e instanceof DeliveryCodeError && e.code === "CODE_REQUIRED");
  await assert.rejects(markDelivered(business.id, delivery.id, driver.id, { code: "000000" }), (e: unknown) => e instanceof DeliveryCodeError && e.code === "CODE_WRONG");
  assert.equal((await prisma.orderDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status, "PICKED_UP");

  const delivered = await markDelivered(business.id, delivery.id, driver.id, { code: `${code.slice(0, 3)} ${code.slice(3)}` });
  assert.equal(delivered.status, "DELIVERED");
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "COMPLETED");
  assert.ok((await prisma.orderDeliveryCode.findUniqueOrThrow({ where: { orderDeliveryId: delivery.id } })).confirmedAt);
  assert.equal((await getCustomerDeliveryView(key!))?.ownDelivery?.dropoffCode, null, "code disappears once delivered");
});

test("wrong codes lock after the limit; the manager reissues, and the new code works", async () => {
  const { business, product, driver } = await makeBusiness("lock");
  const { delivery, key } = await deliveryOrder(business.id, product.id);
  await assignDriver(business.id, delivery.id, driver.id);
  await markPickedUp(business.id, delivery.id);
  const before = (await prisma.orderDeliveryCode.findUniqueOrThrow({ where: { orderDeliveryId: delivery.id } })).nonce;

  for (let i = 0; i < MAX_CODE_FAILURES; i++) {
    await assert.rejects(markDelivered(business.id, delivery.id, driver.id, { code: "123456" }), /isn't right/);
  }
  await assert.rejects(markDelivered(business.id, delivery.id, driver.id, { code: dropoffCodeFor(delivery.id, before) }), (e: unknown) => e instanceof DeliveryCodeError && e.code === "CODE_LOCKED");
  assert.equal((await getCustomerDeliveryView(key!))?.ownDelivery?.dropoffCodeLocked, true);
  assert.equal((await listDeliveriesForManagement(business.id)).find((d) => d.id === delivery.id)?.codeLocked, true);

  await rotateDropoffCode(business.id, delivery.id);
  const after = (await prisma.orderDeliveryCode.findUniqueOrThrow({ where: { orderDeliveryId: delivery.id } })).nonce;
  assert.notEqual(after, before);
  await assert.rejects(markDelivered(business.id, delivery.id, driver.id, { code: dropoffCodeFor(delivery.id, before) }), /isn't right/);
  assert.equal((await markDelivered(business.id, delivery.id, driver.id, { code: dropoffCodeFor(delivery.id, after) })).status, "DELIVERED");
});

test("a manager may complete without the code only with a reason; an order with no customer page needs no code", async () => {
  const { business, product, driver } = await makeBusiness("override");
  const { delivery } = await deliveryOrder(business.id, product.id);
  await assignDriver(business.id, delivery.id, driver.id);
  await markPickedUp(business.id, delivery.id);
  await assert.rejects(markDelivered(business.id, delivery.id, driver.id, { override: { reason: "ok", byStaffId: "mgr" } }), /reason/);
  const done = await markDelivered(business.id, delivery.id, driver.id, { override: { reason: "Customer's phone was flat; handed over at the gate.", byStaffId: "mgr-1" } });
  assert.equal(done.status, "DELIVERED");
  const row = await prisma.orderDeliveryCode.findUniqueOrThrow({ where: { orderDeliveryId: delivery.id } });
  assert.equal(row.overrideByStaffId, "mgr-1");
  assert.match(row.overrideReason ?? "", /gate/);

  const legacy = await deliveryOrder(business.id, product.id, false);
  await assignDriver(business.id, legacy.delivery.id, driver.id);
  assert.equal(await prisma.orderDeliveryCode.findUnique({ where: { orderDeliveryId: legacy.delivery.id } }), null, "no customer page, no code");
  await markPickedUp(business.id, legacy.delivery.id);
  assert.equal((await markDelivered(business.id, legacy.delivery.id, driver.id)).status, "DELIVERED");
});
