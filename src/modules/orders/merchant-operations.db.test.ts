import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { hashPassword } from "@/modules/auth/auth.service";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { createProduct } from "@/modules/catalog/catalog.service";
import { setBusinessCapabilities, setDeliverySettings, setFulfilmentSettings, setOrderingPause } from "@/modules/tenant/capabilities";
import { setOperatingHours, defaultOperatingHours } from "@/modules/tenant/operating-hours";
import { resolveStorefrontCartQuote } from "./storefront-cart";
import { createOrder, advanceOrderStatus, completeOrder } from "./order.service";
import { assignDriver } from "./order-delivery.service";
import { checkOrderEligibility } from "@/modules/skhokholetha/delivery.service";
import { createZone, deleteZone, listZones, moveZone, setZoneActive, updateZone, DeliveryZoneError } from "@/modules/delivery/zones.service";
import { createCategory, listCategoriesForOwner, moveCategory, setCategoryActive, updateCategory } from "@/modules/catalog/menu-options.service";
import { countUnreadNotificationsFor, markAllNotificationsReadFor } from "@/modules/dashboard/notifications";
import { __setEmailTransportForTests } from "@/lib/email";
import { enableLethaForTests } from "@/modules/skhokholetha/testing";

/**
 * Merchant operations against a real database: fulfilment settings, hours /
 * pause, zone pricing and service-area enforcement, tenant isolation of the
 * new merchant data, order-completion rules, and per-person notifications.
 */

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const PICKUP = { lat: -26.2485, lng: 27.854 };

async function makeBusiness(label: string) {
  const { business } = await createBusiness({
    name: `Merchant Ops Test ${label}`,
    category: "RETAIL_STORE" as never,
    owner: { firstName: "Owner", lastName: label, email: `merchant-ops-${label}-${suffix}@example.test`, passwordHash: await hashPassword("SomePassword123") },
  });
  await setBusinessCapabilities(business.id, ["PRODUCTS", "ORDERS"] as never);
  await prisma.business.update({ where: { id: business.id }, data: { status: "ACTIVE", latitude: PICKUP.lat, longitude: PICKUP.lng } });
  const product = await createProduct(business.id, { name: `Thing ${label}`, price: 50 } as never);
  return { id: business.id, productId: product.id };
}

const quote = (businessId: string, productId: string, over: Record<string, unknown> = {}) =>
  resolveStorefrontCartQuote({ businessId, lines: [{ productId, quantity: 2 }], fulfilmentMethod: "COLLECTION", ...over } as never);

let restoreEnv: () => void;
test.before(() => {
  restoreEnv = enableLethaForTests();
});
test.after(async () => {
  restoreEnv();
  __setEmailTransportForTests(null);
  const businesses = await prisma.business.findMany({ where: { name: { startsWith: "Merchant Ops Test " } }, select: { id: true } });
  const ids = businesses.map((b) => b.id);
  await prisma.orderDelivery.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.order.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.deliveryZone.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.productCategory.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.product.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessNotification.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessStaff.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessRole.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessSubscription.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.business.deleteMany({ where: { id: { in: ids } } });
  await prisma.appUser.deleteMany({ where: { email: { contains: `merchant-ops-` } } });
});

// --- 3 / 4 / 5 / 11: zones ----------------------------------------------------------

test("zone pricing end to end: the exact fee shown is the exact fee charged, and the snapshot records the area", async () => {
  const a = await makeBusiness("zone-a");
  await setDeliverySettings(a.id, { enabled: true, pricingMode: "ZONE", feeCents: 0 });
  const near = await createZone(a.id, { name: "Near", feeCents: 2000 });
  const far = await createZone(a.id, { name: "Far", feeCents: 3500, minOrderCents: 7500 });

  const r = await quote(a.id, a.productId, { fulfilmentMethod: "DELIVERY", deliveryZoneId: far.id });
  assert.ok(r.ok, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.quote.deliveryFee, "35.00");
  assert.equal(r.quote.total, "135.00");
  assert.deepEqual(r.quote.deliveryZone, { id: far.id, name: "Far" });
  assert.deepEqual(r.quote.deliveryZones?.map((z) => [z.name, z.feeCents]), [["Near", 2000], ["Far", 3500]]);
  assert.equal(r.quote.tradingState, "OPEN");

  // What the checkout route does with that quote: the order carries the same cents and the area name.
  const order = await createOrder(a.id, {
    source: "online",
    items: [{ productId: a.productId, name: "Thing", quantity: 2, unitPrice: 50, discount: 0 }],
    fulfilmentMethod: "DELIVERY",
    deliveryFee: Number(r.quote.deliveryFee),
    deliveryFeeCents: 3500,
    deliveryZoneId: far.id,
    deliveryZoneName: "Far",
    deliveryAddress: "9 Some St",
    paymentStatus: "PENDING",
  } as never);
  assert.ok(order);
  const od = await prisma.orderDelivery.findUniqueOrThrow({ where: { orderId: order.id } });
  assert.deepEqual([od.deliveryFeeCents, od.deliveryZoneId, od.deliveryZoneName], [3500, far.id, "Far"]);
  assert.equal(Number(order.deliveryFee), 35);

  // A per-zone minimum basket applies to the subtotal.
  const small = await resolveStorefrontCartQuote({ businessId: a.id, lines: [{ productId: a.productId, quantity: 1 }], fulfilmentMethod: "DELIVERY", deliveryZoneId: far.id } as never);
  assert.ok(!small.ok && small.code === "BELOW_MINIMUM_ORDER");
  // Area not chosen yet: a pending quote, never a fee of zero.
  const pending = await quote(a.id, a.productId, { fulfilmentMethod: "DELIVERY" });
  assert.ok(pending.ok && pending.quote.deliveryFeePending === true);
  void near;
});

test("5. an unknown area, a hidden area or ANOTHER merchant's area → OUTSIDE_SERVICE_AREA", async () => {
  const a = await makeBusiness("zone-outside-a");
  const b = await makeBusiness("zone-outside-b");
  await setDeliverySettings(a.id, { enabled: true, pricingMode: "ZONE", feeCents: 0 });
  await setDeliverySettings(b.id, { enabled: true, pricingMode: "ZONE", feeCents: 0 });
  await createZone(a.id, { name: "Mine", feeCents: 1500 });
  const bZone = await createZone(b.id, { name: "Theirs", feeCents: 100 });
  const hidden = await createZone(a.id, { name: "Hidden", feeCents: 100, active: false });
  for (const zoneId of ["nope", bZone.id, hidden.id]) {
    const r = await quote(a.id, a.productId, { fulfilmentMethod: "DELIVERY", deliveryZoneId: zoneId });
    assert.ok(!r.ok && r.code === "OUTSIDE_SERVICE_AREA", `${zoneId}: ${JSON.stringify(r)}`);
  }
});

test("11. tenant B cannot read, edit, hide, move or delete tenant A's zones", async () => {
  const a = await makeBusiness("zone-iso-a");
  const b = await makeBusiness("zone-iso-b");
  const z = await createZone(a.id, { name: "A only", feeCents: 1000 });
  assert.equal((await listZones(b.id)).length, 0);
  await assert.rejects(updateZone(b.id, z.id, { name: "Hacked", feeCents: 0 }), DeliveryZoneError);
  await assert.rejects(setZoneActive(b.id, z.id, false), DeliveryZoneError);
  await assert.rejects(moveZone(b.id, z.id, "UP"), DeliveryZoneError);
  await assert.rejects(deleteZone(b.id, z.id), DeliveryZoneError);
  const still = await prisma.deliveryZone.findUniqueOrThrow({ where: { id: z.id } });
  assert.deepEqual([still.name, still.feeCents, still.active], ["A only", 1000, true]);
  await assert.rejects(createZone(a.id, { name: "A only", feeCents: 5 }), /already have an area/);
  await assert.rejects(createZone(a.id, { name: "Neg", feeCents: -5 }), /negative/);
});

// --- 6 / 7 / 8: fulfilment ------------------------------------------------------------

test("6./7. collection off → COLLECTION_UNAVAILABLE; delivery off → DELIVERY_UNAVAILABLE (whatever the client asks for)", async () => {
  const a = await makeBusiness("fulfilment");
  await setFulfilmentSettings(a.id, { collectionEnabled: false, deliverySources: "BOTH" });
  const c = await quote(a.id, a.productId, { fulfilmentMethod: "COLLECTION" });
  assert.ok(!c.ok && c.code === "COLLECTION_UNAVAILABLE");
  const d = await quote(a.id, a.productId, { fulfilmentMethod: "DELIVERY", deliveryAddress: "1 Road" });
  assert.ok(!d.ok && d.code === "DELIVERY_UNAVAILABLE");
  // Delivery on with a flat fee: collection still refused, delivery priced.
  await setDeliverySettings(a.id, { enabled: true, pricingMode: "FLAT", feeCents: 2500 });
  const ok = await quote(a.id, a.productId, { fulfilmentMethod: "DELIVERY" });
  assert.ok(ok.ok && ok.quote.deliveryFee === "25.00" && ok.quote.collectionAvailable === false);
});

test("8. driver source: 'own only' blocks a Skhokholetha request; 'network only' blocks assigning a staff driver", async () => {
  const a = await makeBusiness("sources");
  await setDeliverySettings(a.id, { enabled: true, pricingMode: "FLAT", feeCents: 3000 });
  const order = await createOrder(a.id, {
    source: "online",
    items: [{ productId: a.productId, name: "Thing", quantity: 1, unitPrice: 50, discount: 0 }],
    fulfilmentMethod: "DELIVERY",
    deliveryFee: 30,
    deliveryAddress: "9 Some St",
    deliveryLat: -26.26,
    deliveryLng: 27.87,
    paymentStatus: "PAID",
  } as never);
  assert.ok(order);
  await prisma.order.update({ where: { id: order.id }, data: { status: "READY" } });
  const od = await prisma.orderDelivery.findUniqueOrThrow({ where: { orderId: order.id } });
  await prisma.orderDelivery.update({ where: { id: od.id }, data: { customerKeyHash: `h-${suffix}` } });

  await setFulfilmentSettings(a.id, { collectionEnabled: true, deliverySources: "OWN" });
  const net = await checkOrderEligibility(a.id, order.id);
  assert.ok(!net.ok && /switched off in your fulfilment settings/.test(net.reason));

  await setFulfilmentSettings(a.id, { collectionEnabled: true, deliverySources: "NETWORK" });
  await assert.rejects(assignDriver(a.id, od.id, "any-staff-id"), /Skhokholetha drivers only/);
  const stillUnassigned = await prisma.orderDelivery.findUniqueOrThrow({ where: { id: od.id } });
  assert.equal(stillUnassigned.status, "UNASSIGNED");

  // Parity record: the network quote is based on the fee the customer paid.
  await setFulfilmentSettings(a.id, { collectionEnabled: true, deliverySources: "BOTH" });
  const both = await checkOrderEligibility(a.id, order.id);
  assert.ok(both.ok, JSON.stringify(both));
  if (both.ok) {
    assert.equal(both.order.quote.customerFeeCents, 3000);
    assert.equal(both.order.quote.quoteFeeCents, 3000);
    assert.equal(both.order.quote.merchantCostCents, 0);
  }
});

// --- 9 / 10: paused / closed ------------------------------------------------------------

test("9. a paused shop refuses checkout quotes; resuming reopens it", async () => {
  const a = await makeBusiness("paused");
  await setOrderingPause(a.id, new Date(Date.now() + 30 * 60_000));
  const r = await quote(a.id, a.productId);
  assert.ok(!r.ok && r.code === "ORDERS_PAUSED");
  await assert.rejects(setOrderingPause(a.id, new Date(Date.now() + 48 * 3600_000)), /up to 24 hours/);
  await setOrderingPause(a.id, null);
  assert.ok((await quote(a.id, a.productId)).ok);
});

test("10. a shop closed by its hours refuses checkout quotes", async () => {
  const a = await makeBusiness("closed");
  const hours = defaultOperatingHours();
  for (const k of Object.keys(hours) as (keyof typeof hours)[]) hours[k] = { closed: true };
  await setOperatingHours(a.id, hours);
  const r = await quote(a.id, a.productId);
  assert.ok(!r.ok && r.code === "HOURS_CLOSED");
});

// --- 15: completion ------------------------------------------------------------------

test("15. completeOrder is refused from PENDING, CONFIRMED and PROCESSING — only READY completes", async () => {
  const a = await makeBusiness("complete");
  const order = await createOrder(a.id, { source: "pos", items: [{ productId: a.productId, name: "Thing", quantity: 1, unitPrice: 50, discount: 0 }] } as never);
  assert.ok(order);
  await assert.rejects(completeOrder(a.id, order.id), /Only a ready order/);
  await advanceOrderStatus(a.id, order.id); // CONFIRMED
  await assert.rejects(completeOrder(a.id, order.id), /Only a ready order/);
  await advanceOrderStatus(a.id, order.id); // PROCESSING
  await assert.rejects(completeOrder(a.id, order.id), /Only a ready order/);
  await advanceOrderStatus(a.id, order.id); // READY
  assert.equal((await completeOrder(a.id, order.id)).status, "COMPLETED");
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "COMPLETED");
});

// --- 17: categories ----------------------------------------------------------------------

test("17. categories: tenant B cannot rename, hide or reorder tenant A's categories", async () => {
  const a = await makeBusiness("cat-a");
  const b = await makeBusiness("cat-b");
  const drinks = await createCategory(a.id, { name: "Drinks" });
  await createCategory(a.id, { name: "Snacks" });
  assert.equal((await listCategoriesForOwner(b.id)).length, 0);
  await assert.rejects(updateCategory(b.id, drinks.id, { name: "Pwned" }), /not found/);
  await assert.rejects(setCategoryActive(b.id, drinks.id, false), /not found/);
  await assert.rejects(moveCategory(b.id, drinks.id, "DOWN"), /not found/);
  await moveCategory(a.id, drinks.id, "DOWN");
  assert.deepEqual((await listCategoriesForOwner(a.id)).map((c) => c.name), ["Snacks", "Drinks"]);
  assert.equal((await prisma.productCategory.findUniqueOrThrow({ where: { id: drinks.id } })).name, "Drinks");
});

// --- 20: email failure never touches order state ----------------------------------------

test("20. a failing customer email never corrupts the order", async () => {
  const a = await makeBusiness("email");
  __setEmailTransportForTests(async () => {
    throw new Error("provider down");
  });
  try {
    const order = await createOrder(a.id, {
      source: "online",
      items: [{ productId: a.productId, name: "Thing", quantity: 1, unitPrice: 50, discount: 0 }],
      notifyEmail: `customer-${suffix}@example.test`,
    } as never);
    assert.ok(order);
    assert.equal((order.metadata as { notifyEmail?: string })?.notifyEmail, `customer-${suffix}@example.test`);
    const updated = await advanceOrderStatus(a.id, order.id);
    assert.equal(updated.status, "CONFIRMED");
    await new Promise((r) => setTimeout(r, 300)); // let the fire-and-forget send fail in the background
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "CONFIRMED");
  } finally {
    __setEmailTransportForTests(null);
  }
});

// --- notifications: per person ----------------------------------------------------------

test("notifications: one teammate reading them does not hide them from another", async () => {
  const a = await makeBusiness("notif");
  await prisma.businessNotification.create({ data: { businessId: a.id, type: "new_order", title: "New order", message: "x" } });
  assert.equal(await countUnreadNotificationsFor(a.id, "staff-1"), 1);
  assert.equal(await countUnreadNotificationsFor(a.id, "staff-2"), 1);
  await markAllNotificationsReadFor(a.id, "staff-1");
  assert.equal(await countUnreadNotificationsFor(a.id, "staff-1"), 0);
  assert.equal(await countUnreadNotificationsFor(a.id, "staff-2"), 1, "staff-2 still sees it as new");
  await markAllNotificationsReadFor(a.id, "staff-1"); // idempotent
});
