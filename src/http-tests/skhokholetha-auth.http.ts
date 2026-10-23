import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { resetTestDb, testDb } from "@/lib/testing/db";
import { signToken, COOKIE_NAME } from "@/modules/auth/auth.service";
import { startAppServer, cookies, type AppServer } from "@/lib/testing/http-server";
import { issueCustomerDeliveryKey } from "@/modules/skhokholetha/customer-key";
import { acceptOffer } from "@/modules/skhokholetha/dispatch.service";
import { confirmPickup, driverStep, getShopDeliveryView, quoteForOrder, requestNetworkDelivery } from "@/modules/skhokholetha/delivery.service";
import { deriveCode } from "@/modules/skhokholetha/codes";
import { ALL_FLAGS_ON, enableLethaForTests, LEGAL_FIELDS_ACCEPTED, TEST_LEGAL_ENV } from "@/modules/skhokholetha/testing";

/**
 * HTTP-level authorization: the real production server, real cookies, real
 * middleware and guards. Fixtures are written to the TEST database from this
 * process; the server reads the same database.
 *
 * Server config: everything on EXCEPT driver sign-up (to prove a switched-off
 * feature can't be reached by a direct request).
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const PICKUP = { lat: -26.2485, lng: 27.854 };
const DROPOFF = { lat: -26.26, lng: 27.87 };
const ip = () => ({ "x-real-ip": `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });

let app: AppServer;
let restoreEnv: () => void;
const t: Record<string, string> = {}; // tokens
const f: Record<string, string> = {}; // fixture ids / values

async function shop(label: string) {
  const owner = await prisma.appUser.create({ data: { email: `http-owner-${label}-${run}@example.test`, role: "OWNER" }, select: { id: true, email: true } });
  const b = await prisma.business.create({
    data: {
      name: `HTTP Shop ${label} ${run}`,
      slug: `http-${label}-${run}`,
      status: "ACTIVE",
      ownerUserId: owner.id,
      latitude: PICKUP.lat,
      longitude: PICKUP.lng,
      settings: { delivery: { enabled: true, pricingMode: "FLAT", feeCents: 3500, perKmFeeCents: 0 } },
    },
    select: { id: true },
  });
  const token = await signToken({ type: "staff", staffId: owner.id, tenantId: b.id, email: owner.email, isOwner: true });
  return { businessId: b.id, ownerId: owner.id, token };
}

async function driver(label: string) {
  const user = await prisma.appUser.create({ data: { email: `http-driver-${label}-${run}@example.test`, role: "DRIVER", emailVerifiedAt: new Date() }, select: { id: true, email: true } });
  const d = await prisma.driverProfile.create({
    data: {
      userId: user.id,
      displayName: `Http Driver ${label}`,
      phone: "+27831234567",
      verificationStatus: "APPROVED",
      availability: "ONLINE",
      locationConsentAt: new Date(),
      ...LEGAL_FIELDS_ACCEPTED(),
      lastLat: PICKUP.lat + 0.003,
      lastLng: PICKUP.lng + 0.003,
      lastLocationAt: new Date(),
      vehicles: { create: { type: "CAR", registration: "GP12345" } },
      documents: {
        create: (["ID_DOCUMENT", "DRIVERS_LICENCE", "VEHICLE_REGISTRATION"] as const).map((kind) => ({
          kind, status: "ACCEPTED", fileName: `${kind}.pdf`, contentType: "application/pdf", sizeBytes: 9, sha256: "x", content: new Uint8Array(Buffer.from("%PDF-1.4\n")),
        })),
      },
    },
    select: { id: true, documents: { select: { id: true }, take: 1 } },
  });
  const token = await signToken({ type: "driver", userId: user.id, driverId: d.id, email: user.email });
  return { driverId: d.id, documentId: d.documents[0].id, token };
}

test.before(async () => {
  restoreEnv = enableLethaForTests();
  await resetTestDb();
  const A = await shop("a");
  const B = await shop("b");
  const dA = await driver("a");
  const dB = await driver("b");
  const admin = await prisma.appUser.create({ data: { email: `http-admin-${run}@example.test`, role: "ADMIN" }, select: { id: true, email: true } });
  // A super admin who has completed MFA enrolment (the session below is what /api/admin/mfa/verify issues).
  await prisma.platformAdmin.create({ data: { userId: admin.id, role: "SUPER_ADMIN", mfaEnabledAt: new Date(), sessionEpoch: 0 } });

  // A delivery for shop A, assigned to driver A, waiting at the customer's door.
  const order = await prisma.order.create({
    data: { businessId: A.businessId, orderNumber: `HT-${run}`, subtotal: 100, total: 135, deliveryFee: 35, status: "READY", paymentStatus: "PAID", fulfilmentMethod: "DELIVERY" },
    select: { id: true },
  });
  const od = await prisma.orderDelivery.create({
    data: { businessId: A.businessId, orderId: order.id, deliveryAddressSnapshot: "3 Http Lane", contactPhone: "+27821112222", deliveryLat: DROPOFF.lat, deliveryLng: DROPOFF.lng },
  });
  const customerKey = await issueCustomerDeliveryKey(od.id);
  const quote = await quoteForOrder(A.businessId, order.id);
  assert.ok(quote.ok, JSON.stringify(quote));
  const { deliveryId } = await requestNetworkDelivery({ businessId: A.businessId, staffId: A.ownerId }, { orderId: order.id, requestKey: `http-${run}`, confirmedFeeCents: quote.quoteFeeCents });
  const offer = await prisma.deliveryOffer.upsert({
    where: { networkDeliveryId_driverId: { networkDeliveryId: deliveryId, driverId: dA.driverId } },
    update: { status: "PENDING", expiresAt: new Date(Date.now() + 120_000) },
    create: { networkDeliveryId: deliveryId, driverId: dA.driverId, distanceMeters: 300, expiresAt: new Date(Date.now() + 120_000) },
  });
  await acceptOffer(dA.driverId, offer.id);
  await driverStep(dA.driverId, deliveryId, "ARRIVE_PICKUP");
  const shopView = await getShopDeliveryView(A.businessId, order.id);
  await confirmPickup(dA.driverId, deliveryId, shopView!.pickupCode!);
  await driverStep(dA.driverId, deliveryId, "ARRIVE_DROPOFF");
  const nd = await prisma.networkDelivery.findUniqueOrThrow({ where: { id: deliveryId } });

  Object.assign(t, {
    staffA: A.token,
    staffB: B.token,
    driverA: dA.token,
    driverB: dB.token,
    admin: await signToken({ type: "platform_admin", adminId: admin.id, platformId: "skhokho", email: admin.email, mfa: true, epoch: 0 }),
    // The same real admin, but a session WITHOUT the MFA step (password only / forged claim).
    adminNoMfa: await signToken({ type: "platform_admin", adminId: admin.id, platformId: "skhokho", email: admin.email }),
    // A platform_admin token minted for someone who isn't an ADMIN (e.g. a leaked/forged role).
    fakeAdmin: await signToken({ type: "platform_admin", adminId: A.ownerId, platformId: "skhokho", email: "owner@example.test", mfa: true, epoch: 0 }),
  });
  Object.assign(f, {
    deliveryId,
    orderNumber: `HT-${run}`,
    documentId: dA.documentId,
    trackingToken: shopView!.trackingToken,
    customerKey,
    dropoffCode: deriveCode("DROPOFF", nd.id, nd.dropoffCodeNonce),
  });

  app = await startAppServer({ ...ALL_FLAGS_ON, ...TEST_LEGAL_ENV, DRIVER_SIGNUP_ENABLED: undefined });
});

test.after(async () => {
  await app?.stop();
  restoreEnv?.();
  await resetTestDb();
  await testDb.$disconnect();
});

const C = COOKIE_NAME;
const json = (o: unknown) => ({ body: JSON.stringify(o), headers: { "content-type": "application/json", ...ip() } });

// ---------------------------------------------------------------------------
// Driver APIs
// ---------------------------------------------------------------------------

test("driver API: no cookie → 401", async () => {
  for (const [m, p, body] of [["GET", "/api/driver/delivery"], ["GET", "/api/driver/offers"], ["POST", "/api/driver/availability", { online: true }], ["POST", `/api/driver/delivery/${f.deliveryId}`, { action: "ARRIVE_DROPOFF" }]] as const) {
    const r = await app.request(m, p, body ? json(body) : { headers: ip() });
    assert.equal(r.status, 401, `${m} ${p}`);
  }
});

test("driver API: a staff cookie only, or an admin cookie only → 401 (they are never read as a driver session)", async () => {
  for (const cookie of [{ [C.staff]: t.staffA }, { [C.platform_admin]: t.admin }]) {
    const r = await app.request("GET", "/api/driver/delivery", { headers: { ...cookies(cookie), ...ip() } });
    assert.equal(r.status, 401, JSON.stringify(Object.keys(cookie)));
  }
});

test("driver API: a staff or admin TOKEN placed in the driver cookie → 403 (wrong kind of session)", async () => {
  for (const token of [t.staffA, t.admin]) {
    const r = await app.request("GET", "/api/driver/delivery", { headers: { ...cookies({ [C.driver]: token }), ...ip() } });
    assert.equal(r.status, 403);
  }
  const forged = await app.request("GET", "/api/driver/delivery", { headers: { ...cookies({ [C.driver]: t.driverA.slice(0, -4) + "AAAA" }), ...ip() } });
  assert.equal(forged.status, 401, "a tampered token is rejected");
});

test("driver API: the assigned driver is allowed and sees their delivery — but never the drop-off code", async () => {
  const r = await app.request("GET", "/api/driver/delivery", { headers: { ...cookies({ [C.driver]: t.driverA }), ...ip() } });
  assert.equal(r.status, 200);
  const body = JSON.parse(r.body);
  assert.equal(body.delivery.id, f.deliveryId);
  assert.equal(r.body.includes(f.dropoffCode), false);
});

test("driver API: Driver B can't see or act on Driver A's delivery → 404", async () => {
  const mine = await app.request("GET", "/api/driver/delivery", { headers: { ...cookies({ [C.driver]: t.driverB }), ...ip() } });
  assert.equal(mine.status, 200);
  assert.equal(JSON.parse(mine.body).delivery, null);
  for (const action of [{ action: "ARRIVE_DROPOFF" }, { action: "CONFIRM_DELIVERY", code: "123456" }, { action: "FAIL", reason: "not mine" }]) {
    const r = await app.request("POST", `/api/driver/delivery/${f.deliveryId}`, { ...json(action), headers: { ...json(action).headers, ...cookies({ [C.driver]: t.driverB }) } });
    assert.equal(r.status, 404, JSON.stringify(action));
  }
  const still = await prisma.networkDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } });
  assert.equal(still.status, "ARRIVED_DROPOFF");
});

test("driver API: raw status fields and client 'online' assertions are rejected by the request schema → 400", async () => {
  const withDriver = (o: unknown) => ({ ...json(o), headers: { ...json(o).headers, ...cookies({ [C.driver]: t.driverA }) } });
  assert.equal((await app.request("POST", `/api/driver/delivery/${f.deliveryId}`, withDriver({ action: "CONFIRM_DELIVERY", code: "000000", status: "DELIVERED" }))).status, 400);
  assert.equal((await app.request("POST", `/api/driver/delivery/${f.deliveryId}`, withDriver({ action: "DELIVERED" }))).status, 400);
  assert.equal((await app.request("POST", "/api/driver/availability", withDriver({ online: true, verificationStatus: "APPROVED" }))).status, 400);
  assert.equal((await prisma.networkDelivery.findUniqueOrThrow({ where: { id: f.deliveryId } })).status, "ARRIVED_DROPOFF");
});

test("SEC 11 over HTTP: driver sign-up is switched off on this server — a direct POST creates nothing", async () => {
  const email = `http-signup-${run}@example.test`;
  const form = new URLSearchParams({ firstName: "Lerato", lastName: "M", email, phone: "0821234567", password: "longenough123" });
  const r = await app.request("POST", "/api/driver/signup", { body: form.toString(), headers: { "content-type": "application/x-www-form-urlencoded", ...ip() } });
  assert.equal(r.status, 303);
  assert.match(String(r.headers.location), /\/driver\/join\?err=/);
  assert.equal(r.headers["set-cookie"], undefined, "no session issued");
  assert.equal(await prisma.appUser.count({ where: { email } }), 0, "no account created");
});

// ---------------------------------------------------------------------------
// Platform admin
// ---------------------------------------------------------------------------

test("admin: document download → 404 for no session, staff, driver and a non-ADMIN platform token; 200 attachment for an admin", async () => {
  const path = `/api/admin/driver-documents/${f.documentId}`;
  for (const cookie of [{}, { [C.staff]: t.staffA }, { [C.driver]: t.driverA }, { [C.platform_admin]: t.fakeAdmin }, { [C.platform_admin]: t.staffA }, { [C.platform_admin]: t.adminNoMfa }]) {
    const r = await app.request("GET", path, { headers: { ...cookies(cookie), ...ip() } });
    assert.equal(r.status, 404, JSON.stringify(Object.keys(cookie)));
  }
  const ok = await app.request("GET", path, { headers: { ...cookies({ [C.platform_admin]: t.admin }), ...ip() } });
  assert.equal(ok.status, 200);
  assert.match(String(ok.headers["content-disposition"]), /^attachment/);
  assert.equal(ok.headers["x-content-type-options"], "nosniff");
  assert.match(String(ok.headers["cache-control"]), /no-store/);
});

test("admin: the drivers page is a 404 to everyone but a platform admin", async () => {
  for (const cookie of [{}, { [C.staff]: t.staffA }, { [C.driver]: t.driverA }, { [C.platform_admin]: t.fakeAdmin }, { [C.platform_admin]: t.adminNoMfa }]) {
    const r = await app.request("GET", "/platform-admin/drivers", { headers: { ...cookies(cookie), ...ip() } });
    assert.equal(r.status, 404, JSON.stringify(Object.keys(cookie)));
  }
  const ok = await app.request("GET", "/platform-admin/drivers", { headers: { ...cookies({ [C.platform_admin]: t.admin }), ...ip() } });
  assert.equal(ok.status, 200);
  assert.match(ok.body, /Drivers/);
});

test("admin host over HTTP: a prefixed path redirects once to the clean URL, which an admin can open", async () => {
  const host = { host: `admin.localhost:${app.port}` };
  const r = await app.request("GET", "/platform-admin/drivers", { headers: { ...host, ...ip() } });
  assert.equal(r.status, 308);
  assert.equal(new URL(String(r.headers.location), "http://x").pathname, "/drivers");
  const page = await app.request("GET", "/drivers", { headers: { ...host, ...cookies({ [C.platform_admin]: t.admin }), ...ip() } });
  assert.equal(page.status, 200);
  const anon = await app.request("GET", "/drivers", { headers: { ...host, ...ip() } });
  assert.equal(anon.status, 404, "unauthenticated admin page → 404 on the admin host too");
  const login = await app.request("GET", "/admin-login", { headers: { ...host, ...ip() } });
  assert.equal(login.status, 200, "the login page exists on the admin host");
});

// ---------------------------------------------------------------------------
// Shop (tenant isolation over HTTP)
// ---------------------------------------------------------------------------

test("shop: tenant B's deliveries page never shows tenant A's network delivery; A's own page does (control)", async () => {
  const a = await app.request("GET", "/dashboard/deliveries", { headers: { ...cookies({ [C.staff]: t.staffA }), ...ip() } });
  const b = await app.request("GET", "/dashboard/deliveries", { headers: { ...cookies({ [C.staff]: t.staffB }), ...ip() } });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.ok(a.body.includes(f.orderNumber), "control: A sees its own delivery");
  assert.equal(b.body.includes(f.orderNumber), false);
  assert.equal(b.body.includes(f.trackingToken), false);
  // Even the owning shop's page never carries the customer's drop-off code or key.
  for (const page of [a.body, b.body]) {
    assert.equal(page.includes(f.dropoffCode), false);
    assert.equal(page.includes(f.customerKey), false);
  }
});

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

test("tracking: unknown, near-miss and expired tokens all → 404; the shop's status link carries no code", async () => {
  for (const bad of ["not-a-real-token-at-all-xxxxxxxxxx", f.trackingToken.slice(0, -2) + "zz", "short"]) {
    assert.equal((await app.request("GET", `/track/${bad}`, { headers: ip() })).status, 404, bad);
  }
  const ok = await app.request("GET", `/track/${f.trackingToken}`, { headers: ip() });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.includes(f.dropoffCode), false, "the merchant-held link never shows the drop-off code");
  assert.match(ok.body, /noindex/);

  // Expired: same safe failure as unknown.
  await prisma.networkDelivery.update({ where: { id: f.deliveryId }, data: { trackingExpiresAt: new Date(Date.now() - 1000) } });
  try {
    assert.equal((await app.request("GET", `/track/${f.trackingToken}`, { headers: ip() })).status, 404);
  } finally {
    await prisma.networkDelivery.update({ where: { id: f.deliveryId }, data: { trackingExpiresAt: null } });
  }
});

test("customer page: only the customer key shows the drop-off code; other keys → 404", async () => {
  const mine = await app.request("GET", `/delivery/${f.customerKey}`, { headers: ip() });
  assert.equal(mine.status, 200);
  assert.ok(mine.body.includes(f.dropoffCode), "the customer sees their code");
  for (const bad of [f.customerKey.slice(0, -2) + "zz", f.trackingToken, "x".repeat(43)]) {
    assert.equal((await app.request("GET", `/delivery/${bad}`, { headers: ip() })).status, 404, "the shop's tracking token does not open the customer page");
  }
});
