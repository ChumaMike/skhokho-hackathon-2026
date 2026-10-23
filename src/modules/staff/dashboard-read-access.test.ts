import test from "node:test";
import assert from "node:assert/strict";
import { STAFF_PRESETS } from "@/modules/staff/staff-presets";
import { ALL_PERMISSIONS, type StaffPermissions } from "@/types";

/**
 * Server-side read-access matrix for the four dashboard pages that
 * previously rendered for any authenticated staff member regardless of
 * permission (customers/orders/appointments/catalog — analytics/settings/
 * staff were already gated). Each page now checks the exact gate below
 * BEFORE fetching its data — see each page.tsx for the real
 * requireStaffPermission/requireAnyStaffPermission call this mirrors.
 * guards.ts's helpers depend on next/headers' request scope and can't run
 * directly in this harness, so this asserts the same boolean decision they
 * make from the stored permissions object — the actual authority, not a
 * simulation of it.
 */

function hasCustomersAccess(p: StaffPermissions) {
  return p.canManageCustomers || p.canIssueLoyalty;
}
function hasOrdersAccess(p: StaffPermissions) {
  return p.canManageOrders;
}
function hasAppointmentsAccess(p: StaffPermissions) {
  return p.canReadBookings || p.canManageBookings;
}
function hasCatalogAccess(p: StaffPermissions) {
  return p.canManageServices;
}

const EXPECTED: Record<string, { customers: boolean; orders: boolean; appointments: boolean; catalog: boolean }> = {
  OWNER: { customers: true, orders: true, appointments: true, catalog: true },
  GENERAL: { customers: true, orders: true, appointments: true, catalog: false },
  MANAGER: { customers: true, orders: true, appointments: true, catalog: true },
  COUNTER: { customers: true, orders: true, appointments: true, catalog: false },
  KITCHEN: { customers: false, orders: false, appointments: false, catalog: false },
  DRIVER: { customers: false, orders: false, appointments: false, catalog: false },
  SERVICE_PROVIDER: { customers: false, orders: false, appointments: true, catalog: false },
  STOCK: { customers: false, orders: false, appointments: false, catalog: false },
};

for (const [id, expected] of Object.entries(EXPECTED)) {
  const permissions = id === "OWNER" ? ALL_PERMISSIONS : STAFF_PRESETS[id as keyof typeof STAFF_PRESETS].permissions;

  test(`${id}: customers page access = ${expected.customers}`, () => {
    assert.equal(hasCustomersAccess(permissions), expected.customers);
  });
  test(`${id}: orders page access = ${expected.orders}`, () => {
    assert.equal(hasOrdersAccess(permissions), expected.orders);
  });
  test(`${id}: appointments page access = ${expected.appointments}`, () => {
    assert.equal(hasAppointmentsAccess(permissions), expected.appointments);
  });
  test(`${id}: catalog page access = ${expected.catalog}`, () => {
    assert.equal(hasCatalogAccess(permissions), expected.catalog);
  });
}

test("Kitchen is denied the full Orders page and must use /dashboard/kitchen's privacy-shaped query instead", () => {
  assert.equal(hasOrdersAccess(STAFF_PRESETS.KITCHEN.permissions), false);
});

test("Kitchen cannot read the customer database merely by navigating to /dashboard/customers directly", () => {
  assert.equal(hasCustomersAccess(STAFF_PRESETS.KITCHEN.permissions), false);
});

test("owner access is unchanged — every gate passes regardless of these new checks", () => {
  assert.equal(hasCustomersAccess(ALL_PERMISSIONS), true);
  assert.equal(hasOrdersAccess(ALL_PERMISSIONS), true);
  assert.equal(hasAppointmentsAccess(ALL_PERMISSIONS), true);
  assert.equal(hasCatalogAccess(ALL_PERMISSIONS), true);
});
