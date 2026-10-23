import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { resetTestDb, testDb } from "@/lib/testing/db";
import { deriveCode } from "./codes";
import { issueCustomerDeliveryKey } from "./customer-key";
import { acceptOffer, maybeTickDispatch, runDispatch, tickDispatch } from "./dispatch.service";
import {
  checkOrderEligibility,
  confirmDelivery,
  confirmPickup,
  driverStep,
  getCustomerDeliveryView,
  getShopDeliveryView,
  getTrackingView,
  quoteForOrder,
  requestNetworkDelivery,
  rotateDeliveryCode,
} from "./delivery.service";
import {
  acceptDriverLegal,
  approveDriver,
  becomeDriver,
  operatingEligibility,
  reinstateDriver,
  requestAvailability,
  signUpDriver,
  submitDriverApplication,
} from "./driver.service";
import { FeatureDisabledError, lethaEnabled } from "./flags";
import { ALL_FLAGS_ON, enableLethaForTests, LEGAL_FIELDS_ACCEPTED, setEnv, TEST_LEGAL_ENV } from "./testing";

/**
 * Security regressions for the production-readiness pass:
 *   - the merchant can never obtain the customer's drop-off code
 *   - a shop and a driver together can't complete a delivery
 *   - switched-off features can't be reached by calling the server directly
 *   - approval is impossible until legal documents are configured and accepted
 *   - dispatch can't be amplified by polling
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const PICKUP = { lat: -26.2485, lng: 27.854 };
const DROPOFF = { lat: -26.26, lng: 27.87 };
let seq = 0;
const customerKeys = new Map<string, string>();

async function makeShop(label: string) {
  const owner = await prisma.appUser.create({ data: { email: `sec-owner-${label}-${run}@example.test`, role: "OWNER" }, select: { id: true } });
  const b = await prisma.business.create({
    data: {
      name: `Sec Shop ${label}`,
      slug: `sec-${label}-${run}`,
      status: "ACTIVE",
      latitude: PICKUP.lat,
      longitude: PICKUP.lng,
      settings: { delivery: { enabled: true, pricingMode: "FLAT", feeCents: 3500, perKmFeeCents: 0 } },
    },
    select: { id: true },
  });
  return { businessId: b.id, staffId: owner.id, ownerUserId: owner.id };
}

async function makePaidOrder(businessId: string, withCustomerKey = true) {
  seq += 1;
  const order = await prisma.order.create({
    data: { businessId, orderNumber: `SEC-${run}-${seq}`, subtotal: 100, total: 135, deliveryFee: 35, status: "READY", paymentStatus: "PAID", fulfilmentMethod: "DELIVERY" },
    select: { id: true },
  });
  const od = await prisma.orderDelivery.create({
    data: { businessId, orderId: order.id, deliveryAddressSnapshot: "7 Khumalo St", contactPhone: "+27821112222", deliveryLat: DROPOFF.lat, deliveryLng: DROPOFF.lng },
  });
  if (withCustomerKey) customerKeys.set(order.id, await issueCustomerDeliveryKey(od.id));
  return order.id;
}

async function makeDriver(label: string, over: { status?: "APPROVED" | "PENDING_REVIEW" | "SUSPENDED"; legal?: boolean } = {}) {
  const user = await prisma.appUser.create({ data: { email: `sec-driver-${label}-${run}@example.test`, role: "DRIVER", emailVerifiedAt: new Date() }, select: { id: true } });
  const d = await prisma.driverProfile.create({
    data: {
      userId: user.id,
      displayName: `Sec Driver ${label}`,
      phone: "+27831234567",
      verificationStatus: over.status ?? "APPROVED",
      availability: (over.status ?? "APPROVED") === "APPROVED" ? "ONLINE" : "OFFLINE",
      locationConsentAt: new Date(),
      ...(over.legal === false ? {} : LEGAL_FIELDS_ACCEPTED()),
      payoutAccountCipher: "sealed",
      lastLat: PICKUP.lat + 0.004,
      lastLng: PICKUP.lng + 0.004,
      lastLocationAt: new Date(),
      vehicles: { create: { type: "CAR", registration: "CA654321" } },
      documents: {
        create: (["ID_DOCUMENT", "DRIVERS_LICENCE", "VEHICLE_REGISTRATION"] as const).map((kind) => ({
          kind, status: "ACCEPTED", fileName: `${kind}.pdf`, contentType: "application/pdf", sizeBytes: 9, sha256: "x", content: new Uint8Array(Buffer.from("%PDF-1.4\n")),
        })),
      },
    },
    select: { id: true },
  });
  return d.id;
}

async function requested(shop: { businessId: string; staffId: string }) {
  const orderId = await makePaidOrder(shop.businessId);
  const quote = await quoteForOrder(shop.businessId, orderId);
  assert.ok(quote.ok, JSON.stringify(quote));
  const { deliveryId } = await requestNetworkDelivery(shop, { orderId, requestKey: `sec-${run}-${++seq}`, confirmedFeeCents: quote.quoteFeeCents });
  return { orderId, deliveryId };
}

async function assignTo(deliveryId: string, driverId: string) {
  const offer = await prisma.deliveryOffer.upsert({
    where: { networkDeliveryId_driverId: { networkDeliveryId: deliveryId, driverId } },
    update: { status: "PENDING", expiresAt: new Date(Date.now() + 60_000) },
    create: { networkDeliveryId: deliveryId, driverId, distanceMeters: 500, expiresAt: new Date(Date.now() + 60_000) },
  });
  await acceptOffer(driverId, offer.id);
}

/** A delivery waiting at the customer's door, assigned to `driverId`. */
async function atTheDoor(label: string) {
  const shop = await makeShop(label);
  const driverId = await makeDriver(label);
  const { orderId, deliveryId } = await requested(shop);
  await assignTo(deliveryId, driverId);
  await driverStep(driverId, deliveryId, "ARRIVE_PICKUP");
  await confirmPickup(driverId, deliveryId, (await getShopDeliveryView(shop.businessId, orderId))!.pickupCode!);
  await driverStep(driverId, deliveryId, "ARRIVE_DROPOFF");
  return { shop, driverId, orderId, deliveryId };
}

/** The real drop-off code, computed from the database (ground truth for "is it anywhere it shouldn't be?"). */
async function trueDropoffCode(deliveryId: string) {
  const d = await prisma.networkDelivery.findUniqueOrThrow({ where: { id: deliveryId }, select: { id: true, dropoffCodeNonce: true } });
  return deriveCode("DROPOFF", d.id, d.dropoffCodeNonce);
}

let restoreEnv: () => void;
test.before(async () => {
  restoreEnv = enableLethaForTests();
  await resetTestDb();
});
test.after(async () => {
  restoreEnv();
  await resetTestDb();
  await testDb.$disconnect();
});

// ---------------------------------------------------------------------------
// 9 & 10 — the merchant never gets the drop-off code; shop + driver can't complete
// ---------------------------------------------------------------------------

test("SEC 9: nothing the merchant can reach contains the customer's drop-off code", async () => {
  const { shop, orderId, deliveryId } = await atTheDoor("leak");
  const code = await trueDropoffCode(deliveryId);

  const shopView = await getShopDeliveryView(shop.businessId, orderId);
  const statusLink = await getTrackingView(shopView!.trackingToken);
  const notifications = await prisma.businessNotification.findMany({ where: { businessId: shop.businessId } });
  const events = await prisma.deliveryEvent.findMany({ where: { businessId: shop.businessId } });
  const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { delivery: true } });

  for (const [name, value] of Object.entries({ shopView, statusLink, notifications, events, orderRow })) {
    assert.equal(JSON.stringify(value).includes(code), false, `${name} must not contain the drop-off code`);
  }
  assert.equal("dropoffCode" in (statusLink as object), false, "the shop's status link has no code field at all");
  // The customer key itself is never readable by the merchant: only its hash is stored.
  assert.equal(JSON.stringify(orderRow).includes(customerKeys.get(orderId)!), false);
  // …while the customer's own page does show it.
  assert.equal((await getCustomerDeliveryView(customerKeys.get(orderId)!))!.delivery!.dropoffCode, code);
});

test("SEC 9b: rotating the customer's code returns nothing to the shop; the new code reaches only the customer page", async () => {
  const { shop, orderId, deliveryId } = await atTheDoor("rotate");
  const before = await trueDropoffCode(deliveryId);
  const result = await rotateDeliveryCode(shop.businessId, shop.staffId, deliveryId, "DROPOFF");
  assert.equal(result, undefined, "rotation hands the shop nothing");
  const after = await trueDropoffCode(deliveryId);
  assert.notEqual(after, before);
  assert.equal(JSON.stringify(await getShopDeliveryView(shop.businessId, orderId)).includes(after), false);
  assert.equal((await getCustomerDeliveryView(customerKeys.get(orderId)!))!.delivery!.dropoffCode, after);
});

test("SEC 10: a shop and driver colluding, with everything the shop can see, can't complete the delivery", async () => {
  const { shop, driverId, orderId, deliveryId } = await atTheDoor("collude");
  const shopView = (await getShopDeliveryView(shop.businessId, orderId))!;
  const statusLink = (await getTrackingView(shopView.trackingToken))!;

  // Every value the pair can lay hands on, tried as the drop-off code — then guesses.
  const harvested = [
    ...JSON.stringify({ shopView, statusLink }).matchAll(/\d{6}/g),
  ].map((m) => m[0]);
  const attempts = [...new Set([...harvested, "000000", "123456", "999999", "111111", "654321"])].slice(0, 5);
  for (const tryCode of attempts) {
    await assert.rejects(confirmDelivery(driverId, deliveryId, tryCode), /isn't right|Too many/);
  }
  // Locked after five wrong tries — even the right code is refused now.
  await assert.rejects(confirmDelivery(driverId, deliveryId, await trueDropoffCode(deliveryId)), /Too many wrong codes/);
  const d = await prisma.networkDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  assert.equal(d.status, "ARRIVED_DROPOFF");
  assert.equal(d.dropoffCodeFailures >= 5, true);
  assert.equal(await prisma.driverLedgerEntry.count({ where: { networkDeliveryId: deliveryId } }), 0, "no earning");
  assert.notEqual((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status, "COMPLETED");
});

test("SEC 8: five invalid delivery-code attempts lock the code; a rotation (shop) + the customer's new code completes it", async () => {
  const { shop, driverId, orderId, deliveryId } = await atTheDoor("lock");
  for (const bad of ["100000", "200000", "300000", "400000", "500000"]) {
    await assert.rejects(confirmDelivery(driverId, deliveryId, bad), /isn't right/);
  }
  await assert.rejects(confirmDelivery(driverId, deliveryId, await trueDropoffCode(deliveryId)), /Too many wrong codes/);
  assert.equal((await getCustomerDeliveryView(customerKeys.get(orderId)!))!.delivery!.dropoffCodeLocked, true);
  await rotateDeliveryCode(shop.businessId, shop.staffId, deliveryId, "DROPOFF");
  await confirmDelivery(driverId, deliveryId, (await getCustomerDeliveryView(customerKeys.get(orderId)!))!.delivery!.dropoffCode!);
  assert.equal((await prisma.networkDelivery.findUniqueOrThrow({ where: { id: deliveryId } })).status, "DELIVERED");
});

test("customer keys: unguessable, scoped to one order, idempotent, and required for a network driver", async () => {
  const shop = await makeShop("keys");
  const a = await makePaidOrder(shop.businessId);
  const b = await makePaidOrder(shop.businessId);
  const odA = await prisma.orderDelivery.findUniqueOrThrow({ where: { orderId: a } });
  assert.equal(await issueCustomerDeliveryKey(odA.id), customerKeys.get(a), "a retried checkout gets the same key");
  assert.notEqual(customerKeys.get(a), customerKeys.get(b));
  assert.equal((await getCustomerDeliveryView(customerKeys.get(a)!))!.orderNumber.endsWith(`-${seq - 1}`), true);
  assert.equal(await getCustomerDeliveryView("x".repeat(43)), null);
  assert.equal(await getCustomerDeliveryView(customerKeys.get(a)!.slice(0, -2) + "zz"), null);
  // An order whose customer holds no key (e.g. taken in the shop) can't get a network driver.
  const noKey = await makePaidOrder(shop.businessId, false);
  const r = await checkOrderEligibility(shop.businessId, noKey);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /online orders/);
});

// ---------------------------------------------------------------------------
// 11 & 12 — switched-off features can't be reached directly
// ---------------------------------------------------------------------------

test("flags default OFF: nothing is enabled unless set to exactly 'true'", () => {
  const restore = setEnv({ SKHOKHOLETHA_ENABLED: undefined, DRIVER_SIGNUP_ENABLED: "true", DELIVERY_REQUESTS_ENABLED: "true", DRIVER_APPROVALS_ENABLED: "true" });
  try {
    for (const f of ["network", "driverSignup", "deliveryRequests", "driverApprovals"] as const) assert.equal(lethaEnabled(f), false, `${f} needs the master switch`);
    process.env.SKHOKHOLETHA_ENABLED = "1";
    assert.equal(lethaEnabled("network"), false, "'1' is not 'true'");
    process.env.SKHOKHOLETHA_ENABLED = "TRUE";
    assert.equal(lethaEnabled("network"), false);
  } finally {
    restore();
  }
});

test("SEC 11: with driver sign-up off, every sign-up path refuses at the service (no account created)", async () => {
  const shop = await makeShop("signup-off");
  const draft = await makeDriver("signup-off-draft", { status: "PENDING_REVIEW" });
  await prisma.driverProfile.update({ where: { id: draft }, data: { verificationStatus: "DRAFT" } });
  const restore = setEnv({ DRIVER_SIGNUP_ENABLED: undefined });
  try {
    const email = `blocked-${run}@example.test`;
    await assert.rejects(signUpDriver({ firstName: "A", lastName: "B", email, phone: "0821234567", password: "longenough1" }), FeatureDisabledError);
    assert.equal(await prisma.appUser.count({ where: { email } }), 0);
    await assert.rejects(becomeDriver(shop.ownerUserId, { displayName: "Owner Driver", phone: "0821234567" }), FeatureDisabledError);
    assert.equal(await prisma.driverProfile.count({ where: { userId: shop.ownerUserId } }), 0);
    await assert.rejects(submitDriverApplication(draft), FeatureDisabledError);
  } finally {
    restore();
  }
});

test("SEC 12: with delivery requests off, a request is refused at the service — and deliveries already running carry on", async () => {
  const running = await atTheDoor("requests-off");
  const shop = await makeShop("requests-off-2");
  const orderId = await makePaidOrder(shop.businessId);
  const quote = await quoteForOrder(shop.businessId, orderId);
  assert.ok(quote.ok);
  const restore = setEnv({ DELIVERY_REQUESTS_ENABLED: "false" });
  try {
    await assert.rejects(requestNetworkDelivery(shop, { orderId, requestKey: `off-${run}`, confirmedFeeCents: quote.quoteFeeCents }), FeatureDisabledError);
    assert.equal(await prisma.networkDelivery.count({ where: { orderId } }), 0);
    // The in-flight delivery completes normally.
    await confirmDelivery(running.driverId, running.deliveryId, (await getCustomerDeliveryView(customerKeys.get(running.orderId)!))!.delivery!.dropoffCode!);
    assert.equal((await prisma.networkDelivery.findUniqueOrThrow({ where: { id: running.deliveryId } })).status, "DELIVERED");
  } finally {
    restore();
  }
});

test("master switch off: no going online, no accepting, no new offers — but in-flight work finishes and drivers can go offline", async () => {
  const shop = await makeShop("master-off");
  const busy = await makeDriver("master-off-busy");
  const idle = await makeDriver("master-off-idle");
  const inflight = await requested(shop);
  await assignTo(inflight.deliveryId, busy);
  const waiting = await requested(shop);
  const pendingOffer = await prisma.deliveryOffer.upsert({
    where: { networkDeliveryId_driverId: { networkDeliveryId: waiting.deliveryId, driverId: idle } },
    update: { status: "PENDING", expiresAt: new Date(Date.now() + 60_000) },
    create: { networkDeliveryId: waiting.deliveryId, driverId: idle, distanceMeters: 300, expiresAt: new Date(Date.now() + 60_000) },
  });
  await prisma.driverProfile.update({ where: { id: idle }, data: { availability: "OFFLINE" } });

  const restore = setEnv({ SKHOKHOLETHA_ENABLED: undefined });
  try {
    await assert.rejects(requestAvailability(idle, true), FeatureDisabledError);
    await prisma.driverProfile.update({ where: { id: idle }, data: { availability: "ONLINE" } });
    await assert.rejects(acceptOffer(idle, pendingOffer.id), FeatureDisabledError);
    await prisma.networkDelivery.update({ where: { id: waiting.deliveryId }, data: { status: "SEARCHING", dispatchAttemptAt: null } });
    assert.equal(await runDispatch(waiting.deliveryId), 0, "no new offers while switched off");
    assert.deepEqual(await requestAvailability(idle, false), { availability: "OFFLINE" }, "going offline always works");
    // The assigned driver finishes the job.
    await driverStep(busy, inflight.deliveryId, "ARRIVE_PICKUP");
    await confirmPickup(busy, inflight.deliveryId, (await getShopDeliveryView(shop.businessId, inflight.orderId))!.pickupCode!);
    await driverStep(busy, inflight.deliveryId, "ARRIVE_DROPOFF");
    await confirmDelivery(busy, inflight.deliveryId, (await getCustomerDeliveryView(customerKeys.get(inflight.orderId)!))!.delivery!.dropoffCode!);
    assert.equal((await prisma.networkDelivery.findUniqueOrThrow({ where: { id: inflight.deliveryId } })).status, "DELIVERED");
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 13 — legal gate
// ---------------------------------------------------------------------------

async function pendingApplicant(label: string) {
  const id = await makeDriver(label, { status: "PENDING_REVIEW", legal: false });
  return id;
}

test("SEC 13: approval is impossible while legal documents aren't configured — even with approvals switched on", async () => {
  const driverId = await pendingApplicant("legal-missing");
  const restore = setEnv({ DRIVER_TERMS_VERSION: undefined, DRIVER_TERMS_URL: undefined });
  try {
    await assert.rejects(approveDriver("admin-test", driverId), /blocked until the driver terms and privacy notice are configured/);
    await assert.rejects(acceptDriverLegal(driverId, { termsVersion: "anything", privacyVersion: TEST_LEGAL_ENV.DRIVER_PRIVACY_VERSION }), /not published yet/);
    assert.equal(await prisma.driverLegalAcceptance.count({ where: { driverId } }), 0, "no acceptance recorded for a document that doesn't exist");
    assert.equal((await prisma.driverProfile.findUniqueOrThrow({ where: { id: driverId } })).verificationStatus, "PENDING_REVIEW");
  } finally {
    restore();
  }
});

test("legal: an http (non-https) document URL counts as not configured", async () => {
  const driverId = await pendingApplicant("legal-http");
  const restore = setEnv({ DRIVER_PRIVACY_URL: "http://example.test/privacy" });
  try {
    await assert.rejects(approveDriver("admin-test", driverId), /DRIVER_PRIVACY_URL/);
  } finally {
    restore();
  }
});

test("legal: only the configured versions can be accepted; acceptance is recorded with audit data; then approval works", async () => {
  const driverId = await pendingApplicant("legal-ok");
  await assert.rejects(approveDriver("admin-test", driverId), /hasn.t accepted the current terms/);
  await assert.rejects(acceptDriverLegal(driverId, { termsVersion: "made-up-v9", privacyVersion: TEST_LEGAL_ENV.DRIVER_PRIVACY_VERSION }), /terms changed/);
  assert.equal(await prisma.driverLegalAcceptance.count({ where: { driverId } }), 0);

  await acceptDriverLegal(
    driverId,
    { termsVersion: TEST_LEGAL_ENV.DRIVER_TERMS_VERSION, privacyVersion: TEST_LEGAL_ENV.DRIVER_PRIVACY_VERSION },
    { ip: "196.25.1.1", userAgent: "Mozilla/5.0 (Linux; Android 14)" },
  );
  const rows = await prisma.driverLegalAcceptance.findMany({ where: { driverId } });
  const byKind = (x: string[], y: string[]) => x[0].localeCompare(y[0]);
  assert.deepEqual(rows.map((r) => [r.kind, r.version, r.documentUrl]).sort(byKind), [
    ["TERMS", TEST_LEGAL_ENV.DRIVER_TERMS_VERSION, TEST_LEGAL_ENV.DRIVER_TERMS_URL],
    ["PRIVACY", TEST_LEGAL_ENV.DRIVER_PRIVACY_VERSION, TEST_LEGAL_ENV.DRIVER_PRIVACY_URL],
  ].sort(byKind));
  assert.ok(rows.every((r) => r.ipHash && r.ipHash !== "196.25.1.1" && /^[a-f0-9]{64}$/.test(r.ipHash)), "IP stored hashed only");
  assert.ok(rows.every((r) => r.userAgent?.startsWith("Mozilla")));
  // The acceptance log is append-only.
  await assert.rejects(prisma.driverLegalAcceptance.update({ where: { id: rows[0].id }, data: { version: "forged" } }), /append-only/);
  await assert.rejects(prisma.driverLegalAcceptance.delete({ where: { id: rows[0].id } }), /append-only/);

  await approveDriver("admin-test", driverId);
  assert.equal((await prisma.driverProfile.findUniqueOrThrow({ where: { id: driverId } })).verificationStatus, "APPROVED");
});

test("legal: approvals switch off blocks approve and reinstate; a new terms version stops an approved driver until re-accepted", async () => {
  const applicant = await pendingApplicant("legal-switch");
  await acceptDriverLegal(applicant, { termsVersion: TEST_LEGAL_ENV.DRIVER_TERMS_VERSION, privacyVersion: TEST_LEGAL_ENV.DRIVER_PRIVACY_VERSION });
  const suspended = await makeDriver("legal-suspended", { status: "SUSPENDED" });
  let restore = setEnv({ DRIVER_APPROVALS_ENABLED: undefined });
  try {
    await assert.rejects(approveDriver("admin-test", applicant), FeatureDisabledError);
    await assert.rejects(reinstateDriver("admin-test", suspended), FeatureDisabledError);
  } finally {
    restore();
  }

  const working = await makeDriver("legal-bump");
  await prisma.driverProfile.update({ where: { id: working }, data: { availability: "OFFLINE" } });
  restore = setEnv({ DRIVER_TERMS_VERSION: "test-terms-2" });
  try {
    await assert.rejects(requestAvailability(working, true), /current driver terms/);
    const p = await prisma.driverProfile.findUniqueOrThrow({ where: { id: working }, include: { vehicles: true, documents: true } });
    assert.equal(operatingEligibility(p, p.vehicles, p.documents).eligible, false);
    await acceptDriverLegal(working, { termsVersion: "test-terms-2", privacyVersion: TEST_LEGAL_ENV.DRIVER_PRIVACY_VERSION });
    assert.deepEqual(await requestAvailability(working, true), { availability: "ONLINE" });
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Dispatch load safeguards
// ---------------------------------------------------------------------------

test("dispatch: request-triggered ticks are throttled platform-wide", async () => {
  const at = new Date(Math.floor(Date.now() / 5000) * 5000 + 5000 * 1000); // a fresh 5s window in the future
  const first = await maybeTickDispatch(at);
  const second = await maybeTickDispatch(new Date(at.getTime() + 100));
  assert.equal(first, true);
  assert.equal(second, false, "a second poll in the same window does not tick again");
});

test("dispatch: concurrent rounds for one delivery scan once; expiry is batched with one event per expired offer", async () => {
  const shop = await makeShop("race");
  await prisma.driverProfile.updateMany({ where: { availability: "ONLINE" }, data: { availability: "OFFLINE" } });
  await makeDriver("race-1");
  const { deliveryId } = await requested(shop);
  // Back to searching with a stale attempt: two triggers race for the same round.
  await prisma.deliveryOffer.deleteMany({ where: { networkDeliveryId: deliveryId } });
  await prisma.networkDelivery.update({ where: { id: deliveryId }, data: { status: "SEARCHING", dispatchAttemptAt: new Date(Date.now() - 60_000) } });
  const rounds = await Promise.all([runDispatch(deliveryId), runDispatch(deliveryId), runDispatch(deliveryId)]);
  assert.equal(rounds.filter((n) => n > 0).length, 1, `exactly one round ran: ${rounds}`);

  // Expire them; one tick expires each offer once and writes one event per offer.
  const live = await prisma.deliveryOffer.count({ where: { networkDeliveryId: deliveryId, status: "PENDING" } });
  await prisma.deliveryOffer.updateMany({ where: { networkDeliveryId: deliveryId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await Promise.all([tickDispatch(new Date(), 5), tickDispatch(new Date(), 5)]);
  assert.equal(await prisma.deliveryOffer.count({ where: { networkDeliveryId: deliveryId, status: "EXPIRED" } }), live);
  assert.equal(await prisma.deliveryEvent.count({ where: { networkDeliveryId: deliveryId, type: "offer_expired" } }), live, "no duplicate expiry events");
});

test("sanity: the security suite ran with every switch on and the test legal config", () => {
  for (const [k, v] of Object.entries(ALL_FLAGS_ON)) assert.equal(process.env[k], v);
});
