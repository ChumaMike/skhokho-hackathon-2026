import test from "node:test";
import assert from "node:assert/strict";
import { TERMS_VERSION } from "@/lib/legal/documents";
import { prisma } from "@/lib/prisma/client";
import { resetTestDb, testDb } from "@/lib/testing/db";
import { hashPassword, signToken, COOKIE_NAME } from "@/modules/auth/auth.service";
import { startAppServer, cookies, type AppServer } from "@/lib/testing/http-server";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { createProduct } from "@/modules/catalog/catalog.service";
import { setBusinessCapabilities, setDeliverySettings, setFulfilmentSettings, setOrderingPause } from "@/modules/tenant/capabilities";
import { createZone } from "@/modules/delivery/zones.service";
import { inviteStaff } from "@/modules/staff/staff.service";
import { ALL_FLAGS_ON, TEST_LEGAL_ENV } from "@/modules/skhokholetha/testing";

/**
 * Merchant operations over real HTTP: the public checkout API's server-side
 * enforcement (fulfilment, pause, zones, client-supplied fees), the hardened
 * tracking endpoint, and what each role sees on the orders / hours screens.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const STOREFRONT = "skhokholabs.app";
const PICKUP = { lat: -26.2485, lng: 27.854 };
const C = COOKIE_NAME;
let app: AppServer;
const f: Record<string, string> = {};
const t: Record<string, string> = {};
const ip = (fixed?: string) => ({ "x-real-ip": fixed ?? `10.66.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
const json = (body: unknown, headers: Record<string, string> = {}) => ({ body: JSON.stringify(body), headers: { "content-type": "application/json", ...ip(), ...headers } });

async function shop(label: string) {
  // As /api/platform/join does: the owner's AppUser first, then the business.
  const email = `http-ops-${label}-${run}@example.test`;
  const owner = await prisma.appUser.create({ data: { email, role: "OWNER", passwordHash: await hashPassword("SomePassword123") }, select: { id: true, email: true } });
  const { business } = await createBusiness({
    name: `HTTP Ops ${label} ${run}`,
    category: "FOOD_VENDOR" as never,
    owner: { firstName: "Owner", lastName: label, email: `http-ops-${label}-${run}@example.test`, passwordHash: await hashPassword("SomePassword123") },
  });
  await setBusinessCapabilities(business.id, ["PRODUCTS", "ORDERS"] as never);
  const row = await prisma.business.update({ where: { id: business.id }, data: { status: "ACTIVE", latitude: PICKUP.lat, longitude: PICKUP.lng, ownerUserId: owner.id }, select: { id: true, slug: true } });
  const product = await createProduct(business.id, { name: `Kota ${label}`, price: 40 } as never);
  const ownerToken = await signToken({ type: "staff", staffId: owner.id, tenantId: business.id, email: owner.email, isOwner: true });
  return { id: business.id, slug: row.slug, productId: product.id, ownerToken };
}

test.before(async () => {
  await resetTestDb();
  const A = await shop("a");
  const B = await shop("b");
  // A prices by area; B is a different merchant with its own area.
  await setDeliverySettings(A.id, { enabled: true, pricingMode: "ZONE", feeCents: 0 });
  await setDeliverySettings(B.id, { enabled: true, pricingMode: "ZONE", feeCents: 0 });
  const zoneA = await createZone(A.id, { name: "Near A", feeCents: 2000 });
  const zoneB = await createZone(B.id, { name: "Near B", feeCents: 100 });
  // A kitchen worker on A (preset role, real invite path).
  const kitchen = await inviteStaff(A.id, { firstName: "Kay", lastName: "Kitchen", email: `http-ops-kitchen-${run}@example.test`, preset: "KITCHEN" } as never);
  const kitchenRow = await prisma.businessStaff.findFirstOrThrow({ where: { businessId: A.id, email: `http-ops-kitchen-${run}@example.test` }, select: { id: true } });
  void kitchen;
  Object.assign(f, { A: A.id, B: B.id, slugA: A.slug, slugB: B.slug, productA: A.productId, zoneA: zoneA.id, zoneB: zoneB.id });
  Object.assign(t, {
    ownerA: A.ownerToken,
    ownerB: B.ownerToken,
    kitchenA: await signToken({ type: "staff", staffId: kitchenRow.id, tenantId: A.id, email: `http-ops-kitchen-${run}@example.test`, isOwner: false }),
  });
  app = await startAppServer({ ...ALL_FLAGS_ON, ...TEST_LEGAL_ENV, STOREFRONT_DOMAIN: STOREFRONT });
});

test.after(async () => {
  await app?.stop();
  await resetTestDb();
  await testDb.$disconnect();
});

const checkoutBody = (over: Record<string, unknown>) => ({
  businessId: f.A,
  lines: [{ productId: f.productA, quantity: 2 }],
  fulfilmentMethod: "DELIVERY",
  deliveryAddress: "12 Vilakazi St, Orlando West",
  deliveryZoneId: f.zoneA,
  phone: "082 123 4567",
  consent: true,
  termsVersion: TERMS_VERSION,
  idempotencyKey: `k-${run}-${Math.random().toString(36).slice(2)}`,
  ...over,
});

test("checkout API: another merchant's zone → OUTSIDE_SERVICE_AREA; no zone → area required; nothing is created", async () => {
  const r1 = await app.request("POST", "/api/store/checkout", json(checkoutBody({ deliveryZoneId: f.zoneB })));
  assert.equal(JSON.parse(r1.body).code, "OUTSIDE_SERVICE_AREA");
  const r2 = await app.request("POST", "/api/store/checkout", json(checkoutBody({ deliveryZoneId: undefined })));
  assert.equal(JSON.parse(r2.body).code, "DELIVERY_AREA_REQUIRED");
  assert.equal(await prisma.order.count({ where: { businessId: f.A } }), 0);
});

test("checkout API: a client-supplied fee or total is never trusted — the server's zone fee is what gets charged", async () => {
  const lied = await app.request("POST", "/api/store/checkout", json(checkoutBody({ deliveryFee: "0.01", expectedTotal: "80.01" })));
  assert.equal(JSON.parse(lied.body).code, "CART_CHANGED", "a stale/forged total forces a re-review");
  const ok = await app.request("POST", "/api/store/checkout", json(checkoutBody({ deliveryFee: "0.01", expectedTotal: "100.00", email: `cust-${run}@example.test`, notes: "no onions" })));
  const body = JSON.parse(ok.body);
  assert.equal(body.ok, true, ok.body);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: body.orderId }, include: { delivery: true } });
  assert.equal(Number(order.deliveryFee), 20, "R20 from the zone, not the client's 1c");
  assert.equal(Number(order.total), 100);
  assert.deepEqual([order.delivery?.deliveryFeeCents, order.delivery?.deliveryZoneName], [2000, "Near A"]);
  assert.equal(order.notes, "no onions");
  assert.equal(order.termsVersion, TERMS_VERSION, "the accepted Terms version is recorded on the order");
  assert.equal((order.metadata as { notifyEmail?: string })?.notifyEmail, `cust-${run}@example.test`);
  assert.match(body.deliveryUrl, /\/delivery\//, "the customer gets their own delivery page");
  f.orderA = order.id;
  f.orderNumberA = order.orderNumber;
});

test("checkout API: collection off → COLLECTION_UNAVAILABLE; paused → ORDERS_PAUSED; delivery off → DELIVERY_UNAVAILABLE", async () => {
  await setFulfilmentSettings(f.A, { collectionEnabled: false, deliverySources: "BOTH" });
  const c = await app.request("POST", "/api/store/checkout", json(checkoutBody({ fulfilmentMethod: "COLLECTION", deliveryAddress: undefined, deliveryZoneId: undefined })));
  assert.equal(JSON.parse(c.body).code, "COLLECTION_UNAVAILABLE");
  await setFulfilmentSettings(f.A, { collectionEnabled: true, deliverySources: "BOTH" });

  await setOrderingPause(f.A, new Date(Date.now() + 10 * 60_000));
  const p = await app.request("POST", "/api/store/checkout", json(checkoutBody({})));
  assert.equal(JSON.parse(p.body).code, "ORDERS_PAUSED");
  const page = await app.request("GET", `/store/${f.slugA}`, { headers: ip() });
  assert.match(page.body, /ORDERS PAUSED/, "the storefront shows the paused state");
  await setOrderingPause(f.A, null);

  await setDeliverySettings(f.A, { enabled: false, pricingMode: "ZONE", feeCents: 0 });
  const d = await app.request("POST", "/api/store/checkout", json(checkoutBody({})));
  assert.equal(JSON.parse(d.body).code, "DELIVERY_UNAVAILABLE");
  await setDeliverySettings(f.A, { enabled: true, pricingMode: "ZONE", feeCents: 0 });
  assert.equal(await prisma.order.count({ where: { businessId: f.A } }), 1, "none of those created an order");
});

test("storefront: delivery areas and fees render from configuration; checkout shows the real payment path", async () => {
  const home = await app.request("GET", `/store/${f.slugA}`, { headers: ip() });
  assert.equal(home.status, 200);
  assert.match(home.body, /Near A/);
  assert.match(home.body, /R 20\.00/);
  assert.match(home.body, /OPEN/);
  const checkout = await app.request("GET", `/store/${f.slugA}/checkout`, { headers: ip() });
  assert.equal(checkout.status, 200);
  // The prop travels in the RSC payload, where the JSON quotes are escaped: \"paymentOptions\":{\"card\":false,\"inPerson\":true}
  assert.match(checkout.body, /paymentOptions\\":\{\\"card\\":false,\\"inPerson\\":true\}/, "no verified LIVE PayFast connection → pay in person only");
  // A verified LIVE connection opens card — and, with nothing restricted, keeps in person: the customer chooses.
  await prisma.businessPaymentConnection.create({ data: { businessId: f.A, provider: "PAYFAST", environment: "LIVE", merchantId: "10000100", merchantKeyCipher: "v1.test", passphraseCipher: "v1.test", keyVersion: 1, status: "VERIFIED", verifiedAt: new Date() } });
  const online = await app.request("GET", `/store/${f.slugA}/checkout`, { headers: ip() });
  assert.match(online.body, /paymentOptions\\":\{\\"card\\":true,\\"inPerson\\":true\}/);
});

test("tracking API: unknown and cross-tenant-host ids → 404 with no body detail; same-tenant works; rate limited per IP", async () => {
  const unknown = await app.request("GET", "/api/orders/abcdefghijklmnopqrstuvwx/tracking", { headers: ip() });
  assert.equal(unknown.status, 404);
  assert.equal((await app.request("GET", "/api/orders/not-an-id/tracking", { headers: ip() })).status, 404);
  const mine = await app.request("GET", `/api/orders/${f.orderA}/tracking`, { headers: ip() });
  assert.equal(mine.status, 200);
  const data = JSON.parse(mine.body).data;
  assert.equal(data.deliveryStatus, "UNASSIGNED");
  assert.equal("failureReason" in data, false, "no free-text reason in the poll payload");
  assert.equal(data.driverLat, null, "no driver position unless the order is out");
  // On tenant B's own hostname, tenant A's order does not exist.
  const cross = await app.request("GET", `/api/orders/${f.orderA}/tracking`, { headers: { host: `${f.slugB}.${STOREFRONT}:${app.port}`, ...ip() } });
  assert.equal(cross.status, 404);
  // 120/min per IP.
  // 120 per 60 s window per IP — fire them in parallel so they land in one window.
  // Start at the top of a fresh 60 s window so every request lands in the same bucket.
  const intoWindow = Date.now() % 60_000;
  if (intoWindow > 25_000) await new Promise((r) => setTimeout(r, 60_000 - intoWindow + 200));
  const fixed = `10.99.1.${Math.floor(Math.random() * 250)}`;
  const batch = async (n: number) => Promise.all(Array.from({ length: n }, () => app.request("GET", `/api/orders/${f.orderA}/tracking`, { headers: ip(fixed) })));
  const results: Awaited<ReturnType<typeof app.request>>[] = [];
  for (let i = 0; i < 7; i++) results.push(...(await batch(20)));
  const limited = results.filter((r) => r.status === 429);
  assert.ok(limited.length >= 1, `the tracking rate limit trips (statuses: ${[...new Set(results.map((r) => r.status))].join(",")}, took ${Date.now() % 60_000 - intoWindow} ms)`);
  assert.ok(limited[0].headers["retry-after"]);
});

test("orders screen: the owner sees payment state and the customer's details; tenant B never sees A's order; kitchen is kept to its own view", async () => {
  const a = await app.request("GET", "/dashboard/orders", { headers: { ...cookies({ [C.staff]: t.ownerA }), ...ip() } });
  assert.equal(a.status, 200);
  assert.ok(a.body.includes(f.orderNumberA));
  assert.match(a.body, /Not paid yet/, "payment status is displayed");
  assert.match(a.body, /no onions/, "the customer's note is displayed");
  assert.match(a.body, /Pause orders/, "pause control on the queue");
  const b = await app.request("GET", "/dashboard/orders", { headers: { ...cookies({ [C.staff]: t.ownerB }), ...ip() } });
  assert.equal(b.status, 200);
  assert.equal(b.body.includes(f.orderNumberA), false);
  const k = await app.request("GET", "/dashboard/orders", { headers: { ...cookies({ [C.staff]: t.kitchenA }), ...ip() } });
  assert.match(k.body, /doesn.t have permission/, "kitchen cannot open the management queue (where cancel lives)");
  assert.equal(k.body.includes("Cancel</button>"), false);
  const kitchen = await app.request("GET", "/dashboard/kitchen", { headers: { ...cookies({ [C.staff]: t.kitchenA }), ...ip() } });
  assert.equal(kitchen.status, 200);
  assert.equal(kitchen.body.includes("082 123 4567"), false, "kitchen never sees the customer's phone");
  assert.equal(kitchen.body.includes("Vilakazi"), false, "kitchen never sees the address");
});

test("hours: staff without settings permission can see but not edit; the pulse endpoint is permission-scoped", async () => {
  const k = await app.request("GET", "/dashboard/settings/hours", { headers: { ...cookies({ [C.staff]: t.kitchenA }), ...ip() } });
  assert.equal(k.status, 200);
  assert.match(k.body, /ask the business owner/);
  assert.equal(k.body.includes("Save hours"), false);
  const o = await app.request("GET", "/dashboard/settings/hours", { headers: { ...cookies({ [C.staff]: t.ownerA }), ...ip() } });
  assert.match(o.body, /Save hours/);
  const pulseOwner = await app.request("GET", "/api/dashboard/pulse", { headers: { ...cookies({ [C.staff]: t.ownerA }), ...ip() } });
  assert.equal(pulseOwner.status, 200);
  assert.equal(JSON.parse(pulseOwner.body).pendingOrders, 1);
  const pulseAnon = await app.request("GET", "/api/dashboard/pulse", { headers: ip() });
  assert.equal(pulseAnon.status, 401);
  const pulseB = await app.request("GET", "/api/dashboard/pulse", { headers: { ...cookies({ [C.staff]: t.ownerB }), ...ip() } });
  assert.equal(JSON.parse(pulseB.body).pendingOrders, 0, "tenant-scoped counts");
});
