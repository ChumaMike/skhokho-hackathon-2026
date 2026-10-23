import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { hashPassword } from "@/modules/auth/auth.service";
import { getBusinessCapabilities, setBusinessCapabilities, getDeliverySettings, setDeliverySettings, getOrderingSettings, setOrderingSettings } from "@/modules/tenant/capabilities";
import { createOrder } from "@/modules/orders/order.service";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function makeBusiness(label: string, category: string) {
  const { business } = await createBusiness({
    name: `Capability Test ${label}`,
    category: category as never,
    owner: {
      firstName: "Owner",
      lastName: label,
      email: `capability-owner-${label}-${suffix}@example.test`,
      passwordHash: await hashPassword("SomePassword123"),
    },
  });
  return business;
}

test.after(async () => {
  const businesses = await prisma.business.findMany({
    where: { name: { startsWith: "Capability Test " } },
    select: { id: true },
  });
  for (const { id } of businesses) {
    await prisma.businessStaff.deleteMany({ where: { businessId: id } });
    await prisma.businessRole.deleteMany({ where: { businessId: id } });
    await prisma.businessSubscription.deleteMany({ where: { businessId: id } });
    await prisma.business.delete({ where: { id } });
  }
});

test("a business with no settings resolves exactly its category's default capabilities", () => {
  const salon = getBusinessCapabilities({ category: "SALON", settings: null });
  assert.deepEqual([...salon].sort(), ["BOOKINGS", "CALLBACKS", "LOYALTY", "SERVICES"]);
});

test("a FOOD_VENDOR business does NOT get DELIVERY by default", () => {
  const food = getBusinessCapabilities({ category: "FOOD_VENDOR", settings: null });
  assert.ok(!food.has("DELIVERY"), "delivery must be an explicit opt-in, never a category default");
  assert.ok(food.has("ORDERS"));
  assert.ok(food.has("PICKUP"));
});

test("OTHER (unclassified) gets the broadest default set, not the narrowest", () => {
  const other = getBusinessCapabilities({ category: "OTHER", settings: null });
  assert.ok(other.has("PRODUCTS") && other.has("SERVICES") && other.has("ORDERS") && other.has("BOOKINGS"));
});

test("setDeliverySettings enables an explicit opt-in that getBusinessCapabilities then reflects", async () => {
  const business = await makeBusiness("opt-in", "FOOD_VENDOR");

  const before = getBusinessCapabilities(business);
  assert.ok(!before.has("DELIVERY"));

  await setDeliverySettings(business.id, { enabled: true, feeCents: 2000 });

  const updated = await prisma.business.findUniqueOrThrow({
    where: { id: business.id },
    select: { category: true, settings: true },
  });
  const after = getBusinessCapabilities(updated);
  assert.ok(after.has("DELIVERY"), "explicit opt-in must be reflected");
  assert.equal(getDeliverySettings(updated).feeCents, 2000);
});

test("DELIVERY is derived solely from delivery settings — putting it in the generic capabilities array does nothing by itself", async () => {
  const business = await makeBusiness("array-does-nothing", "FOOD_VENDOR");

  // The generic capabilities array is a real, independent mechanism for
  // every OTHER capability — but DELIVERY specifically has exactly one
  // control (setDeliverySettings), precisely so the two can never drift
  // out of sync with each other.
  await setBusinessCapabilities(business.id, ["PRODUCTS", "ORDERS", "PICKUP", "LOYALTY", "DELIVERY"]);

  const updated = await prisma.business.findUniqueOrThrow({
    where: { id: business.id },
    select: { category: true, settings: true },
  });
  const capabilities = getBusinessCapabilities(updated);
  assert.ok(!capabilities.has("DELIVERY"), "DELIVERY must not be enabled merely by listing it in the generic array");
});

test("getDeliverySettings validates feeCents server-side, rejecting a non-integer or negative fee", async () => {
  const business = await makeBusiness("fee-validation", "FOOD_VENDOR");
  await assert.rejects(setDeliverySettings(business.id, { enabled: true, feeCents: 19.99 }));
  await assert.rejects(setDeliverySettings(business.id, { enabled: true, feeCents: -100 }));
});

test("createOrder rejects a DELIVERY checkout when the business hasn't enabled delivery", async () => {
  const business = await makeBusiness("delivery-disabled", "FOOD_VENDOR");
  const product = await prisma.product.create({
    data: { businessId: business.id, name: "Test Product", price: 50 },
  });

  await assert.rejects(
    createOrder(business.id, {
      source: "online",
      items: [{ productId: product.id, name: product.name, quantity: 1, unitPrice: 50, discount: 0 }],
      discount: 0,
      paymentStatus: "PENDING",
      fulfilmentMethod: "DELIVERY",
      deliveryFee: 20,
      deliveryAddress: "123 Test Street",
    }),
    /does not currently offer delivery/,
  );

  await prisma.product.delete({ where: { id: product.id } });
});

test("setBusinessCapabilities merges into settings rather than replacing it wholesale", async () => {
  const business = await makeBusiness("merge", "RETAIL_STORE");
  await prisma.business.update({ where: { id: business.id }, data: { settings: { unrelatedKey: "keep-me" } } });

  await setBusinessCapabilities(business.id, ["PRODUCTS", "ORDERS", "LOYALTY"]);

  const updated = await prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { settings: true } });
  const settings = updated.settings as Record<string, unknown>;
  assert.equal(settings.unrelatedKey, "keep-me", "existing settings keys must survive a capability update");
  assert.deepEqual(settings.capabilities, ["PRODUCTS", "ORDERS", "LOYALTY"]);
});

test("getOrderingSettings defaults to no minimum for a business that has never set one", async () => {
  const business = await makeBusiness("ordering-default", "FOOD_VENDOR");
  assert.deepEqual(getOrderingSettings(business), { minOrderCents: 0, pausedUntil: null, prepMinutes: 0 });
});

test("setOrderingSettings rejects a non-integer or negative minimum", async () => {
  const business = await makeBusiness("ordering-validation", "FOOD_VENDOR");
  await assert.rejects(setOrderingSettings(business.id, { minOrderCents: 99.5 }));
  await assert.rejects(setOrderingSettings(business.id, { minOrderCents: -500 }));
});

test("setOrderingSettings merges into settings without clobbering delivery or capabilities", async () => {
  const business = await makeBusiness("ordering-merge", "FOOD_VENDOR");
  await setDeliverySettings(business.id, { enabled: true, feeCents: 2500, areaInfo: "Soweto only" });
  await setBusinessCapabilities(business.id, ["PRODUCTS", "ORDERS", "LOYALTY"]);
  const before = ((await prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { settings: true } })).settings as Record<string, unknown>).delivery;
  // The current stored contract: both pricing fields are always written.
  assert.deepEqual(before, { enabled: true, pricingMode: "FLAT", feeCents: 2500, perKmFeeCents: 0, baseFeeCents: 0, minFeeCents: 0, maxDistanceKm: 0, areaInfo: "Soweto only" });

  await setOrderingSettings(business.id, { minOrderCents: 10000 });

  const updated = await prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { settings: true } });
  const settings = updated.settings as Record<string, unknown>;
  // The stored ordering contract now always carries the pause field (null = not paused).
  assert.deepEqual(settings.ordering, { minOrderCents: 10000, pausedUntil: null, prepMinutes: 0 });
  assert.deepEqual(settings.delivery, before, "delivery settings must survive an ordering update");
  assert.deepEqual(settings.capabilities, ["PRODUCTS", "ORDERS", "LOYALTY"], "capabilities must survive an ordering update");
});
