import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { hashPassword } from "@/modules/auth/auth.service";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { createOrder, completeOrder, getOrder } from "@/modules/orders/order.service";
import { InsufficientStockError } from "@/modules/inventory/inventory.service";
import { createProduct } from "@/modules/catalog/catalog.service";
import { createOptionGroup, createOption, assignOptionGroupToProduct } from "@/modules/catalog/menu-options.service";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function makeBusiness(label: string) {
  const { business } = await createBusiness({
    name: `Order Test ${label}`,
    category: "FOOD_VENDOR",
    owner: {
      firstName: "Owner",
      lastName: label,
      email: `order-owner-${label}-${suffix}@example.test`,
      passwordHash: await hashPassword("SomePassword123"),
    },
  });
  return business;
}

async function makeOrderForProduct(businessId: string, productId: string) {
  return createOrder(businessId, {
    source: "pos",
    items: [{ productId, name: "Test Product", quantity: 1, unitPrice: 45, discount: 0 }],
    discount: 0,
    paymentStatus: "PENDING",
    fulfilmentMethod: "COLLECTION",
    deliveryFee: 0,
  });
}

test("completeOrder succeeds for a trackStock:true product with no InventoryItem row (the historical bug)", async () => {
  const business = await makeBusiness("no-inventory-record");
  // Deliberately bypasses catalog.service.ts's createProduct (which now
  // defaults trackStock: false) to reproduce every pre-existing product's
  // real shape: schema default trackStock: true, zero InventoryItem rows —
  // exactly what every product added before this fix already looks like.
  const product = await prisma.product.create({
    data: { businessId: business.id, name: "Legacy Product", price: 45 },
  });
  const order = await makeOrderForProduct(business.id, product.id);

  await prisma.order.update({ where: { id: order!.id }, data: { status: "READY" } });
  const completed = await completeOrder(business.id, order!.id);
  assert.equal(completed.status, "COMPLETED");
});

test("completeOrder still deducts stock and enforces InsufficientStockError when a real InventoryItem exists", async () => {
  const business = await makeBusiness("real-inventory");
  const product = await prisma.product.create({
    data: { businessId: business.id, name: "Tracked Product", price: 45 },
  });
  await prisma.inventoryItem.create({
    data: { businessId: business.id, productId: product.id, quantity: 1 },
  });

  const enoughStock = await makeOrderForProduct(business.id, product.id);
  await prisma.order.update({ where: { id: enoughStock!.id }, data: { status: "READY" } });
  const completed = await completeOrder(business.id, enoughStock!.id);
  assert.equal(completed.status, "COMPLETED");

  const item = await prisma.inventoryItem.findFirst({ where: { businessId: business.id, productId: product.id } });
  assert.equal(item?.quantity, 0, "stock should have been deducted by the order quantity");

  const notEnoughStock = await makeOrderForProduct(business.id, product.id);
  await prisma.order.update({ where: { id: notEnoughStock!.id }, data: { status: "READY" } });
  await assert.rejects(
    () => completeOrder(business.id, notEnoughStock!.id),
    InsufficientStockError,
  );
});

// ---------------------------------------------------------------------------
// Checkout idempotency (storefront basket milestone) — see order.service.ts's
// checkoutIdempotencyKey and its (businessId, checkoutIdempotencyKey) unique
// constraint. The DB constraint is the real guarantee under concurrency; the
// pre-check is only a fast path for the common sequential-retry case.
// ---------------------------------------------------------------------------

test("createOrder with a fresh checkoutIdempotencyKey creates a new order, marked created:true", async () => {
  const business = await makeBusiness("idempotency-fresh");
  const product = await prisma.product.create({ data: { businessId: business.id, name: "Item", price: 45 } });

  const order = await createOrder(business.id, {
    source: "online",
    items: [{ productId: product.id, name: "Item", quantity: 1, unitPrice: 45, discount: 0 }],
    discount: 0,
    paymentStatus: "PENDING",
    fulfilmentMethod: "COLLECTION",
    deliveryFee: 0,
    checkoutIdempotencyKey: "fresh-key-1",
  });
  assert.equal((order as { created?: boolean }).created, true);
});

test("submitting the SAME checkoutIdempotencyKey twice, sequentially, returns the SAME order — exactly one row, marked created:false the second time", async () => {
  const business = await makeBusiness("idempotency-sequential-retry");
  const product = await prisma.product.create({ data: { businessId: business.id, name: "Item", price: 45 } });
  const input = {
    source: "online" as const,
    items: [{ productId: product.id, name: "Item", quantity: 2, unitPrice: 45, discount: 0 }],
    discount: 0,
    paymentStatus: "PENDING" as const,
    fulfilmentMethod: "COLLECTION" as const,
    deliveryFee: 0,
    checkoutIdempotencyKey: "sequential-retry-key",
  };

  const first = await createOrder(business.id, input);
  const second = await createOrder(business.id, input);

  assert.equal(first!.id, second!.id, "a retried submission must return the SAME order, not create a second one");
  assert.equal((first as { created?: boolean }).created, true);
  assert.equal((second as { created?: boolean }).created, false, "the retry must be flagged as NOT newly created — the caller uses this to skip duplicate notifications");

  const count = await prisma.order.count({ where: { businessId: business.id, checkoutIdempotencyKey: "sequential-retry-key" } });
  assert.equal(count, 1, "exactly one Order row for this key, never two");

  const items = await prisma.orderItem.findMany({ where: { orderId: first!.id } });
  assert.equal(items.length, 1, "exactly one set of OrderItems — a retry must not append a second set");
});

test("concurrent duplicate submissions of the SAME key race safely — exactly one Order is ever created, proven by the DB unique constraint, not an in-memory flag", async () => {
  const business = await makeBusiness("idempotency-concurrent");
  const product = await prisma.product.create({ data: { businessId: business.id, name: "Item", price: 45 } });
  const input = {
    source: "online" as const,
    items: [{ productId: product.id, name: "Item", quantity: 1, unitPrice: 45, discount: 0 }],
    discount: 0,
    paymentStatus: "PENDING" as const,
    fulfilmentMethod: "COLLECTION" as const,
    deliveryFee: 0,
    checkoutIdempotencyKey: "concurrent-key",
  };

  // Genuinely concurrent, not sequential — both requests fire before either
  // has a chance to see the other's insert via the pre-check, which is
  // exactly the scenario a pre-check-only implementation would fail: this
  // proves the unique-constraint-violation catch path, not just the
  // sequential pre-check above.
  const [a, b] = await Promise.all([createOrder(business.id, input), createOrder(business.id, input)]);

  assert.equal(a!.id, b!.id, "both concurrent attempts must resolve to the SAME order");
  const createdFlags = [(a as { created?: boolean }).created, (b as { created?: boolean }).created].sort();
  assert.deepEqual(createdFlags, [false, true], "exactly one of the two concurrent calls actually created the row");

  const count = await prisma.order.count({ where: { businessId: business.id, checkoutIdempotencyKey: "concurrent-key" } });
  assert.equal(count, 1);
});

test("the SAME idempotency key string used by TWO DIFFERENT businesses creates two independent orders — the uniqueness is (businessId, key), not key alone", async () => {
  const businessA = await makeBusiness("idempotency-cross-biz-a");
  const businessB = await makeBusiness("idempotency-cross-biz-b");
  const productA = await prisma.product.create({ data: { businessId: businessA.id, name: "A Item", price: 10 } });
  const productB = await prisma.product.create({ data: { businessId: businessB.id, name: "B Item", price: 20 } });
  const sharedKey = "shared-key-across-businesses";

  const orderA = await createOrder(businessA.id, {
    source: "online",
    items: [{ productId: productA.id, name: "A Item", quantity: 1, unitPrice: 10, discount: 0 }],
    discount: 0,
    paymentStatus: "PENDING",
    fulfilmentMethod: "COLLECTION",
    deliveryFee: 0,
    checkoutIdempotencyKey: sharedKey,
  });
  const orderB = await createOrder(businessB.id, {
    source: "online",
    items: [{ productId: productB.id, name: "B Item", quantity: 1, unitPrice: 20, discount: 0 }],
    discount: 0,
    paymentStatus: "PENDING",
    fulfilmentMethod: "COLLECTION",
    deliveryFee: 0,
    checkoutIdempotencyKey: sharedKey,
  });

  assert.notEqual(orderA!.id, orderB!.id);
  assert.equal((orderA as { created?: boolean }).created, true);
  assert.equal((orderB as { created?: boolean }).created, true, "a different business reusing the same key string must NOT collide with the other business's order");
});

test("a genuinely different checkoutIdempotencyKey for the same business creates a genuinely new order", async () => {
  const business = await makeBusiness("idempotency-different-key");
  const product = await prisma.product.create({ data: { businessId: business.id, name: "Item", price: 45 } });
  const base = {
    source: "online" as const,
    items: [{ productId: product.id, name: "Item", quantity: 1, unitPrice: 45, discount: 0 }],
    discount: 0,
    paymentStatus: "PENDING" as const,
    fulfilmentMethod: "COLLECTION" as const,
    deliveryFee: 0,
  };

  const first = await createOrder(business.id, { ...base, checkoutIdempotencyKey: "key-aaaa" });
  const second = await createOrder(business.id, { ...base, checkoutIdempotencyKey: "key-bbbb" });

  assert.notEqual(first!.id, second!.id);
  const count = await prisma.order.count({ where: { businessId: business.id } });
  assert.ok(count >= 2);
});

// ---------------------------------------------------------------------------
// Food Menu Domain Foundation (Phase 4) §14 — OrderItemOption snapshots
// ---------------------------------------------------------------------------

test("createOrder persists one OrderItemOption row per selected option, correctly linked to its OrderItem", async () => {
  const business = await makeBusiness("option-snapshot-basic");
  const product = await createProduct(business.id, { name: "Kota Special", price: 45 });
  const real = await createOrder(business.id, {
    source: "online",
    items: [
      {
        productId: product.id,
        name: "Kota Special",
        quantity: 2,
        unitPrice: 70,
        discount: 0,
        options: [
          { groupName: "Choose your size", optionName: "Large", priceDelta: 15 },
          { groupName: "Extras", optionName: "Cheese", priceDelta: 10 },
        ],
      },
    ],
    discount: 0,
    paymentStatus: "PENDING",
    fulfilmentMethod: "COLLECTION",
    deliveryFee: 0,
  });

  const fetched = await getOrder(business.id, real!.id);
  assert.equal(fetched!.items.length, 1);
  const options = fetched!.items[0].options;
  assert.equal(options.length, 2);
  assert.deepEqual(
    options.map((o) => [o.groupNameSnapshot, o.optionNameSnapshot, o.priceDeltaSnapshot.toString()]),
    [
      ["Choose your size", "Large", "15"],
      ["Extras", "Cheese", "10"],
    ],
  );
});

test("an item with no options array persists zero OrderItemOption rows — every pre-Phase-4/POS order is unaffected (§19)", async () => {
  const business = await makeBusiness("option-snapshot-none");
  const product = await createProduct(business.id, { name: "Chips", price: 25 });
  const order = await makeOrderForProduct(business.id, product.id);
  const fetched = await getOrder(business.id, order!.id);
  assert.equal(fetched!.items[0].options.length, 0);
});

test("multi-item order: each item's options are attached to the correct OrderItem, never cross-linked", async () => {
  const business = await makeBusiness("option-snapshot-multi-item");
  const kota = await createProduct(business.id, { name: "Kota Special", price: 45 });
  const chips = await createProduct(business.id, { name: "Chips", price: 25 });

  const order = await createOrder(business.id, {
    source: "online",
    items: [
      { productId: kota.id, name: "Kota Special", quantity: 1, unitPrice: 60, discount: 0, options: [{ groupName: "Size", optionName: "Large", priceDelta: 15 }] },
      { productId: chips.id, name: "Chips", quantity: 1, unitPrice: 25, discount: 0 },
    ],
    discount: 0,
    paymentStatus: "PENDING",
    fulfilmentMethod: "COLLECTION",
    deliveryFee: 0,
  });

  const fetched = await getOrder(business.id, order!.id);
  const kotaItem = fetched!.items.find((i) => i.name === "Kota Special")!;
  const chipsItem = fetched!.items.find((i) => i.name === "Chips")!;
  assert.equal(kotaItem.options.length, 1);
  assert.equal(chipsItem.options.length, 0);
});

test("the order snapshot survives the live MenuOption/MenuOptionGroup being renamed, re-priced, deactivated, and deleted afterwards", async () => {
  const business = await makeBusiness("option-snapshot-survives-changes");
  const product = await createProduct(business.id, { name: "Kota Special", price: 45 });
  const group = await createOptionGroup(business.id, { name: "Choose your size", selectionType: "SINGLE", minSelections: 1, maxSelections: 1 });
  const large = await createOption(business.id, group.id, { name: "Large", priceDelta: 15 });
  await assignOptionGroupToProduct(business.id, product.id, group.id);

  const order = await createOrder(business.id, {
    source: "online",
    items: [
      {
        productId: product.id,
        name: "Kota Special",
        quantity: 1,
        unitPrice: 60,
        discount: 0,
        options: [{ groupId: group.id, optionId: large.id, groupName: group.name, optionName: large.name, priceDelta: 15 }],
      },
    ],
    discount: 0,
    paymentStatus: "PENDING",
    fulfilmentMethod: "COLLECTION",
    deliveryFee: 0,
  });

  // Rename, re-price, deactivate, then delete the live option and its group.
  await prisma.menuOption.update({ where: { id: large.id }, data: { name: "XL", priceDelta: 25, isActive: false } });
  await prisma.menuOptionGroup.update({ where: { id: group.id }, data: { name: "Portion size", isActive: false } });
  await prisma.menuOption.delete({ where: { id: large.id } });
  await prisma.menuOptionGroup.delete({ where: { id: group.id } });

  const fetched = await getOrder(business.id, order!.id);
  const snapshotOption = fetched!.items[0].options[0];
  assert.equal(snapshotOption.groupNameSnapshot, "Choose your size", "the historical group name must never change");
  assert.equal(snapshotOption.optionNameSnapshot, "Large", "the historical option name must never change");
  assert.equal(snapshotOption.priceDeltaSnapshot.toString(), "15", "the historical price delta must never change");
  // onDelete: SetNull — the traceability FK is gone, the snapshot text is not.
  assert.equal(snapshotOption.groupId, null);
  assert.equal(snapshotOption.optionId, null);
});
