import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { clearHostnameCache, PLATFORM_DOMAIN } from "./context";
import { basePathFor, orderVisibleOnRequest, hostTenantConflict, apiRequestTenant } from "./storefront-request";
import { POST as quotePOST } from "@/app/api/store/checkout/quote/route";
import { GET as availabilityGET } from "@/app/api/store/availability/route";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("basePathFor: no prefix only on the business's own host", () => {
  assert.equal(basePathFor("kota", { id: "1", slug: "kota" }), "");
  assert.equal(basePathFor("kota", null), "/store/kota");
  // A mismatch can never yield a working cross-tenant link: the explicit
  // prefix is 404'd by middleware on a foreign tenant host.
  assert.equal(basePathFor("kota", { id: "2", slug: "other" }), "/store/kota");
});

test("orderVisibleOnRequest: a tenant host only sees its own orders; the platform host sees any", () => {
  assert.equal(orderVisibleOnRequest("biz-a", { id: "biz-a", slug: "a" }), true);
  assert.equal(orderVisibleOnRequest("biz-b", { id: "biz-a", slug: "a" }), false);
  assert.equal(orderVisibleOnRequest("biz-b", null), true);
});

// ---------------------------------------------------------------------------
// API routes: a tenant host may only act on its own business
// ---------------------------------------------------------------------------

const STOREFRONT = "skhokholabs.app";
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const previousStorefront = process.env.STOREFRONT_DOMAIN;
let A: { id: string; slug: string };
let B: { id: string; slug: string };
let serviceB: { id: string };

test.before(async () => {
  process.env.STOREFRONT_DOMAIN = STOREFRONT;
  A = await prisma.business.create({ data: { name: "API A", slug: `api-a-${run}`, status: "ACTIVE" }, select: { id: true, slug: true } });
  B = await prisma.business.create({ data: { name: "API B", slug: `api-b-${run}`, status: "ACTIVE" }, select: { id: true, slug: true } });
  serviceB = await prisma.service.create({
    data: { businessId: B.id, name: "Braids", price: 100, duration: 60, isActive: true },
    select: { id: true },
  });
});

test.after(async () => {
  clearHostnameCache();
  if (previousStorefront === undefined) delete process.env.STOREFRONT_DOMAIN;
  else process.env.STOREFRONT_DOMAIN = previousStorefront;
  await prisma.service.deleteMany({ where: { businessId: { in: [A.id, B.id] } } });
  await prisma.business.deleteMany({ where: { id: { in: [A.id, B.id] } } });
});

test.beforeEach(clearHostnameCache);

function hostRequest(host: string, url = "/api/store/x", init: { method?: string; body?: string } = {}) {
  return new NextRequest(`https://${host}${url}`, { ...init, headers: { host, "content-type": "application/json" } });
}

test("hostTenantConflict: A's host + B's businessId is refused; A's own is allowed", async () => {
  assert.equal(await hostTenantConflict(hostRequest(`${A.slug}.${STOREFRONT}`), B.id), true);
  assert.equal(await hostTenantConflict(hostRequest(`${A.slug}.${STOREFRONT}`), A.id), false);
});

test("hostTenantConflict: the platform host (legacy /store/<slug> pages) is unchanged", async () => {
  assert.equal(await hostTenantConflict(hostRequest(PLATFORM_DOMAIN), B.id), false);
  assert.equal(await apiRequestTenant(hostRequest(PLATFORM_DOMAIN)), null);
});

test("hostTenantConflict: a spoofed Host for an unknown business gives no tenant to bind to", async () => {
  assert.equal(await apiRequestTenant(hostRequest(`nobody-${run}.${STOREFRONT}`)), null);
});

test("/api/store/checkout/quote on A's host refuses B's businessId", async () => {
  const body = JSON.stringify({ businessId: B.id, lines: [{ productId: "p1", quantity: 1, optionIds: [] }] });
  const res = await quotePOST(hostRequest(`${A.slug}.${STOREFRONT}`, "/api/store/checkout/quote", { method: "POST", body }));
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.equal(json.code, "BUSINESS_UNAVAILABLE");
});

test("/api/store/availability: B's service is invisible through A's host but visible through B's", async () => {
  const query = `?businessId=${B.id}&serviceId=${serviceB.id}&date=2030-01-07`;
  const viaA = await availabilityGET(hostRequest(`${A.slug}.${STOREFRONT}`, `/api/store/availability${query}`));
  assert.equal(viaA.status, 404);

  const viaB = await availabilityGET(hostRequest(`${B.slug}.${STOREFRONT}`, `/api/store/availability${query}`));
  assert.equal(viaB.status, 200);
});
