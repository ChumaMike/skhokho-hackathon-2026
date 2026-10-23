import test from "node:test";
import assert from "node:assert/strict";
import { STAFF_PRESETS } from "@/modules/staff/staff-presets";
import { ALL_PERMISSIONS, NO_PERMISSIONS } from "@/types";
import { counterAccess, COUNTER_ENTRY_PERMISSIONS } from "./counter-access";

/**
 * The Counter page's access matrix per preset — the same boolean decision
 * the page makes from the stored permissions (dashboard-read-access.test.ts
 * covers the other pages the same way).
 */

const EXPECTED: Record<string, { allowed: boolean; orders: boolean; stamp: boolean }> = {
  GENERAL: { allowed: true, orders: true, stamp: true },
  MANAGER: { allowed: true, orders: true, stamp: true },
  COUNTER: { allowed: true, orders: true, stamp: true },
  KITCHEN: { allowed: false, orders: false, stamp: false },
  DRIVER: { allowed: false, orders: false, stamp: false },
  SERVICE_PROVIDER: { allowed: false, orders: false, stamp: false },
  STOCK: { allowed: false, orders: false, stamp: false },
};

test("every preset lands where the matrix says — kitchen, drivers, technicians and stock never see the counter", () => {
  for (const [id, preset] of Object.entries(STAFF_PRESETS)) {
    const got = counterAccess(preset.permissions, false);
    const want = EXPECTED[id];
    assert.ok(want, `matrix has ${id}`);
    assert.equal(got.allowed, want.allowed, `${id} allowed`);
    assert.equal(got.canSeeOrders, want.orders, `${id} orders`);
    assert.equal(got.canTakeOrders, want.orders, `${id} POS`);
    assert.equal(got.canStamp, want.stamp, `${id} stamp`);
  }
});

test("the owner always has everything; no permissions means no page; a single grant opens only its part", () => {
  assert.deepEqual(counterAccess(NO_PERMISSIONS, true), { allowed: true, canTakeOrders: true, canSeeOrders: true, canStamp: true });
  assert.equal(counterAccess(NO_PERMISSIONS, false).allowed, false);
  assert.deepEqual(counterAccess(ALL_PERMISSIONS, false), { allowed: true, canTakeOrders: true, canSeeOrders: true, canStamp: true });

  const loyaltyOnly = counterAccess({ ...NO_PERMISSIONS, canIssueLoyalty: true }, false);
  assert.deepEqual(loyaltyOnly, { allowed: true, canTakeOrders: false, canSeeOrders: false, canStamp: true });
  const paymentsOnly = counterAccess({ ...NO_PERMISSIONS, canProcessPayments: true }, false);
  assert.deepEqual(paymentsOnly, { allowed: true, canTakeOrders: false, canSeeOrders: false, canStamp: false });
  // A role JSON row written before a key existed reads it as undefined — fails closed.
  assert.equal(counterAccess({} as never, false).allowed, false);
  assert.deepEqual([...COUNTER_ENTRY_PERMISSIONS], ["canManageOrders", "canProcessPayments", "canIssueLoyalty"]);
});
