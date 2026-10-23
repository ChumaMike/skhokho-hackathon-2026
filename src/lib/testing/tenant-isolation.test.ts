import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { testDb, resetTestDb } from "@/lib/testing/db";
import * as catalog from "@/modules/catalog/catalog.service";
import * as orders from "@/modules/orders/order.service";
import * as appointments from "@/modules/appointments/appointment.service";
import * as inventory from "@/modules/inventory/inventory.service";
import * as staffSvc from "@/modules/staff/staff.service";

/**
 * Phase 6 of the multi-tenant domain plan (docs/specs/2026-09-02-multi-
 * tenant-domain-architecture.md): the first real proof that app-code tenant
 * isolation — Business A's businessId scoping Business B's rows out of
 * reach — actually holds, across every resource type, rather than being an
 * assumption re-verified only by code review. Business A always supplies
 * its OWN businessId alongside Business B's REAL row id; every case below
 * must behave exactly as if that row didn't exist for A, and B's row must
 * come out unmodified afterward.
 *
 * catalog/orders/appointments/inventory/staff services all hardcode the
 * app's own `prisma` singleton (@/lib/prisma/client) — not dependency-
 * injectable, the same known gap appointment.test.ts documents — so those
 * sections run against the REAL dev database, with fixtures cleaned up in
 * `after`, exactly like appointment.test.ts already does. Only the loyalty
 * RPC section runs against the isolated `testDb`, calling register_customer/
 * log_visit/redeem_reward directly the same way loyalty.test.ts does — the
 * pairing check lives in the SQL functions themselves, identical whichever
 * connection calls them.
 */

let bizA: { id: string };
let bizB: { id: string };
let productA: { id: string };
let productB: { id: string };
let serviceA: { id: string };
let serviceB: { id: string };
let orderA: { id: string };
let orderB: { id: string };
let appointmentA: { id: string };
let appointmentB: { id: string };
let staffA: { id: string };
let staffB: { id: string };

async function makeFixtures(label: string) {
  const business = await prisma.business.create({
    // ACTIVE: these fixtures stand in for real, live businesses for
    // cross-tenant isolation testing — getActiveProduct/getActiveService
    // (used below) now also require an ACTIVE parent business (Phase 8's
    // publication-lifecycle fix), which a freshly `create`d business
    // wouldn't be by default (PENDING_VERIFICATION).
    data: { name: `Isolation Test Biz ${label}`, slug: `isolation-test-${label}-${Date.now()}`, status: 'ACTIVE' },
  });

  const customer = await prisma.customer.create({ data: {} });
  // Created directly, not via the register_customer RPC — see
  // appointment.test.ts's identical note: the RPC also writes a Consent
  // row, and consents_revoke_only blocks DELETE unconditionally (by
  // design), which would leave this fixture's business un-deletable.
  const membership = await prisma.membership.create({
    data: { customerId: customer.id, businessId: business.id, shortCode: `ISO-${label}-${Date.now()}` },
  });

  const product = await prisma.product.create({
    data: { businessId: business.id, name: `${label} Product`, price: 100 },
  });
  await prisma.inventoryItem.create({
    data: { businessId: business.id, productId: product.id, quantity: 10 },
  });

  const service = await prisma.service.create({
    data: { businessId: business.id, name: `${label} Service`, price: 150, duration: 30 },
  });

  const staff = await prisma.businessStaff.create({
    data: {
      businessId: business.id,
      email: `isolation-test-${label}-${Date.now()}@example.com`,
      passwordHash: "not-a-real-hash",
      firstName: label,
      lastName: "Staff",
    },
  });

  const order = await prisma.order.create({
    data: {
      businessId: business.id,
      membershipId: membership.id,
      orderNumber: `ISO-${label}-${Date.now()}`,
      subtotal: 100,
      total: 100,
      items: { create: [{ productId: product.id, name: product.name, quantity: 1, unitPrice: 100, total: 100 }] },
    },
  });

  const appointment = await prisma.appointment.create({
    data: {
      businessId: business.id,
      membershipId: membership.id,
      serviceId: service.id,
      status: "SCHEDULED",
      startTime: new Date(Date.now() + 24 * 60 * 60 * 1000),
      endTime: new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000),
      duration: 30,
      price: 150,
    },
  });

  return { business, customer, membership, product, service, staff, order, appointment };
}

// ONE set of root hooks for the whole file. Root-level hooks registered in
// two places (this suite and the RPC suite below) don't run as a sequence
// you can rely on: the RPC suite's TRUNCATE could land while these fixtures
// were still being created, failing every test with a foreign-key error.
// So: reset, then build fixtures; and reset once at the very end.
test.before(async () => {
  await resetTestDb();
  const a = await makeFixtures("A");
  const b = await makeFixtures("B");
  bizA = a.business; productA = a.product; serviceA = a.service; orderA = a.order;
  appointmentA = a.appointment; staffA = a.staff;
  bizB = b.business; productB = b.product; serviceB = b.service; orderB = b.order;
  appointmentB = b.appointment; staffB = b.staff;
});

test.after(async () => {
  await resetTestDb();
  await testDb.$disconnect();
});

// ---------------------------------------------------------------------------
// Positive control — A must still be able to read/act on its OWN
// resources. Without this, every "A cannot touch B's X" test below could
// be trivially passing because the lookup is broken for everyone, not
// because isolation actually holds.
// ---------------------------------------------------------------------------

test("positive control: A can read its own product/service/order/appointment, and act on its own staff", async () => {
  assert.equal((await catalog.getActiveProduct(bizA.id, productA.id))?.id, productA.id);
  assert.equal((await catalog.getActiveService(bizA.id, serviceA.id))?.id, serviceA.id);
  assert.equal((await orders.getOrder(bizA.id, orderA.id))?.id, orderA.id);
  assert.equal((await appointments.getAppointment(bizA.id, appointmentA.id))?.id, appointmentA.id);
  assert.ok((await staffSvc.listStaff(bizA.id)).some((s) => s.id === staffA.id));
});

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

test("catalog: A cannot read B's product/service through the active-catalog lookups", async () => {
  assert.equal(await catalog.getActiveProduct(bizA.id, productB.id), null);
  assert.equal(await catalog.getActiveService(bizA.id, serviceB.id), null);
});

test("catalog: A cannot update B's product", async () => {
  await assert.rejects(
    catalog.updateProduct(bizA.id, productB.id, { name: "hacked by A" }),
    /Product not found/,
  );
  const stillB = await prisma.product.findUniqueOrThrow({ where: { id: productB.id } });
  assert.equal(stillB.name, "B Product");
});

test("catalog: A cannot deactivate or delete B's product", async () => {
  await assert.rejects(catalog.setProductActive(bizA.id, productB.id, false), /Product not found/);
  await assert.rejects(catalog.deleteProduct(bizA.id, productB.id), /Product not found/);
  const stillExists = await prisma.product.findUnique({ where: { id: productB.id } });
  assert.ok(stillExists, "B's product must still exist");
  assert.equal(stillExists?.isActive, true);
});

test("catalog: A cannot update or delete B's service", async () => {
  await assert.rejects(
    catalog.updateService(bizA.id, serviceB.id, { name: "hacked by A" }),
    /Service not found/,
  );
  await assert.rejects(catalog.deleteService(bizA.id, serviceB.id), /Service not found/);
  const stillExists = await prisma.service.findUnique({ where: { id: serviceB.id } });
  assert.ok(stillExists, "B's service must still exist");
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

test("orders: A cannot read B's order", async () => {
  assert.equal(await orders.getOrder(bizA.id, orderB.id), null);
});

test("orders: A cannot mark B's order paid or cancel it", async () => {
  await assert.rejects(orders.recordInPersonPayment(bizA.id, orderB.id, "CASH"), /not awaiting payment/);
  await assert.rejects(orders.cancelOrder(bizA.id, orderB.id, { reason: "OTHER", detail: "cross-tenant probe" }), /Order not found/);
  const stillB = await prisma.order.findUniqueOrThrow({ where: { id: orderB.id } });
  assert.equal(stillB.paymentStatus, "PENDING");
  assert.equal(stillB.status, "PENDING");
});

// ---------------------------------------------------------------------------
// Appointments
// ---------------------------------------------------------------------------

test("appointments: A cannot read B's appointment", async () => {
  assert.equal(await appointments.getAppointment(bizA.id, appointmentB.id), null);
});

test("appointments: A cannot complete or cancel B's appointment", async () => {
  await assert.rejects(appointments.completeAppointment(bizA.id, appointmentB.id), /Appointment not found/);
  await assert.rejects(appointments.cancelAppointment(bizA.id, appointmentB.id), /Appointment not found/);
  const stillB = await prisma.appointment.findUniqueOrThrow({ where: { id: appointmentB.id } });
  assert.equal(stillB.status, "SCHEDULED");
});

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

test("inventory: A cannot adjust B's stock", async () => {
  await assert.rejects(
    inventory.adjustStock(bizA.id, { productId: productB.id, quantity: -5, type: "SALE" }),
    /No inventory record/,
  );
  const stillB = await prisma.inventoryItem.findUniqueOrThrow({ where: { productId: productB.id } });
  assert.equal(stillB.quantity, 10, "B's stock must be untouched by A's attempt");
});

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

test("staff: A's staff listing never includes B's staff", async () => {
  const list = await staffSvc.listStaff(bizA.id);
  assert.ok(!list.some((s) => s.id === staffB.id));
});

test("staff: A cannot deactivate or reinvite B's staff member", async () => {
  await assert.rejects(staffSvc.setStaffActive(bizA.id, staffB.id, false), /Team member not found/);
  await assert.rejects(staffSvc.reinviteStaff(bizA.id, staffB.id), /Team member not found/);
  const stillB = await prisma.businessStaff.findUniqueOrThrow({ where: { id: staffB.id } });
  assert.equal(stillB.isActive, true);
});

// ---------------------------------------------------------------------------
// Loyalty RPCs (identity_rpcs.sql) — pairing check lives in the SQL
// functions themselves, exercised here directly against the isolated
// testDb, same style as loyalty.test.ts.
// ---------------------------------------------------------------------------

interface RegisterResult {
  public_id: string;
  short_code: string;
}

async function rpcMakeBusiness(slug: string) {
  return testDb.business.create({ data: { name: `RPC Isolation ${slug}`, slug } });
}

async function rpcRegister(businessId: string, phone: string): Promise<RegisterResult> {
  const rows = await testDb.$queryRaw<{ result: RegisterResult }[]>`
    SELECT register_customer(${businessId}::uuid, ${phone}, NULL, 'test', NULL, NULL) AS result`;
  return rows[0].result;
}

// (Setup and teardown for this section are the file's single root hooks above.)

test("loyalty RPCs: log_visit rejects a member's public_id paired with the WRONG business_id", async () => {
  const rpcBizA = await rpcMakeBusiness(`rpc-iso-a-${Date.now()}`);
  const rpcBizB = await rpcMakeBusiness(`rpc-iso-b-${Date.now()}`);
  const memberB = await rpcRegister(rpcBizB.id, "+27821000010");

  await assert.rejects(
    testDb.$queryRaw`SELECT log_visit(${rpcBizA.id}::uuid, ${memberB.public_id}::uuid, 'stamp', NULL, NULL) AS result`,
    /membership_not_found/,
  );
});

test("loyalty RPCs: redeem_reward rejects a member's public_id paired with the WRONG business_id", async () => {
  const rpcBizA = await rpcMakeBusiness(`rpc-iso-c-${Date.now()}`);
  const rpcBizB = await rpcMakeBusiness(`rpc-iso-d-${Date.now()}`);
  const memberB = await rpcRegister(rpcBizB.id, "+27821000011");
  // Give B's member enough stamps in B's business that a leak would
  // actually be exploitable, not merely untested.
  await testDb.$queryRaw`SELECT log_visit(${rpcBizB.id}::uuid, ${memberB.public_id}::uuid, 'stamp', NULL, NULL)`;

  await assert.rejects(
    testDb.$queryRaw`SELECT redeem_reward(${rpcBizA.id}::uuid, ${memberB.public_id}::uuid, NULL, NULL) AS result`,
    /membership_not_found/,
  );
});

test("loyalty RPCs: lookup_membership finds nothing when the phone belongs to a member of a DIFFERENT business", async () => {
  const rpcBizA = await rpcMakeBusiness(`rpc-iso-e-${Date.now()}`);
  const rpcBizB = await rpcMakeBusiness(`rpc-iso-f-${Date.now()}`);
  await rpcRegister(rpcBizB.id, "+27821000012");

  const rows = await testDb.$queryRaw<{ result: unknown }[]>`
    SELECT lookup_membership(${rpcBizA.id}::uuid, '+27821000012', NULL, NULL) AS result`;
  assert.equal(rows[0].result, null);
});

test("storefront-theme.ts: setStorefrontConfig(bizA) never affects bizB's stored settings", async () => {
  const { setStorefrontConfig, getStorefrontConfig } = await import("@/modules/tenant/storefront-theme");

  const before = await prisma.business.findUniqueOrThrow({ where: { id: bizB.id }, select: { settings: true } });
  const beforeConfig = getStorefrontConfig({ settings: before.settings });

  await setStorefrontConfig(bizA.id, { theme: { presetId: "PLAYFUL", heroMode: "IMAGE" }, profile: { goal: "ORDERS" } });

  const afterA = await prisma.business.findUniqueOrThrow({ where: { id: bizA.id }, select: { settings: true } });
  const afterB = await prisma.business.findUniqueOrThrow({ where: { id: bizB.id }, select: { settings: true } });

  const configA = getStorefrontConfig({ settings: afterA.settings });
  assert.equal(configA.theme.presetId, "PLAYFUL");

  const configBAfter = getStorefrontConfig({ settings: afterB.settings });
  assert.deepEqual(configBAfter, beforeConfig, "business B's storefront config must be byte-for-byte unchanged");
});
