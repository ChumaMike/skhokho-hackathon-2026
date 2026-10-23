import test from "node:test";
import assert from "node:assert/strict";
import { buildAttentionItems, type AttentionCounts } from "./attention";
import { ALL_PERMISSIONS, NO_PERMISSIONS, STAFF_PERMISSIONS_BY_PRESET } from "@/types";

const FULL_COUNTS: AttentionCounts = {
  unpaidOrders: 2,
  ordersAwaitingConfirmation: 3,
  bookingsAwaitingConfirmation: 1,
  lowStockCount: 4,
  pendingStaffInvites: 1,
  deliveriesNeedingDriver: 2,
  deliveriesOut: 1,
  deliveryProblems: 1,
};

const ZERO_COUNTS: AttentionCounts = {
  unpaidOrders: 0,
  ordersAwaitingConfirmation: 0,
  bookingsAwaitingConfirmation: 0,
  lowStockCount: 0,
  pendingStaffInvites: 0,
  deliveriesNeedingDriver: 0,
  deliveriesOut: 0,
  deliveryProblems: 0,
};

const FOOD_ORDERS_ONLY = new Set(["PRODUCTS", "ORDERS", "PICKUP", "LOYALTY"] as const);
const FOOD_WITH_DELIVERY = new Set(["PRODUCTS", "ORDERS", "PICKUP", "DELIVERY", "LOYALTY"] as const);
const BOOKING_ONLY = new Set(["SERVICES", "BOOKINGS", "LOYALTY"] as const);

// A real, known route for every item type this function can produce.
const VALID_HREFS = new Set([
  "/dashboard/orders",
  "/dashboard/appointments",
  "/dashboard/catalog",
  "/dashboard/staff",
  "/dashboard/deliveries",
]);

test("zero-count items are always omitted", () => {
  const items = buildAttentionItems(ZERO_COUNTS, FOOD_WITH_DELIVERY, ALL_PERMISSIONS, true);
  assert.deepEqual(items, []);
});

test("every returned item's href is a real, known route", () => {
  const items = buildAttentionItems(FULL_COUNTS, FOOD_WITH_DELIVERY, ALL_PERMISSIONS, true);
  assert.ok(items.length > 0);
  for (const item of items) {
    assert.ok(VALID_HREFS.has(item.href), `${item.type} points at an unrecognised route: ${item.href}`);
  }
});

test("FOOD without DELIVERY produces no delivery items, but order items still appear", () => {
  const items = buildAttentionItems(FULL_COUNTS, FOOD_ORDERS_ONLY, ALL_PERMISSIONS, true);
  const types = items.map((i) => i.type);
  assert.ok(!types.includes("READY_DELIVERY_UNASSIGNED"));
  assert.ok(!types.includes("DELIVERY_OUT"));
  assert.ok(!types.includes("FAILED_DELIVERY"));
  assert.ok(types.includes("ORDER_UNPAID"));
  assert.ok(types.includes("ORDER_CONFIRMATION_REQUIRED"));
});

test("FOOD with DELIVERY and an unassigned READY delivery produces READY_DELIVERY_UNASSIGNED", () => {
  const items = buildAttentionItems(FULL_COUNTS, FOOD_WITH_DELIVERY, ALL_PERMISSIONS, true);
  const item = items.find((i) => i.type === "READY_DELIVERY_UNASSIGNED");
  assert.ok(item);
  assert.equal(item!.href, "/dashboard/deliveries");
});

test("a booking-only business never produces order-only attention types", () => {
  const items = buildAttentionItems(FULL_COUNTS, BOOKING_ONLY, ALL_PERMISSIONS, true);
  const types = items.map((i) => i.type);
  assert.ok(!types.includes("ORDER_UNPAID"));
  assert.ok(!types.includes("ORDER_CONFIRMATION_REQUIRED"));
  assert.ok(!types.includes("LOW_STOCK"));
  assert.ok(types.includes("BOOKING_CONFIRMATION_REQUIRED"));
});

test("a staff member without canManageDeliveries never sees delivery attention items, even with real counts and the capability present", () => {
  const items = buildAttentionItems(FULL_COUNTS, FOOD_WITH_DELIVERY, STAFF_PERMISSIONS_BY_PRESET.CASHIER, false);
  const types = items.map((i) => i.type);
  assert.ok(!types.includes("READY_DELIVERY_UNASSIGNED"));
  assert.ok(!types.includes("FAILED_DELIVERY"));
  assert.ok(!types.includes("DELIVERY_OUT"));
});

test("STAFF_INVITE_PENDING only ever appears for the owner", () => {
  const asOwner = buildAttentionItems(FULL_COUNTS, FOOD_WITH_DELIVERY, ALL_PERMISSIONS, true);
  assert.ok(asOwner.some((i) => i.type === "STAFF_INVITE_PENDING"));

  const asManager = buildAttentionItems(FULL_COUNTS, FOOD_WITH_DELIVERY, STAFF_PERMISSIONS_BY_PRESET.MANAGER, false);
  assert.ok(!asManager.some((i) => i.type === "STAFF_INVITE_PENDING"), "Manager is not the owner, even with a broad permission set");
});

test("owner always bypasses every permission gate", () => {
  const items = buildAttentionItems(FULL_COUNTS, FOOD_WITH_DELIVERY, NO_PERMISSIONS, true);
  const types = items.map((i) => i.type);
  assert.ok(types.includes("ORDER_UNPAID"));
  assert.ok(types.includes("READY_DELIVERY_UNASSIGNED"));
  assert.ok(types.includes("STAFF_INVITE_PENDING"));
});

test("BUSINESS_NOT_PUBLISHED / SETUP_INCOMPLETE are never produced — PublicationStatus owns that signal", () => {
  const items = buildAttentionItems(FULL_COUNTS, FOOD_WITH_DELIVERY, ALL_PERMISSIONS, true);
  const types = items.map((i) => i.type) as string[];
  assert.ok(!types.includes("BUSINESS_NOT_PUBLISHED"));
  assert.ok(!types.includes("SETUP_INCOMPLETE"));
});

test("LOW_STOCK requires the INVENTORY capability, not just a permission", () => {
  const withInventory = new Set(["PRODUCTS", "ORDERS", "INVENTORY"] as const);
  const withoutInventory = new Set(["PRODUCTS", "ORDERS"] as const);

  const items = buildAttentionItems(FULL_COUNTS, withInventory, ALL_PERMISSIONS, true);
  assert.ok(items.some((i) => i.type === "LOW_STOCK"));

  const itemsWithoutCapability = buildAttentionItems(FULL_COUNTS, withoutInventory, ALL_PERMISSIONS, true);
  assert.ok(!itemsWithoutCapability.some((i) => i.type === "LOW_STOCK"), "no INVENTORY capability must mean no low-stock alert regardless of permission");
});

test("severity is set and low-stock/confirmation items are never severity critical, but a delivery problem is", () => {
  const items = buildAttentionItems(FULL_COUNTS, FOOD_WITH_DELIVERY, ALL_PERMISSIONS, true);
  for (const item of items) {
    assert.ok(["info", "warning", "critical"].includes(item.severity));
  }
  const failed = items.find((i) => i.type === "FAILED_DELIVERY");
  assert.equal(failed?.severity, "critical");
});
