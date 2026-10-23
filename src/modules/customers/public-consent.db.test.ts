import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { resetTestDb, testDb } from "@/lib/testing/db";
import { POST as register } from "@/app/api/platform/register/route";
import { POST as book } from "@/app/api/store/book/route";
import { registerCustomer } from "./customer.service";
import { TERMS_VERSION } from "@/lib/legal/documents";

/**
 * B6 — a PUBLIC form can't prove the person owns the phone number, so it
 * must never record marketing / cross-business consent or attach an email to
 * the customer's identity. (Staff adding a customer in person still can.)
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const phone = () => `082${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

function form(url: string, fields: Record<string, string>) {
  return new NextRequest(url, {
    method: "POST",
    body: new URLSearchParams(fields).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` },
  });
}

async function customerIdFor(businessId: string, rawPhone: string) {
  const e164 = `+27${rawPhone.slice(1)}`;
  const rows = await prisma.$queryRaw<{ customer_id: string }[]>`
    SELECT m.customer_id FROM memberships m JOIN customer_identifiers ci ON ci.customer_id = m.customer_id
    WHERE m.business_id = ${businessId}::uuid AND ci.type = 'phone' AND ci.value = ${e164} LIMIT 1`;
  return rows[0]?.customer_id ?? null;
}

async function purposes(customerId: string) {
  return (await prisma.consent.findMany({ where: { customerId }, select: { purpose: true } })).map((c) => c.purpose).sort();
}

test.before(resetTestDb);
test.after(async () => {
  await resetTestDb();
  await testDb.$disconnect();
});

test("loyalty sign-up form ticking 'marketing' and 'link across shops' records neither", async () => {
  const biz = await prisma.business.create({ data: { name: "Consent Shop", slug: `consent-${run}`, status: "ACTIVE" }, select: { id: true, slug: true } });
  const p = phone();
  const res = await register(form("https://app.example.test/api/platform/register", { slug: biz.slug, phone: p, name: "Thandi", marketing: "on", platform: "on" }));
  assert.match(res.headers.get("location") ?? "", /code=/, "still registered for loyalty");
  const cid = await customerIdFor(biz.id, p);
  assert.ok(cid);
  assert.deepEqual(await purposes(cid!), ["loyalty_program"]);
});

test("storefront booking never attaches an email or records marketing consent", async () => {
  const biz = await prisma.business.create({ data: { name: "Booking Shop", slug: `consent-book-${run}`, status: "ACTIVE" }, select: { id: true } });
  const service = await prisma.service.create({ data: { businessId: biz.id, name: "Braids", price: 200, duration: 60, isActive: true }, select: { id: true } });
  const p = phone();
  const start = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  start.setUTCHours(8, 0, 0, 0);
  await book(form("https://app.example.test/api/store/book", {
    businessId: biz.id, serviceId: service.id, phone: p, startTime: start.toISOString(), returnTo: "/",
    email: "attacker@example.test", consent: "on", consentMarketing: "on", termsVersion: TERMS_VERSION,
  }));
  const cid = await customerIdFor(biz.id, p);
  assert.ok(cid, "the booking itself still goes through");
  assert.equal(await prisma.customerIdentifier.count({ where: { customerId: cid!, type: "email" } }), 0, "no email planted on the identity");
  assert.deepEqual(await purposes(cid!), ["loyalty_program"]);
});

test("an existing customer's identity can't be modified by someone typing their number publicly", async () => {
  const biz = await prisma.business.create({ data: { name: "Victim Shop", slug: `consent-victim-${run}`, status: "ACTIVE" }, select: { id: true } });
  const service = await prisma.service.create({ data: { businessId: biz.id, name: "Cut", price: 100, duration: 30, isActive: true }, select: { id: true } });
  const p = phone();
  // The real customer, added in person by staff, with no email on file.
  await registerCustomer(biz.id, p, "Real Customer", "owner_dashboard");
  const cid = await customerIdFor(biz.id, p);

  const start = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
  start.setUTCHours(9, 0, 0, 0);
  await book(form("https://app.example.test/api/store/book", {
    businessId: biz.id, serviceId: service.id, phone: p, startTime: start.toISOString(), returnTo: "/",
    email: "attacker@example.test", consent: "on", consentMarketing: "on", termsVersion: TERMS_VERSION,
  }));
  assert.equal(await prisma.customerIdentifier.count({ where: { customerId: cid!, type: "email" } }), 0);
  assert.deepEqual(await purposes(cid!), ["loyalty_program"]);
});

test("staff adding a customer in person may still record marketing consent", async () => {
  const biz = await prisma.business.create({ data: { name: "Counter Shop", slug: `consent-counter-${run}`, status: "ACTIVE" }, select: { id: true } });
  const p = phone();
  await registerCustomer(biz.id, p, "In Person", "owner_dashboard", undefined, undefined, undefined, true);
  const cid = await customerIdFor(biz.id, p);
  assert.deepEqual(await purposes(cid!), ["loyalty_program", "marketing"]);
});
