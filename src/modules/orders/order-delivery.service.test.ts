import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { hashPassword } from "@/modules/auth/auth.service";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { setDeliverySettings } from "@/modules/tenant/capabilities";
import { inviteStaff } from "@/modules/staff/staff.service";
import { createOrder } from "@/modules/orders/order.service";
import {
  canActOnDelivery,
  assignDriver,
  markPickedUp,
  markDelivered,
  reportFailure,
  recordDriverLocation,
  getDeliveryForActorCheck,
  listMyDeliveries,
  listMyCompletedDeliveries,
} from "@/modules/orders/order-delivery.service";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let counter = 0;

async function makeDeliveryBusiness(label: string) {
  const { business } = await createBusiness({
    name: `Delivery Test ${label}`,
    category: "FOOD_VENDOR",
    owner: {
      firstName: "Owner",
      lastName: label,
      email: `delivery-owner-${label}-${suffix}@example.test`,
      passwordHash: await hashPassword("SomePassword123"),
    },
  });
  await setDeliverySettings(business.id, { enabled: true, feeCents: 2000, areaInfo: "Orlando area" });
  const product = await prisma.product.create({
    data: { businessId: business.id, name: "Kota", price: 45 },
  });
  // completeDeliveredOrder deducts stock the same way completeOrder always
  // has — Product.trackStock defaults true, so adjustStock requires a real
  // InventoryItem row to exist (same fixture pattern tenant-isolation.test.ts
  // already uses for the identical reason).
  await prisma.inventoryItem.create({
    data: { businessId: business.id, productId: product.id, quantity: 20 },
  });
  return { business, product };
}

async function inviteDriver(businessId: string, label: string) {
  const { staff } = await inviteStaff(businessId, {
    firstName: "Driver",
    lastName: label,
    email: `driver-${label}-${suffix}-${counter++}@example.test`,
    preset: "DRIVER",
  });
  return staff;
}

async function inviteManager(businessId: string, label: string) {
  const { staff } = await inviteStaff(businessId, {
    firstName: "Manager",
    lastName: label,
    email: `manager-${label}-${suffix}-${counter++}@example.test`,
    preset: "MANAGER",
  });
  return staff;
}

async function makeDeliveryOrder(businessId: string, productId: string, opts: { address?: string } = {}) {
  const order = await createOrder(businessId, {
    source: "online",
    items: [{ productId, name: "Kota", quantity: 1, unitPrice: 45, discount: 0 }],
    discount: 0,
    paymentStatus: "PENDING",
    fulfilmentMethod: "DELIVERY",
    deliveryFee: 20,
    deliveryAddress: opts.address ?? "123 Test Street, Orlando West",
    deliveryInstructions: "Blue gate",
    deliveryContactPhone: "0821234567",
  });
  const delivery = await prisma.orderDelivery.findUniqueOrThrow({ where: { orderId: order!.id } });
  return { order: order!, delivery };
}

test.after(async () => {
  const businesses = await prisma.business.findMany({
    where: { name: { startsWith: "Delivery Test " } },
    select: { id: true },
  });
  for (const { id } of businesses) {
    await prisma.orderDelivery.deleteMany({ where: { businessId: id } });
    await prisma.orderItem.deleteMany({ where: { order: { businessId: id } } });
    await prisma.order.deleteMany({ where: { businessId: id } });
    await prisma.stockMovement.deleteMany({ where: { inventoryItem: { businessId: id } } });
    await prisma.inventoryItem.deleteMany({ where: { businessId: id } });
    await prisma.product.deleteMany({ where: { businessId: id } });
    await prisma.businessStaff.deleteMany({ where: { businessId: id } });
    await prisma.businessRole.deleteMany({ where: { businessId: id } });
    await prisma.businessSubscription.deleteMany({ where: { businessId: id } });
    await prisma.business.delete({ where: { id } });
  }
});

// ---------------------------------------------------------------------------
// Schema / creation
// ---------------------------------------------------------------------------

test("a COLLECTION order creates no OrderDelivery", async () => {
  const { business, product } = await makeDeliveryBusiness("collection-no-row");
  const order = await createOrder(business.id, {
    source: "online",
    items: [{ productId: product.id, name: "Kota", quantity: 1, unitPrice: 45, discount: 0 }],
    discount: 0,
    paymentStatus: "PENDING",
    fulfilmentMethod: "COLLECTION",
    deliveryFee: 0,
  });
  const delivery = await prisma.orderDelivery.findUnique({ where: { orderId: order!.id } });
  assert.equal(delivery, null);
  assert.equal(order!.fulfilmentMethod, "COLLECTION");
  assert.equal(Number(order!.deliveryFee), 0);
});

test("a DELIVERY order requires an address — createOrder rejects an empty one", async () => {
  const { business, product } = await makeDeliveryBusiness("requires-address");
  await assert.rejects(
    createOrder(business.id, {
      source: "online",
      items: [{ productId: product.id, name: "Kota", quantity: 1, unitPrice: 45, discount: 0 }],
      discount: 0,
      paymentStatus: "PENDING",
      fulfilmentMethod: "DELIVERY",
      deliveryFee: 20,
    }),
  );
});

test("a DELIVERY order snapshots the address, instructions, and contact phone", async () => {
  const { business, product } = await makeDeliveryBusiness("snapshots-address");
  const { delivery } = await makeDeliveryOrder(business.id, product.id, { address: "456 Snapshot Ave" });
  assert.equal(delivery.deliveryAddressSnapshot, "456 Snapshot Ave");
  assert.equal(delivery.deliveryInstructions, "Blue gate");
  assert.equal(delivery.contactPhone, "0821234567");
  assert.equal(delivery.status, "UNASSIGNED");
});

test("a DELIVERY order creates exactly one OrderDelivery", async () => {
  const { business, product } = await makeDeliveryBusiness("exactly-one");
  const { order } = await makeDeliveryOrder(business.id, product.id);
  const count = await prisma.orderDelivery.count({ where: { orderId: order.id } });
  assert.equal(count, 1);
});

test("the delivery fee is server-authoritative and included in the total exactly once", async () => {
  const { business, product } = await makeDeliveryBusiness("fee-authoritative");
  const { order } = await makeDeliveryOrder(business.id, product.id);
  // subtotal 45 + deliveryFee 20 - discount 0 = 65
  assert.equal(Number(order.deliveryFee), 20);
  assert.equal(Number(order.total), 65);
});

test("a historical order's delivery fee is unaffected by a later change to the business's configured fee", async () => {
  const { business, product } = await makeDeliveryBusiness("fee-frozen");
  const { order } = await makeDeliveryOrder(business.id, product.id);
  assert.equal(Number(order.total), 65);

  await setDeliverySettings(business.id, { enabled: true, feeCents: 5000 });

  const reloaded = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(Number(reloaded.total), 65, "the historical order's total must not change");
  assert.equal(Number(reloaded.deliveryFee), 20);
});

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

test("only a READY order can be dispatched", async () => {
  const { business, product } = await makeDeliveryBusiness("only-ready");
  const { delivery } = await makeDeliveryOrder(business.id, product.id);
  const driver = await inviteDriver(business.id, "ready-check");
  // Order is still PENDING at this point — never advanced to READY.
  await assert.rejects(assignDriver(business.id, delivery.id, driver.id));
});

test("a manager can assign a driver to an UNASSIGNED delivery once the order is READY", async () => {
  const { business, product } = await makeDeliveryBusiness("assign-ready");
  const { order, delivery } = await makeDeliveryOrder(business.id, product.id);
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const driver = await inviteDriver(business.id, "assign-ready");

  const updated = await assignDriver(business.id, delivery.id, driver.id);
  assert.equal(updated.status, "ASSIGNED");
  assert.equal(updated.driverStaffId, driver.id);
  assert.ok(updated.assignedAt);
});

test("assigning a driver without canPerformDeliveries is rejected", async () => {
  const { business, product } = await makeDeliveryBusiness("ineligible-driver");
  const { order, delivery } = await makeDeliveryOrder(business.id, product.id);
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const notADriver = await inviteManager(business.id, "not-a-driver");

  await assert.rejects(assignDriver(business.id, delivery.id, notADriver.id), /isn't eligible/);
});

test("reassignment is allowed before pickup (UNASSIGNED or ASSIGNED)", async () => {
  const { business, product } = await makeDeliveryBusiness("reassign-before");
  const { order, delivery } = await makeDeliveryOrder(business.id, product.id);
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const driverA = await inviteDriver(business.id, "reassign-a");
  const driverB = await inviteDriver(business.id, "reassign-b");

  await assignDriver(business.id, delivery.id, driverA.id);
  const reassigned = await assignDriver(business.id, delivery.id, driverB.id);
  assert.equal(reassigned.driverStaffId, driverB.id);
});

test("reassignment is blocked once the delivery has been picked up", async () => {
  const { business, product } = await makeDeliveryBusiness("reassign-blocked");
  const { order, delivery } = await makeDeliveryOrder(business.id, product.id);
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const driverA = await inviteDriver(business.id, "blocked-a");
  const driverB = await inviteDriver(business.id, "blocked-b");

  await assignDriver(business.id, delivery.id, driverA.id);
  await markPickedUp(business.id, delivery.id);

  await assert.rejects(assignDriver(business.id, delivery.id, driverB.id), /Cannot assign/);
});

test("the assigned driver can mark PICKED_UP; a different driver cannot", async () => {
  const { business, product } = await makeDeliveryBusiness("pickup-authz");
  const { order, delivery } = await makeDeliveryOrder(business.id, product.id);
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const driverA = await inviteDriver(business.id, "pickup-a");
  const driverB = await inviteDriver(business.id, "pickup-b");
  await assignDriver(business.id, delivery.id, driverA.id);

  const fresh = await getDeliveryForActorCheck(business.id, delivery.id);
  assert.equal(
    canActOnDelivery({ isOwner: false, staffId: driverB.id, canPerformDeliveries: true, canManageDeliveries: false }, fresh!),
    false,
    "a different driver must not be authorized to act on this delivery",
  );
  assert.equal(
    canActOnDelivery({ isOwner: false, staffId: driverA.id, canPerformDeliveries: true, canManageDeliveries: false }, fresh!),
    true,
  );

  const updated = await markPickedUp(business.id, delivery.id);
  assert.equal(updated.status, "PICKED_UP");
  assert.ok(updated.pickedUpAt);
});

test("markPickedUp is idempotent — a duplicate tap is a safe no-op", async () => {
  const { business, product } = await makeDeliveryBusiness("pickup-idempotent");
  const { order, delivery } = await makeDeliveryOrder(business.id, product.id);
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const driver = await inviteDriver(business.id, "pickup-idempotent");
  await assignDriver(business.id, delivery.id, driver.id);

  const first = await markPickedUp(business.id, delivery.id);
  const second = await markPickedUp(business.id, delivery.id);
  assert.equal(second.status, "PICKED_UP");
  assert.equal(first.pickedUpAt?.getTime(), second.pickedUpAt?.getTime(), "a duplicate tap must not overwrite the original timestamp");
});

test("the assigned driver can mark DELIVERED, which atomically completes the order", async () => {
  const { business, product } = await makeDeliveryBusiness("delivered-completes");
  const { order, delivery } = await makeDeliveryOrder(business.id, product.id);
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const driver = await inviteDriver(business.id, "delivered-completes");
  await assignDriver(business.id, delivery.id, driver.id);
  await markPickedUp(business.id, delivery.id);

  const updated = await markDelivered(business.id, delivery.id, driver.id);
  assert.equal(updated.status, "DELIVERED");

  const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(finalOrder.status, "COMPLETED");
});

test("a duplicate 'Delivered' mutation is safe and does not duplicate stock deduction", async () => {
  const { business, product } = await makeDeliveryBusiness("delivered-idempotent");
  const { order, delivery } = await makeDeliveryOrder(business.id, product.id);
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const driver = await inviteDriver(business.id, "delivered-idempotent");
  await assignDriver(business.id, delivery.id, driver.id);
  await markPickedUp(business.id, delivery.id);

  await markDelivered(business.id, delivery.id, driver.id);
  const afterFirst = await prisma.inventoryItem.findUniqueOrThrow({ where: { productId: product.id } });
  assert.equal(afterFirst.quantity, 19, "makeDeliveryBusiness seeds 20 units — one is deducted on delivery");

  await markDelivered(business.id, delivery.id, driver.id); // duplicate tap
  const afterSecond = await prisma.inventoryItem.findUniqueOrThrow({ where: { productId: product.id } });
  assert.equal(afterSecond.quantity, 19, "stock must not be deducted a second time");
});

test("a CANCELLED order cannot be completed through delivery — the delivery still records DELIVERED, but the order is never resurrected", async () => {
  const { business, product } = await makeDeliveryBusiness("cancelled-not-resurrected");
  const { order, delivery } = await makeDeliveryOrder(business.id, product.id);
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const driver = await inviteDriver(business.id, "cancelled-not-resurrected");
  await assignDriver(business.id, delivery.id, driver.id);
  await markPickedUp(business.id, delivery.id);

  // Simulate the order being cancelled out from under an in-flight delivery.
  await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });

  const updated = await markDelivered(business.id, delivery.id, driver.id);
  assert.equal(updated.status, "DELIVERED", "the physical delivery fact is still recorded");

  const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(finalOrder.status, "CANCELLED", "a cancelled order must never be resurrected to COMPLETED");
});

test("reportFailure requires a non-empty reason and is only allowed from ASSIGNED or PICKED_UP", async () => {
  const { business, product } = await makeDeliveryBusiness("failure-requirements");
  const { order, delivery } = await makeDeliveryOrder(business.id, product.id);

  await assert.rejects(reportFailure(business.id, delivery.id, ""), /reason is required/);
  // Still UNASSIGNED at this point.
  await assert.rejects(reportFailure(business.id, delivery.id, "Customer unavailable"), /Cannot report/);

  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const driver = await inviteDriver(business.id, "failure-requirements");
  await assignDriver(business.id, delivery.id, driver.id);

  const failed = await reportFailure(business.id, delivery.id, "Customer unavailable");
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.failureReason, "Customer unavailable");

  const untouchedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.equal(untouchedOrder.status, "READY", "a failed delivery must never auto-cancel the order");
});

// ---------------------------------------------------------------------------
// Live driver location
// ---------------------------------------------------------------------------

test("recordDriverLocation writes only while the delivery is PICKED_UP", async () => {
  const { business, product } = await makeDeliveryBusiness("location-picked-up-only");
  const { order, delivery } = await makeDeliveryOrder(business.id, product.id);
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const driver = await inviteDriver(business.id, "location-picked-up-only");
  await assignDriver(business.id, delivery.id, driver.id);

  // ASSIGNED, not yet PICKED_UP — must reject.
  await assert.rejects(recordDriverLocation(business.id, delivery.id, -26.26, 27.86), /DELIVERY_NOT_ACTIVE/);

  await markPickedUp(business.id, delivery.id);
  await recordDriverLocation(business.id, delivery.id, -26.26, 27.86);
  const picked = await prisma.orderDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  assert.equal(picked.driverLat, -26.26);
  assert.equal(picked.driverLng, 27.86);
  assert.ok(picked.driverLocationUpdatedAt);

  // A later ping updates the position.
  await recordDriverLocation(business.id, delivery.id, -26.3, 27.9);
  const movedTo = await prisma.orderDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  assert.equal(movedTo.driverLat, -26.3);
  assert.equal(movedTo.driverLng, 27.9);
});

test("markDelivered clears the driver's live location — no reason to retain it after the delivery ends", async () => {
  const { business, product } = await makeDeliveryBusiness("location-cleared-on-delivered");
  const { order, delivery } = await makeDeliveryOrder(business.id, product.id);
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const driver = await inviteDriver(business.id, "location-cleared-on-delivered");
  await assignDriver(business.id, delivery.id, driver.id);
  await markPickedUp(business.id, delivery.id);
  await recordDriverLocation(business.id, delivery.id, -26.26, 27.86);

  await markDelivered(business.id, delivery.id, driver.id);

  const finalDelivery = await prisma.orderDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  assert.equal(finalDelivery.driverLat, null);
  assert.equal(finalDelivery.driverLng, null);
  assert.equal(finalDelivery.driverLocationUpdatedAt, null);
});

test("reportFailure clears the driver's live location too", async () => {
  const { business, product } = await makeDeliveryBusiness("location-cleared-on-failure");
  const { order, delivery } = await makeDeliveryOrder(business.id, product.id);
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const driver = await inviteDriver(business.id, "location-cleared-on-failure");
  await assignDriver(business.id, delivery.id, driver.id);
  await markPickedUp(business.id, delivery.id);
  await recordDriverLocation(business.id, delivery.id, -26.26, 27.86);

  await reportFailure(business.id, delivery.id, "Vehicle problem");

  const finalDelivery = await prisma.orderDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
  assert.equal(finalDelivery.driverLat, null);
  assert.equal(finalDelivery.driverLng, null);
  assert.equal(finalDelivery.driverLocationUpdatedAt, null);
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

test("canActOnDelivery is permission-based, not workspace-based — it never inspects jobTitle/jobPreset/primaryWorkspace", () => {
  // The function's own type signature only accepts isOwner/staffId/
  // permission booleans — there is no workspace field it could read even
  // if it wanted to. This test documents that invariant directly.
  const delivery = { driverStaffId: "driver-1" };
  assert.equal(canActOnDelivery({ isOwner: false, staffId: "driver-1", canPerformDeliveries: true, canManageDeliveries: false }, delivery), true);
  assert.equal(canActOnDelivery({ isOwner: false, staffId: "driver-2", canPerformDeliveries: true, canManageDeliveries: false }, delivery), false);
  assert.equal(canActOnDelivery({ isOwner: false, staffId: "driver-2", canPerformDeliveries: false, canManageDeliveries: true }, delivery), true);
  assert.equal(canActOnDelivery({ isOwner: true, staffId: "irrelevant", canPerformDeliveries: false, canManageDeliveries: false }, delivery), true);
});

test("manager/owner (canManageDeliveries) can dispatch; a Counter-shaped permission set cannot", async () => {
  const { business, product } = await makeDeliveryBusiness("dispatch-authz");
  const { order, delivery } = await makeDeliveryOrder(business.id, product.id);
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const driver = await inviteDriver(business.id, "dispatch-authz");

  // assignDriver itself has no permission check (that's the action layer's
  // job — see dashboard/deliveries/actions.ts's requireStaffPermission);
  // this test asserts the STORED permission sets that gate reaching it.
  const { STAFF_PRESETS } = await import("@/modules/staff/staff-presets");
  assert.equal(STAFF_PRESETS.COUNTER.permissions.canManageDeliveries, false, "Counter must not dispatch unless explicitly permitted");
  assert.equal(STAFF_PRESETS.KITCHEN.permissions.canManageDeliveries, false, "Kitchen cannot access driver/dispatch data");
  assert.equal(STAFF_PRESETS.MANAGER.permissions.canManageDeliveries, true);

  // Still exercise the real function to confirm dispatch itself works
  // once the door is open.
  const updated = await assignDriver(business.id, delivery.id, driver.id);
  assert.equal(updated.status, "ASSIGNED");
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

test("tenant A cannot read, assign, or update tenant B's delivery", async () => {
  const bizA = await makeDeliveryBusiness("isolation-a");
  const bizB = await makeDeliveryBusiness("isolation-b");
  const { order: orderB, delivery: deliveryB } = await makeDeliveryOrder(bizB.business.id, bizB.product.id);
  await prisma.order.update({ where: { id: orderB.id }, data: { status: "READY" } });
  const driverInA = await inviteDriver(bizA.business.id, "isolation");

  const fetchedByA = await getDeliveryForActorCheck(bizA.business.id, deliveryB.id);
  assert.equal(fetchedByA, null, "business A must never resolve business B's delivery, even by id");

  await assert.rejects(assignDriver(bizA.business.id, deliveryB.id, driverInA.id));
  await assert.rejects(markPickedUp(bizA.business.id, deliveryB.id));
  await assert.rejects(markDelivered(bizA.business.id, deliveryB.id));
  await assert.rejects(reportFailure(bizA.business.id, deliveryB.id, "Customer unavailable"));
});

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

test("a driver's active-delivery query returns an exact minimal approved key set", async () => {
  const { business, product } = await makeDeliveryBusiness("privacy-active");
  const { order, delivery } = await makeDeliveryOrder(business.id, product.id);
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const driver = await inviteDriver(business.id, "privacy-active");
  await assignDriver(business.id, delivery.id, driver.id);

  const results = await listMyDeliveries(business.id, driver.id);
  assert.equal(results.length, 1);
  const row = results[0];
  assert.deepEqual(
    Object.keys(row).sort(),
    // needsCode / codeLocked are proof-of-delivery STATE (delivery-code.ts) — never the code itself.
    ["contactPhone", "deliveryAddressSnapshot", "deliveryInstructions", "id", "order", "status", "needsCode", "codeLocked"].sort(),
  );
  assert.equal("customerKeyHash" in row, false);
  assert.deepEqual(Object.keys(row.order).sort(), ["items", "membership", "orderNumber", "status"].sort());
});

test("a driver cannot read another driver's delivery through listMyDeliveries", async () => {
  const { business, product } = await makeDeliveryBusiness("privacy-cross-driver");
  const { order, delivery } = await makeDeliveryOrder(business.id, product.id);
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const driverA = await inviteDriver(business.id, "privacy-cross-a");
  const driverB = await inviteDriver(business.id, "privacy-cross-b");
  await assignDriver(business.id, delivery.id, driverA.id);

  const resultsForB = await listMyDeliveries(business.id, driverB.id);
  assert.equal(resultsForB.length, 0, "driver B must not see driver A's assigned delivery");
});

test("completed delivery history returns even less data than the active view — no contact/instructions/items", async () => {
  const { business, product } = await makeDeliveryBusiness("privacy-history");
  const { order, delivery } = await makeDeliveryOrder(business.id, product.id);
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const driver = await inviteDriver(business.id, "privacy-history");
  await assignDriver(business.id, delivery.id, driver.id);
  await markPickedUp(business.id, delivery.id);
  await markDelivered(business.id, delivery.id, driver.id);

  const history = await listMyCompletedDeliveries(business.id, driver.id);
  assert.equal(history.length, 1);
  const row = history[0];
  assert.deepEqual(
    Object.keys(row).sort(),
    ["deliveredAt", "failedAt", "failureReason", "id", "order", "status"].sort(),
  );
  assert.deepEqual(Object.keys(row.order).sort(), ["orderNumber"]);
});
