import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { resetTestDb, testDb } from "@/lib/testing/db";
import { withRequestScope } from "@/lib/testing/request-scope";
import { POST as checkout } from "@/app/api/store/checkout/route";
import { POST as book } from "@/app/api/store/book/route";
import { hashPassword } from "@/modules/auth/auth.service";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { setBusinessCapabilities } from "@/modules/tenant/capabilities";
import { createProduct } from "@/modules/catalog/catalog.service";
import { __setEmailTransportForTests } from "@/lib/email";
import { TERMS_VERSION, TERMS_OUTDATED_MESSAGE } from "./documents";

/** The handlers, called in-process but with the request scope `after()` needs (see request-scope.ts). */
const checkoutIn = (req: NextRequest) => withRequestScope(() => checkout(req));
const bookIn = (req: NextRequest) => withRequestScope(() => book(req));

/**
 * Terms acceptance against a real database, through the two public routes a
 * customer actually uses. What is proven:
 *
 *  - a checkout that shows the CURRENT Terms version stores that version and
 *    the acceptance time on the order (orders.terms_version /
 *    terms_accepted_at — migration 20261022090002);
 *  - a booking does the same on the appointment;
 *  - a page opened before a Terms bump (stale version, or none at all) is
 *    refused with TERMS_OUTDATED at checkout and sent back with the same
 *    message at booking, and nothing is written.
 *
 * The version string travels as data (a hidden field / JSON field), so the
 * tests post it exactly as the storefront does rather than calling the
 * services directly — the services only record what the routes verified.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const STALE_VERSION = "v0.0-draft-2026-01-01";
const phone = () => `082${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
const ip = () => `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

function jsonRequest(body: unknown) {
  return new NextRequest("https://app.example.test/api/store/checkout", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": ip() },
  });
}

function formRequest(fields: Record<string, string>) {
  return new NextRequest("https://app.example.test/api/store/book", {
    method: "POST",
    body: new URLSearchParams(fields).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip() },
  });
}

/** A shop that can take a collection order right now: active, with Orders on and one product. */
async function makeShop(label: string) {
  const { business } = await createBusiness({
    name: `Terms Test ${label} ${run}`,
    category: "RETAIL_STORE" as never,
    owner: { firstName: "Owner", lastName: label, email: `terms-${label}-${run}@example.test`, passwordHash: await hashPassword("SomePassword123") },
  });
  await setBusinessCapabilities(business.id, ["PRODUCTS", "ORDERS", "BOOKINGS"] as never);
  await prisma.business.update({ where: { id: business.id }, data: { status: "ACTIVE", latitude: -26.2485, longitude: 27.854 } });
  const product = await createProduct(business.id, { name: `Thing ${label}`, price: 50 } as never);
  const service = await prisma.service.create({ data: { businessId: business.id, name: "Cut", price: 100, duration: 30, isActive: true }, select: { id: true } });
  return { id: business.id, productId: product.id, serviceId: service.id };
}

function checkoutBody(shop: { id: string; productId: string }, over: Record<string, unknown>) {
  return {
    businessId: shop.id,
    lines: [{ productId: shop.productId, quantity: 1 }],
    fulfilmentMethod: "COLLECTION",
    phone: phone(),
    name: "Thandi",
    consent: true,
    idempotencyKey: `idem-${run}-${Math.random().toString(36).slice(2)}`,
    ...over,
  };
}

function bookingFields(shop: { id: string; serviceId: string }, over: Record<string, string>) {
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  start.setUTCHours(8, 0, 0, 0);
  return {
    businessId: shop.id,
    serviceId: shop.serviceId,
    phone: phone(),
    startTime: start.toISOString(),
    returnTo: "/book",
    consent: "on",
    ...over,
  };
}

test.before(async () => {
  await resetTestDb();
  __setEmailTransportForTests(async () => ({ id: "test" }));
});
test.after(async () => {
  __setEmailTransportForTests(null);
  await resetTestDb();
  await testDb.$disconnect();
});

test("checkout with the current Terms version stores the version and the acceptance time on the order", async () => {
  const shop = await makeShop("checkout-ok");
  const before = Date.now();
  const res = await checkoutIn(jsonRequest(checkoutBody(shop, { termsVersion: TERMS_VERSION })));
  const body = (await res.json()) as { ok: boolean; code?: string; message?: string };
  assert.equal(body.ok, true, JSON.stringify(body));

  const order = await prisma.order.findFirstOrThrow({ where: { businessId: shop.id }, select: { termsVersion: true, termsAcceptedAt: true } });
  assert.equal(order.termsVersion, TERMS_VERSION);
  assert.ok(order.termsAcceptedAt, "terms_accepted_at is set");
  assert.ok(order.termsAcceptedAt!.getTime() >= before - 1000 && order.termsAcceptedAt!.getTime() <= Date.now() + 1000, "accepted at the time of checkout");
});

test("checkout with a stale or missing Terms version is refused with TERMS_OUTDATED and writes nothing", async () => {
  const shop = await makeShop("checkout-stale");
  for (const termsVersion of [STALE_VERSION, undefined]) {
    const res = await checkoutIn(jsonRequest(checkoutBody(shop, { termsVersion })));
    const body = (await res.json()) as { ok: boolean; code?: string; message?: string };
    assert.equal(body.ok, false, `version ${termsVersion}: ${JSON.stringify(body)}`);
    assert.equal(body.code, "TERMS_OUTDATED");
    assert.equal(body.message, TERMS_OUTDATED_MESSAGE);
  }
  assert.equal(await prisma.order.count({ where: { businessId: shop.id } }), 0, "no order was created");
});

test("booking with the current Terms version stores the version and the acceptance time on the appointment", async () => {
  const shop = await makeShop("book-ok");
  const before = Date.now();
  const res = await bookIn(formRequest(bookingFields(shop, { termsVersion: TERMS_VERSION })));
  const location = res.headers.get("location") ?? "";
  assert.match(location, /ok=booking/, `expected a success redirect, got ${location}`);

  const appointment = await prisma.appointment.findFirstOrThrow({ where: { businessId: shop.id }, select: { termsVersion: true, termsAcceptedAt: true } });
  assert.equal(appointment.termsVersion, TERMS_VERSION);
  assert.ok(appointment.termsAcceptedAt, "terms_accepted_at is set");
  assert.ok(appointment.termsAcceptedAt!.getTime() >= before - 1000 && appointment.termsAcceptedAt!.getTime() <= Date.now() + 1000, "accepted at the time of booking");
});

test("booking with a stale or missing Terms version is sent back with the outdated message and writes nothing", async () => {
  const shop = await makeShop("book-stale");
  for (const fields of [{ termsVersion: STALE_VERSION }, {}] as Record<string, string>[]) {
    const res = await bookIn(formRequest(bookingFields(shop, fields)));
    const location = res.headers.get("location") ?? "";
    assert.equal(res.status, 303);
    assert.equal(new URL(location).searchParams.get("err"), TERMS_OUTDATED_MESSAGE, `fields ${JSON.stringify(fields)}: ${location}`);
  }
  assert.equal(await prisma.appointment.count({ where: { businessId: shop.id } }), 0, "no appointment was created");
});
