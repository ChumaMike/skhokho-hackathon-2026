import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { createAppointment, AppointmentConflictError } from "./appointment.service";

/**
 * Unlike loyalty.test.ts (which uses the isolated testDb), this exercises
 * the REAL appointment.service.ts against the real dev database — the
 * app's own `prisma` singleton (from @/lib/prisma/client) is hardcoded
 * inside createAppointment, not dependency-injected, so there's no way to
 * point it at the isolated test database without changing the service's
 * signature. That's a real architectural gap worth closing later
 * (inventory.service.ts's adjustStock already accepts an optional
 * PrismaOrTx client for exactly this reason — appointment.service.ts and
 * customer.service.ts don't), not something to route around silently
 * here. Every fixture this test creates is deleted in `after`, so it
 * doesn't leave residue in the dev database.
 */

let businessId: string;
let membershipId: string;
let staffId: string;

test.before(async () => {
  const business = await prisma.business.create({
    data: { name: "Appointment Concurrency Test Biz", slug: `appt-concurrency-test-${Date.now()}` },
  });
  businessId = business.id;

  const staff = await prisma.businessStaff.create({
    data: {
      businessId,
      email: `appt-test-staff-${Date.now()}@example.com`,
      passwordHash: "not-a-real-hash",
      firstName: "Test",
      lastName: "Staff",
    },
  });
  staffId = staff.id;

  // Created directly via Prisma, NOT the register_customer RPC: that RPC
  // also writes a Consent row, and consents_revoke_only's DB trigger
  // blocks DELETE unconditionally (revoke-only, by design — POPIA
  // consent history is permanent). A Membership created this way carries
  // no such trigger and can be cleaned up normally in `after`.
  const customer = await prisma.customer.create({ data: {} });
  const membership = await prisma.membership.create({
    data: { customerId: customer.id, businessId, shortCode: `TST-${Date.now()}` },
  });
  membershipId = membership.id;
});

test.after(async () => {
  const membership = await prisma.membership.findUnique({ where: { id: membershipId } });
  await prisma.appointment.deleteMany({ where: { businessId } });
  await prisma.service.deleteMany({ where: { businessId } });
  await prisma.businessStaff.deleteMany({ where: { businessId } });
  await prisma.membership.delete({ where: { id: membershipId } });
  if (membership) await prisma.customer.delete({ where: { id: membership.customerId } });
  await prisma.business.delete({ where: { id: businessId } });
});

test("createAppointment: two concurrent bookings for the same staff member, overlapping times — exactly one succeeds", async () => {
  const service = await prisma.service.create({
    data: { businessId, name: "Staff Overlap Test Service", price: 100, duration: 30 },
  });
  const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // tomorrow

  const results = await Promise.allSettled([
    createAppointment(businessId, { membershipId, serviceId: service.id, staffId, startTime }),
    createAppointment(businessId, { membershipId, serviceId: service.id, staffId, startTime }),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

  assert.equal(fulfilled.length, 1, "exactly one of the two concurrent bookings must succeed");
  assert.equal(rejected.length, 1, "the other must be rejected as a conflict");
  assert.ok(
    rejected[0].reason instanceof AppointmentConflictError,
    `expected AppointmentConflictError, got ${rejected[0].reason}`,
  );

  const count = await prisma.appointment.count({ where: { businessId, staffId, serviceId: service.id } });
  assert.equal(count, 1, "exactly one appointment row must exist for this staff member/slot");
});

test("createAppointment: two concurrent bookings for a capacity-1 service, no staff — exactly one succeeds", async () => {
  const service = await prisma.service.create({
    data: { businessId, name: "Capacity Test Service", price: 100, duration: 30, maxBookings: 1 },
  });
  const startTime = new Date(Date.now() + 25 * 60 * 60 * 1000);

  const results = await Promise.allSettled([
    createAppointment(businessId, { membershipId, serviceId: service.id, startTime }),
    createAppointment(businessId, { membershipId, serviceId: service.id, startTime }),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

  assert.equal(fulfilled.length, 1, "exactly one of the two concurrent capacity-1 bookings must succeed");
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof AppointmentConflictError);

  const count = await prisma.appointment.count({ where: { businessId, serviceId: service.id } });
  assert.equal(count, 1, "exactly one appointment row must exist — the advisory lock must have serialized these");
});
