import test from "node:test";
import assert from "node:assert/strict";
import { CreateOrderSchema } from "@/modules/orders/order.service";
import { CreateAppointmentSchema } from "@/modules/appointments/appointment.service";
import { TERMS_VERSION } from "./documents";

/**
 * Pure schema checks (no database): the service layers accept the Terms
 * version the routes verified, keep it optional for POS / console callers,
 * and refuse anything that is not a version-shaped string.
 */
const orderBase = {
  membershipId: "00000000-0000-4000-8000-000000000001",
  source: "online" as const,
  items: [{ productId: "p1", name: "Kota", quantity: 1, unitPrice: 35, discount: 0 }],
};

test("terms acceptance: orders carry the accepted version when given, and none for POS", () => {
  const online = CreateOrderSchema.parse({ ...orderBase, termsVersion: TERMS_VERSION });
  assert.equal(online.termsVersion, TERMS_VERSION);
  const pos = CreateOrderSchema.parse({ ...orderBase, source: "pos" });
  assert.equal(pos.termsVersion, undefined);
  assert.throws(() => CreateOrderSchema.parse({ ...orderBase, termsVersion: "has spaces in it" }));
  assert.throws(() => CreateOrderSchema.parse({ ...orderBase, termsVersion: "x".repeat(41) }));
});

test("terms acceptance: appointments carry the accepted version when given", () => {
  const base = { membershipId: "00000000-0000-4000-8000-000000000001", serviceId: "s1", startTime: new Date("2030-01-01T09:00:00Z") };
  assert.equal(CreateAppointmentSchema.parse({ ...base, termsVersion: TERMS_VERSION }).termsVersion, TERMS_VERSION);
  assert.equal(CreateAppointmentSchema.parse(base).termsVersion, undefined);
  assert.throws(() => CreateAppointmentSchema.parse({ ...base, termsVersion: "" }));
});
