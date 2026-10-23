import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { canAdvanceOrderFromStatus, getOrderStatus } from "@/modules/orders/order.service";
import { STAFF_PRESETS } from "@/modules/staff/staff-presets";

/**
 * Server-side transition authority (order.service.ts's own doc comment
 * covers the design rationale). This is the actual enforcement point
 * dashboard/orders/actions.ts's advanceOrderStatusAction calls — tested
 * directly since guards.ts's request-bound helpers can't run outside a
 * Next.js request context in this harness (see staff.service.test.ts's
 * `permissionsFor` for the same pattern).
 */

const KITCHEN = STAFF_PRESETS.KITCHEN.permissions;
const MANAGER = STAFF_PRESETS.MANAGER.permissions;
const COUNTER = STAFF_PRESETS.COUNTER.permissions;

test("Kitchen can start preparation (CONFIRMED -> PROCESSING)", () => {
  assert.equal(canAdvanceOrderFromStatus("CONFIRMED", KITCHEN), true);
});

test("Kitchen can mark ready (PROCESSING -> READY)", () => {
  assert.equal(canAdvanceOrderFromStatus("PROCESSING", KITCHEN), true);
});

test("Kitchen cannot accept a new order (PENDING -> CONFIRMED) — managerial only", () => {
  assert.equal(canAdvanceOrderFromStatus("PENDING", KITCHEN), false);
});

test("Kitchen has no 'advance' authority over a terminal or READY order (completing/cancelling are separate actions, never reachable through this function)", () => {
  assert.equal(canAdvanceOrderFromStatus("READY", KITCHEN), false);
  assert.equal(canAdvanceOrderFromStatus("COMPLETED", KITCHEN), false);
  assert.equal(canAdvanceOrderFromStatus("CANCELLED", KITCHEN), false);
});

test("Manager and Counter can perform every transition this function covers, including accepting a new order", () => {
  for (const permissions of [MANAGER, COUNTER]) {
    assert.equal(canAdvanceOrderFromStatus("PENDING", permissions), true);
    assert.equal(canAdvanceOrderFromStatus("CONFIRMED", permissions), true);
    assert.equal(canAdvanceOrderFromStatus("PROCESSING", permissions), true);
  }
});

test("a role with neither flag can perform no transition at all", () => {
  const none = { canManageOrders: false, canPrepareOrders: false };
  assert.equal(canAdvanceOrderFromStatus("PENDING", none), false);
  assert.equal(canAdvanceOrderFromStatus("CONFIRMED", none), false);
  assert.equal(canAdvanceOrderFromStatus("PROCESSING", none), false);
});

// ---------------------------------------------------------------------------
// Tenant isolation for the permission-decision lookup itself
// ---------------------------------------------------------------------------

test("getOrderStatus never returns another business's order", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const bizA = await prisma.business.create({
    data: { name: `Order Authority Test A ${suffix}`, slug: `order-authority-a-${suffix}`, status: "ACTIVE" },
  });
  const bizB = await prisma.business.create({
    data: { name: `Order Authority Test B ${suffix}`, slug: `order-authority-b-${suffix}`, status: "ACTIVE" },
  });
  const orderB = await prisma.order.create({
    data: { businessId: bizB.id, orderNumber: `OA-${suffix}`, status: "CONFIRMED", subtotal: 10, total: 10 },
  });

  const asSeenByA = await getOrderStatus(bizA.id, orderB.id);
  assert.equal(asSeenByA, null, "business A must never resolve business B's order, even by id");

  const asSeenByB = await getOrderStatus(bizB.id, orderB.id);
  assert.equal(asSeenByB?.status, "CONFIRMED");

  await prisma.order.deleteMany({ where: { businessId: { in: [bizA.id, bizB.id] } } });
  await prisma.business.deleteMany({ where: { id: { in: [bizA.id, bizB.id] } } });
});
