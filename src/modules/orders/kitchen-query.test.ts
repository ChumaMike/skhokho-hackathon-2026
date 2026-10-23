import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { listKitchenOrders } from "@/modules/orders/order.service";

/**
 * Kitchen workspace's own minimal query — must never expose customer,
 * staff, or payment fields, since the whole point is fetching only what
 * preparing an order requires rather than fetching a broad shape and
 * hiding fields in the component.
 */

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let business: { id: string };
let product: { id: string; name: string };
const orderIds: string[] = [];

test.before(async () => {
  business = await prisma.business.create({
    data: { name: `Kitchen Query Test ${suffix}`, slug: `kitchen-query-test-${suffix}`, status: "ACTIVE" },
  });
  product = await prisma.product.create({
    data: { businessId: business.id, name: "Kota Special", price: 45 },
  });
  const customer = await prisma.customer.create({ data: {} });
  const membership = await prisma.membership.create({
    data: { customerId: customer.id, businessId: business.id, shortCode: `KQ-${suffix}` },
  });

  for (const status of ["PENDING", "CONFIRMED", "PROCESSING", "READY", "COMPLETED"] as const) {
    const order = await prisma.order.create({
      data: {
        businessId: business.id,
        membershipId: membership.id,
        orderNumber: `KQ-${status}-${suffix}`,
        status,
        subtotal: 45,
        total: 45,
        paymentStatus: "PAID",
        items: { create: [{ productId: product.id, name: product.name, quantity: 2, unitPrice: 45, total: 90 }] },
      },
    });
    orderIds.push(order.id);
  }
});

test.after(async () => {
  await prisma.orderItem.deleteMany({ where: { order: { businessId: business.id } } });
  await prisma.order.deleteMany({ where: { businessId: business.id } });
  await prisma.product.deleteMany({ where: { businessId: business.id } });
  await prisma.membership.deleteMany({ where: { businessId: business.id } });
  await prisma.business.delete({ where: { id: business.id } });
});

test("listKitchenOrders returns only CONFIRMED and PROCESSING orders", async () => {
  const orders = await listKitchenOrders(business.id);
  const statuses = orders.map((o) => o.status).sort();
  assert.deepEqual(statuses, ["CONFIRMED", "PROCESSING"]);
});

test("listKitchenOrders' shape excludes membership/staff/payment fields entirely", async () => {
  const orders = await listKitchenOrders(business.id);
  assert.ok(orders.length > 0);
  for (const order of orders) {
    const keys = Object.keys(order);
    assert.ok(!keys.includes("membership"), "no customer/membership data");
    assert.ok(!keys.includes("staff"), "no staff data");
    assert.ok(!keys.includes("paymentStatus"), "no payment data");
    assert.ok(!keys.includes("paymentMethod"), "no payment data");
    assert.ok(!keys.includes("total"), "no price data — not needed to prepare an order");
    assert.ok(!keys.includes("delivery"), "no address/phone — the kitchen packs, it doesn't deliver");
    // Merchant operations (Phase 5): the kitchen needs to know whether an order
    // is packed to travel (`fulfilmentMethod`) and the customer's order note
    // (`notes`, e.g. "no onions"). Neither identifies or contacts the customer.
    assert.deepEqual(keys.sort(), ["createdAt", "fulfilmentMethod", "id", "items", "notes", "orderNumber", "status"]);
    for (const item of order.items) {
      // Food Menu Domain Foundation (Phase 4) §15 — Kitchen must see selected
      // customer choices ("Large", "No tomato") to prepare the item, so
      // `options` (an array of `{optionNameSnapshot}` rows, never customer/
      // payment data) joins the minimal shape here.
      assert.deepEqual(
        Object.keys(item).sort(),
        ["name", "options", "quantity"],
        "item rows carry only what's needed to prepare it",
      );
      for (const option of item.options) {
        assert.deepEqual(Object.keys(option), ["optionNameSnapshot"], "no priceDelta/id data on kitchen option rows");
      }
    }
  }
});
