import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { resetTestDb, testDb } from "@/lib/testing/db";
import { assignDriver } from "@/modules/orders/order-delivery.service";
import { deriveCode } from "./codes";
import { acceptOffer, declineOffer, listDriverOffers, OfferUnavailableError, runDispatch, tickDispatch } from "./dispatch.service";
import {
  cancelNetworkDelivery,
  checkOrderEligibility,
  confirmDelivery,
  confirmPickup,
  driverStep,
  failDelivery,
  getDriverActiveDelivery,
  getCustomerDeliveryView,
  getShopDeliveryView,
  getTrackingView,
  NetworkDeliveryError,
  quoteForOrder,
  requestNetworkDelivery,
  rotateDeliveryCode,
} from "./delivery.service";
import { approveDriver, recordDriverPosition, requestAvailability, suspendDriver, uploadDriverDocument, reviewDriverDocument, DriverError } from "./driver.service";
import { createDriverPayout, getDriverBalance, markPayoutPaid, releaseDueEarnings, earningSourceKey } from "./ledger.service";
import { InvalidTransitionError } from "./state-machine";
import { issueCustomerDeliveryKey } from "./customer-key";
import { enableLethaForTests, LEGAL_FIELDS_ACCEPTED } from "./testing";

/**
 * Skhokholetha against a real database: the six required E2E scenarios plus
 * authorization, tenant isolation, concurrency, idempotency and ledger rules.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const PICKUP = { lat: -26.2485, lng: 27.854 };
/** orderId → the customer's own key (what only the customer would hold). */
const customerKeys = new Map<string, string>();
const DROPOFF = { lat: -26.26, lng: 27.87 };
let seq = 0;

async function makeShop(label: string) {
  const b = await prisma.business.create({
    data: {
      name: `Letha Shop ${label}`,
      slug: `letha-${label}-${run}`,
      status: "ACTIVE",
      latitude: PICKUP.lat,
      longitude: PICKUP.lng,
      suburb: "Soweto",
      settings: { delivery: { enabled: true, pricingMode: "FLAT", feeCents: 3500, perKmFeeCents: 0 } },
    },
    select: { id: true },
  });
  return { businessId: b.id, staffId: `owner-${label}-${run}` };
}

async function makePaidOrder(businessId: string, over: { status?: string; paymentStatus?: string; fulfilmentMethod?: string } = {}) {
  seq += 1;
  const order = await prisma.order.create({
    data: {
      businessId,
      orderNumber: `LT-${run}-${seq}`,
      subtotal: 100,
      total: 135,
      deliveryFee: 35,
      status: (over.status ?? "READY") as never,
      paymentStatus: (over.paymentStatus ?? "PAID") as never,
      fulfilmentMethod: (over.fulfilmentMethod ?? "DELIVERY") as never,
    },
    select: { id: true },
  });
  if ((over.fulfilmentMethod ?? "DELIVERY") === "DELIVERY") {
    const od = await prisma.orderDelivery.create({
      data: { businessId, orderId: order.id, deliveryAddressSnapshot: "12 Vilakazi St, Orlando West", contactPhone: "+27821112222", deliveryLat: DROPOFF.lat, deliveryLng: DROPOFF.lng },
    });
    // As online checkout does: the customer receives their own key.
    customerKeys.set(order.id, await issueCustomerDeliveryKey(od.id));
  }
  return order.id;
}

/** The drop-off code as only the CUSTOMER can see it (their own delivery page). */
async function customerCode(orderId: string): Promise<string> {
  const view = await getCustomerDeliveryView(customerKeys.get(orderId)!);
  return view!.delivery!.dropoffCode!;
}

async function makeDriver(label: string, over: { status?: "APPROVED" | "SUSPENDED" | "PENDING_REVIEW"; online?: boolean } = {}) {
  const user = await prisma.appUser.create({ data: { email: `driver-${label}-${run}@example.test`, role: "DRIVER", emailVerifiedAt: new Date() }, select: { id: true } });
  const driver = await prisma.driverProfile.create({
    data: {
      userId: user.id,
      displayName: `Driver ${label}`,
      phone: "+27831234567",
      verificationStatus: over.status ?? "APPROVED",
      availability: over.online === false ? "OFFLINE" : "ONLINE",
      locationConsentAt: new Date(),
      ...LEGAL_FIELDS_ACCEPTED(),
      lastLat: PICKUP.lat + 0.005,
      lastLng: PICKUP.lng + 0.005,
      lastLocationAt: new Date(),
      vehicles: { create: { type: "CAR", registration: "CA123456" } },
      documents: {
        create: (["ID_DOCUMENT", "DRIVERS_LICENCE", "VEHICLE_REGISTRATION"] as const).map((kind) => ({
          kind, status: "ACCEPTED", fileName: `${kind}.pdf`, contentType: "application/pdf", sizeBytes: 9, sha256: "x", content: new Uint8Array(Buffer.from("%PDF-1.4\n")),
        })),
      },
    },
    select: { id: true },
  });
  return driver.id;
}

async function deliveryOf(id: string) {
  return prisma.networkDelivery.findUniqueOrThrow({ where: { id } });
}

/** Request a driver for a fresh paid order and return the delivery. */
async function requested(shop: { businessId: string; staffId: string }) {
  const orderId = await makePaidOrder(shop.businessId);
  const quote = await quoteForOrder(shop.businessId, orderId);
  assert.ok(quote.ok, JSON.stringify(quote));
  const { deliveryId } = await requestNetworkDelivery(shop, { orderId, requestKey: `req-${run}-${++seq}`, confirmedFeeCents: quote.quoteFeeCents });
  return { orderId, deliveryId };
}

/** Give a delivery a live offer for this driver (bypassing ranking) and accept it. */
async function assignTo(deliveryId: string, driverId: string) {
  const offer = await prisma.deliveryOffer.upsert({
    where: { networkDeliveryId_driverId: { networkDeliveryId: deliveryId, driverId } },
    update: { status: "PENDING", expiresAt: new Date(Date.now() + 60_000) },
    create: { networkDeliveryId: deliveryId, driverId, distanceMeters: 500, expiresAt: new Date(Date.now() + 60_000) },
  });
  await acceptOffer(driverId, offer.id);
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
// E2E 1 — the whole lifecycle, earnings exactly once
// ---------------------------------------------------------------------------

test("E2E 1: shop requests → driver offered → accepts → pickup code → drop-off code → delivered, earning once", async () => {
  const shop = await makeShop("e2e1");
  const driverId = await makeDriver("e2e1");
  const { orderId, deliveryId } = await requested(shop);

  // Dispatch offered it to the nearby online driver.
  const offers = await listDriverOffers(driverId);
  const offer = offers.find((o) => o.id && o.shopName.includes("e2e1"));
  assert.ok(offer, "driver received an offer");
  assert.equal((offer as Record<string, unknown>).dropoffAddress, undefined, "no customer address before assignment");

  await acceptOffer(driverId, offer!.id);
  assert.equal((await deliveryOf(deliveryId)).status, "ASSIGNED");
  assert.equal((await prisma.driverProfile.findUniqueOrThrow({ where: { id: driverId } })).availability, "BUSY");

  const active = await getDriverActiveDelivery(driverId);
  assert.equal(active?.dropoff.address, "12 Vilakazi St, Orlando West", "address revealed after assignment");

  await driverStep(driverId, deliveryId, "HEAD_TO_PICKUP");
  await driverStep(driverId, deliveryId, "ARRIVE_PICKUP");
  const shopView = await getShopDeliveryView(shop.businessId, orderId);
  assert.match(shopView!.pickupCode!, /^\d{6}$/);
  await confirmPickup(driverId, deliveryId, shopView!.pickupCode!);
  await driverStep(driverId, deliveryId, "START_TRANSIT");
  await driverStep(driverId, deliveryId, "ARRIVE_DROPOFF");

  const dropoffCode = await customerCode(orderId);
  assert.match(dropoffCode, /^\d{6}$/);
  const result = await confirmDelivery(driverId, deliveryId, dropoffCode);
  assert.equal(result.alreadyDelivered, false);

  const d = await deliveryOf(deliveryId);
  assert.equal(d.status, "DELIVERED");
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status, "COMPLETED");
  assert.equal((await prisma.driverProfile.findUniqueOrThrow({ where: { id: driverId } })).availability, "ONLINE");
  const earnings = await prisma.driverLedgerEntry.findMany({ where: { networkDeliveryId: deliveryId } });
  assert.equal(earnings.length, 1);
  assert.equal(earnings[0].amountCents, d.driverEarningCents);

  // Reconstructable history.
  const types = (await prisma.deliveryEvent.findMany({ where: { networkDeliveryId: deliveryId }, orderBy: { createdAt: "asc" } })).map((e) => e.type);
  for (const t of ["delivery_created", "quote_generated", "search_started", "offer_created", "offers_sent", "offer_accepted", "driver_assigned", "arrived_pickup", "pickup_verified", "departed", "arrived_dropoff", "delivered", "earning_created"]) {
    assert.ok(types.includes(t), `event ${t}`);
  }
  // No event carries a code.
  const blob = JSON.stringify(await prisma.deliveryEvent.findMany({ where: { networkDeliveryId: deliveryId } }));
  assert.equal(blob.includes(shopView!.pickupCode!), false);
  assert.equal(blob.includes(dropoffCode), false);
});

// ---------------------------------------------------------------------------
// E2E 6 — duplicate completion never pays twice
// ---------------------------------------------------------------------------

test("E2E 6: duplicate and concurrent completion requests create exactly one ledger entry", async () => {
  const shop = await makeShop("e2e6");
  const driverId = await makeDriver("e2e6");
  const { orderId, deliveryId } = await requested(shop);
  await assignTo(deliveryId, driverId);
  await driverStep(driverId, deliveryId, "ARRIVE_PICKUP");
  const view = await getShopDeliveryView(shop.businessId, orderId);
  await confirmPickup(driverId, deliveryId, view!.pickupCode!);
  await driverStep(driverId, deliveryId, "ARRIVE_DROPOFF");
  const code = await customerCode(orderId);

  const results = await Promise.allSettled(Array.from({ length: 5 }, () => confirmDelivery(driverId, deliveryId, code)));
  assert.ok(results.every((r) => r.status === "fulfilled"), JSON.stringify(results.map((r) => r.status === "rejected" && String(r.reason))));
  assert.equal(await prisma.driverLedgerEntry.count({ where: { sourceKey: earningSourceKey(deliveryId) } }), 1);
  assert.equal(await prisma.deliveryEvent.count({ where: { networkDeliveryId: deliveryId, type: "delivered" } }), 1);
  // A later retry is a harmless success.
  assert.deepEqual(await confirmDelivery(driverId, deliveryId, code), { alreadyDelivered: true });
  assert.equal(await prisma.driverLedgerEntry.count({ where: { sourceKey: earningSourceKey(deliveryId) } }), 1);
});

// ---------------------------------------------------------------------------
// E2E 3 — simultaneous acceptance: exactly one winner
// ---------------------------------------------------------------------------

test("E2E 3: 20 drivers accept at once → exactly one assignment, one busy driver, clean refusals", async () => {
  const shop = await makeShop("e2e3");
  const drivers = await Promise.all(Array.from({ length: 20 }, (_, i) => makeDriver(`e2e3-${i}`)));
  const { deliveryId } = await requested(shop);
  // Every driver holds a live offer for the same delivery.
  await prisma.deliveryOffer.updateMany({ where: { networkDeliveryId: deliveryId }, data: { status: "WITHDRAWN" } });
  const offers = await Promise.all(
    drivers.map((driverId) =>
      prisma.deliveryOffer.upsert({
        where: { networkDeliveryId_driverId: { networkDeliveryId: deliveryId, driverId } },
        update: { status: "PENDING", expiresAt: new Date(Date.now() + 120_000) },
        create: { networkDeliveryId: deliveryId, driverId, distanceMeters: 400, expiresAt: new Date(Date.now() + 120_000) },
      }),
    ),
  );

  const results = await Promise.allSettled(offers.map((o) => acceptOffer(o.driverId, o.id)));
  const winners = results.filter((r) => r.status === "fulfilled");
  const losers = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  assert.equal(winners.length, 1);
  assert.equal(losers.length, 19);
  for (const l of losers) assert.ok(l.reason instanceof OfferUnavailableError, String(l.reason));

  const d = await deliveryOf(deliveryId);
  assert.equal(d.status, "ASSIGNED");
  assert.equal(await prisma.driverProfile.count({ where: { id: { in: drivers }, availability: "BUSY" } }), 1);
  assert.equal((await prisma.driverProfile.findUniqueOrThrow({ where: { id: d.driverId! } })).availability, "BUSY");
  assert.equal(await prisma.deliveryOffer.count({ where: { networkDeliveryId: deliveryId, status: "ACCEPTED" } }), 1);
  assert.equal(await prisma.deliveryEvent.count({ where: { networkDeliveryId: deliveryId, type: "driver_assigned" } }), 1);
  assert.equal(await prisma.driverLedgerEntry.count({ where: { networkDeliveryId: deliveryId } }), 0, "no earnings at assignment");
});

test("a driver can never hold two active deliveries (even with two live offers)", async () => {
  const shop = await makeShop("two");
  const driverId = await makeDriver("two");
  const a = await requested(shop);
  const b = await requested(shop);
  await assignTo(a.deliveryId, driverId);
  await assert.rejects(assignTo(b.deliveryId, driverId), OfferUnavailableError);
  assert.notEqual((await deliveryOf(b.deliveryId)).driverId, driverId);
});

// ---------------------------------------------------------------------------
// E2E 4 — suspended / unapproved drivers can't operate
// ---------------------------------------------------------------------------

test("E2E 4: a suspended driver can't go online, receive offers, or accept an old offer", async () => {
  const shop = await makeShop("e2e4");
  const driverId = await makeDriver("e2e4");
  const { deliveryId } = await requested(shop);
  const offer = await prisma.deliveryOffer.findFirst({ where: { networkDeliveryId: deliveryId, driverId } });

  await suspendDriver("admin-test", driverId, "Complaint under investigation");
  const p = await prisma.driverProfile.findUniqueOrThrow({ where: { id: driverId } });
  assert.equal(p.verificationStatus, "SUSPENDED");
  assert.equal(p.availability, "OFFLINE");
  await assert.rejects(requestAvailability(driverId, true), DriverError);
  if (offer) await assert.rejects(acceptOffer(driverId, offer.id), OfferUnavailableError);
  assert.equal((await listDriverOffers(driverId)).length, 0);

  // Not offered in a new round either.
  // Simulate the round happening later (dispatch backs off for REDISPATCH_BACKOFF_MS).
  await prisma.networkDelivery.update({ where: { id: deliveryId }, data: { status: "SEARCHING", dispatchAttemptAt: null } });
  await prisma.deliveryOffer.deleteMany({ where: { networkDeliveryId: deliveryId } });
  await makeDriver("e2e4-control");
  assert.ok((await runDispatch(deliveryId)) > 0, "the round really ran (an eligible driver nearby got an offer)");
  assert.equal(await prisma.deliveryOffer.count({ where: { networkDeliveryId: deliveryId, driverId } }), 0);
});

test("unapproved drivers can't go online; approval needs verified documents", async () => {
  const pending = await makeDriver("pending", { status: "PENDING_REVIEW", online: false });
  await assert.rejects(requestAvailability(pending, true), /can't go online/);
  await prisma.driverDocument.updateMany({ where: { driverId: pending }, data: { status: "PENDING" } });
  await assert.rejects(approveDriver("admin-test", pending), /Accept these documents first/);
  const docs = await prisma.driverDocument.findMany({ where: { driverId: pending } });
  for (const d of docs) await reviewDriverDocument("admin-test", d.id, "ACCEPTED");
  await approveDriver("admin-test", pending);
  assert.deepEqual(await requestAvailability(pending, true), { availability: "ONLINE" });
});

// ---------------------------------------------------------------------------
// E2E 5 — completion needs the customer's code; no skipping steps
// ---------------------------------------------------------------------------

test("E2E 5: completing without (or with a wrong) code is refused; steps can't be skipped; codes lock", async () => {
  const shop = await makeShop("e2e5");
  const driverId = await makeDriver("e2e5");
  const { orderId, deliveryId } = await requested(shop);
  await assignTo(deliveryId, driverId);

  // Can't skip straight to delivered or pickup.
  await assert.rejects(confirmDelivery(driverId, deliveryId, "123456"), InvalidTransitionError);
  await assert.rejects(confirmPickup(driverId, deliveryId, "123456"), InvalidTransitionError);

  await driverStep(driverId, deliveryId, "ARRIVE_PICKUP");
  // Pressing "picked up" without the shop's code fails.
  await assert.rejects(confirmPickup(driverId, deliveryId, ""), /isn't right/);
  const view = await getShopDeliveryView(shop.businessId, orderId);
  await confirmPickup(driverId, deliveryId, view!.pickupCode!);
  await driverStep(driverId, deliveryId, "ARRIVE_DROPOFF");

  for (const bad of ["", "000000", "12345"]) await assert.rejects(confirmDelivery(driverId, deliveryId, bad), /isn't right/);
  assert.equal((await deliveryOf(deliveryId)).status, "ARRIVED_DROPOFF");
  assert.equal(await prisma.driverLedgerEntry.count({ where: { networkDeliveryId: deliveryId } }), 0);

  // Two more wrong tries → locked, even for the right code.
  await assert.rejects(confirmDelivery(driverId, deliveryId, "111111"), /isn't right/);
  await assert.rejects(confirmDelivery(driverId, deliveryId, "222222"), /isn't right/);
  const right = await customerCode(orderId);
  await assert.rejects(confirmDelivery(driverId, deliveryId, right), /Too many wrong codes/);
  // The shop issues a new code; the old one no longer works.
  await rotateDeliveryCode(shop.businessId, shop.staffId, deliveryId, "DROPOFF");
  await assert.rejects(confirmDelivery(driverId, deliveryId, right), /isn't right/);
  const fresh = await customerCode(orderId);
  await confirmDelivery(driverId, deliveryId, fresh);
  assert.equal((await deliveryOf(deliveryId)).status, "DELIVERED");
});

test("another driver can't see or act on a delivery that isn't theirs", async () => {
  const shop = await makeShop("other");
  const mine = await makeDriver("mine");
  const other = await makeDriver("other");
  const { deliveryId } = await requested(shop);
  await assignTo(deliveryId, mine);
  await assert.rejects(driverStep(other, deliveryId, "ARRIVE_PICKUP"), (e) => e instanceof NetworkDeliveryError && e.code === "NOT_FOUND");
  await assert.rejects(failDelivery(other, deliveryId, "nope"), (e) => e instanceof NetworkDeliveryError && e.code === "NOT_FOUND");
  assert.equal(await getDriverActiveDelivery(other), null);
});

// ---------------------------------------------------------------------------
// E2E 2 — tenant isolation
// ---------------------------------------------------------------------------

test("E2E 2: another business can't quote, request, view, cancel or re-code someone else's delivery", async () => {
  const a = await makeShop("tenant-a");
  const b = await makeShop("tenant-b");
  const orderA = await makePaidOrder(a.businessId);
  assert.deepEqual(await quoteForOrder(b.businessId, orderA), { ok: false, reason: "Order not found." });
  await assert.rejects(requestNetworkDelivery(b, { orderId: orderA, requestKey: `x-${run}-b`, confirmedFeeCents: 3500 }), /Order not found/);

  const { orderId, deliveryId } = await requested(a);
  assert.equal(await getShopDeliveryView(b.businessId, orderId), null);
  await assert.rejects(cancelNetworkDelivery({ type: "SHOP", id: b.staffId, businessId: b.businessId }, deliveryId, "mine now"), /not found/);
  await assert.rejects(rotateDeliveryCode(b.businessId, b.staffId, deliveryId, "PICKUP"), /not found/);
  assert.notEqual((await deliveryOf(deliveryId)).status, "CANCELLED");
});

// ---------------------------------------------------------------------------
// Shop request rules
// ---------------------------------------------------------------------------

test("only paid, confirmed, delivery orders without a driver are eligible", async () => {
  const shop = await makeShop("elig");
  for (const [over, reason] of [
    [{ paymentStatus: "PENDING" }, /paid/],
    [{ status: "PENDING" }, /Accept the order/],
    [{ status: "CANCELLED" }, /Accept the order/],
    [{ fulfilmentMethod: "COLLECTION" }, /not a delivery/],
  ] as const) {
    const orderId = await makePaidOrder(shop.businessId, over);
    const r = await checkOrderEligibility(shop.businessId, orderId);
    assert.equal(r.ok, false, JSON.stringify(over));
    if (!r.ok) assert.match(r.reason, reason);
  }
});

test("price manipulation is refused; a double click returns the same delivery", async () => {
  const shop = await makeShop("price");
  const orderId = await makePaidOrder(shop.businessId);
  await assert.rejects(requestNetworkDelivery(shop, { orderId, requestKey: `p-${run}-1`, confirmedFeeCents: 1 }), (e) => e instanceof NetworkDeliveryError && e.code === "PRICE_CHANGED");
  const quote = await quoteForOrder(shop.businessId, orderId);
  assert.ok(quote.ok);
  const key = `p-${run}-2`;
  const [x, y] = await Promise.all([
    requestNetworkDelivery(shop, { orderId, requestKey: key, confirmedFeeCents: quote.quoteFeeCents }),
    requestNetworkDelivery(shop, { orderId, requestKey: key, confirmedFeeCents: quote.quoteFeeCents }),
  ]);
  assert.equal(x.deliveryId, y.deliveryId);
  assert.equal(await prisma.networkDelivery.count({ where: { orderId } }), 1);
  // A different key for the same order is still refused while one is open.
  await assert.rejects(requestNetworkDelivery(shop, { orderId, requestKey: `p-${run}-3`, confirmedFeeCents: quote.quoteFeeCents }), /already been requested/);
  // The stored fee is the server's, in cents.
  assert.equal((await prisma.networkDelivery.findFirstOrThrow({ where: { orderId } })).quoteFeeCents, quote.quoteFeeCents);
});

test("never both: an order with a network driver can't also get a staff driver", async () => {
  const shop = await makeShop("both");
  const { orderId } = await requested(shop);
  const od = await prisma.orderDelivery.findUniqueOrThrow({ where: { orderId } });
  await assert.rejects(assignDriver(shop.businessId, od.id, "any-staff"), /Skhokholetha driver is handling/);
});

test("cancel before pickup frees the driver; after pickup it's refused", async () => {
  const shop = await makeShop("cancel");
  const driverId = await makeDriver("cancel");
  const first = await requested(shop);
  await assignTo(first.deliveryId, driverId);
  await cancelNetworkDelivery({ type: "SHOP", id: shop.staffId, businessId: shop.businessId }, first.deliveryId, "Customer changed their mind");
  assert.equal((await deliveryOf(first.deliveryId)).status, "CANCELLED");
  assert.equal((await prisma.driverProfile.findUniqueOrThrow({ where: { id: driverId } })).availability, "ONLINE");
  // A cancelled request doesn't block asking again for the same order.
  const quote = await quoteForOrder(shop.businessId, first.orderId);
  assert.ok(quote.ok, JSON.stringify(quote));

  const second = await requested(shop);
  await assignTo(second.deliveryId, driverId);
  await driverStep(driverId, second.deliveryId, "ARRIVE_PICKUP");
  const view = await getShopDeliveryView(shop.businessId, second.orderId);
  await confirmPickup(driverId, second.deliveryId, view!.pickupCode!);
  await assert.rejects(cancelNetworkDelivery({ type: "SHOP", id: shop.staffId, businessId: shop.businessId }, second.deliveryId, "too late"), InvalidTransitionError);
});

// ---------------------------------------------------------------------------
// Tracking and location privacy
// ---------------------------------------------------------------------------

test("tracking: only this delivery, minimal data, live position only while carrying, links expire", async () => {
  const shop = await makeShop("track");
  const driverId = await makeDriver("track");
  const { orderId, deliveryId } = await requested(shop);
  const token = (await getShopDeliveryView(shop.businessId, orderId))!.trackingToken;

  const before = await getTrackingView(token);
  assert.equal(before!.driverPosition, null);
  assert.equal(before!.driver, null);
  assert.equal(await getTrackingView("not-a-real-token-at-all-xxxxxxxxxx"), null);
  assert.equal(await getTrackingView(token.slice(0, -2) + "aa"), null, "a near-miss token finds nothing");

  await assignTo(deliveryId, driverId);
  await driverStep(driverId, deliveryId, "ARRIVE_PICKUP");
  await recordDriverPosition(driverId, { lat: PICKUP.lat, lng: PICKUP.lng });
  assert.equal((await getTrackingView(token))!.driverPosition, null, "no position before pickup");
  const code = (await getShopDeliveryView(shop.businessId, orderId))!.pickupCode!;
  await confirmPickup(driverId, deliveryId, code);
  await recordDriverPosition(driverId, { lat: -26.255, lng: 27.86 });
  const live = await getTrackingView(token);
  assert.deepEqual(live!.driverPosition, { lat: -26.255, lng: 27.86 });
  assert.equal(live!.driver!.firstName, "Driver");
  assert.equal(JSON.stringify(live).includes("+2783"), false, "no driver phone");
  assert.ok(live!.etaMinutes && live!.etaMinutes > 0);

  // After it ends (failed + returned here) the link expires 24h later.
  await failDelivery(driverId, deliveryId, "Nobody home");
  assert.equal((await deliveryOf(deliveryId)).driverLat, null, "position cleared when it ends");
  await prisma.networkDelivery.update({ where: { id: deliveryId }, data: { trackingExpiresAt: new Date(Date.now() - 1000) } });
  assert.equal(await getTrackingView(token), null);
});

test("location: offline drivers aren't tracked; consent required; forged coordinates refused", async () => {
  const driverId = await makeDriver("loc", { online: false });
  assert.deepEqual(await recordDriverPosition(driverId, { lat: -26.2, lng: 27.9 }), { stored: false, nextInSeconds: null });
  await assert.rejects(recordDriverPosition(driverId, { lat: 200, lng: 27.9 }), DriverError);
  await assert.rejects(recordDriverPosition(driverId, { lat: 0, lng: 0 }), DriverError);
  await assert.rejects(recordDriverPosition(driverId, { lat: -26.2, lng: 27.9, injected: "x" }));
  await prisma.driverProfile.update({ where: { id: driverId }, data: { locationConsentAt: null } });
  await assert.rejects(recordDriverPosition(driverId, { lat: -26.2, lng: 27.9 }), /Allow location/);
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

test("documents: type checked by content, size-limited, editable only before submission", async () => {
  const driverId = await makeDriver("docs", { status: "PENDING_REVIEW", online: false });
  await prisma.driverProfile.update({ where: { id: driverId }, data: { verificationStatus: "DRAFT" } });
  const pdf = Buffer.from("%PDF-1.4 minimal");
  const ok = await uploadDriverDocument(driverId, { kind: "ID_DOCUMENT", fileName: "../../id.pdf", contentType: "application/pdf", bytes: pdf });
  assert.equal(ok.fileName, "id.pdf");
  await assert.rejects(uploadDriverDocument(driverId, { kind: "ID_DOCUMENT", fileName: "x.pdf", contentType: "application/pdf", bytes: Buffer.from("<html>not a pdf</html>") }), /isn't really/);
  await assert.rejects(uploadDriverDocument(driverId, { kind: "ID_DOCUMENT", fileName: "x.exe", contentType: "application/x-msdownload", bytes: Buffer.from("MZ") }), /PDF, JPG/);
  await assert.rejects(uploadDriverDocument(driverId, { kind: "ID_DOCUMENT", fileName: "big.pdf", contentType: "application/pdf", bytes: Buffer.concat([pdf, Buffer.alloc(5 * 1024 * 1024)]) }), /5 MB/);
  await assert.rejects(uploadDriverDocument(driverId, { kind: "PASSPORT_PHOTO", fileName: "x.pdf", contentType: "application/pdf", bytes: pdf }));
  await prisma.driverProfile.update({ where: { id: driverId }, data: { verificationStatus: "PENDING_REVIEW" } });
  await assert.rejects(uploadDriverDocument(driverId, { kind: "ID_DOCUMENT", fileName: "id.pdf", contentType: "application/pdf", bytes: pdf }), /with our team/);
});

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

test("ledger: held → available → payout → paid; a payout can't double-claim; balances are sums", async () => {
  const shop = await makeShop("ledger");
  const driverId = await makeDriver("ledger");
  const { orderId, deliveryId } = await requested(shop);
  await assignTo(deliveryId, driverId);
  await driverStep(driverId, deliveryId, "ARRIVE_PICKUP");
  const view = await getShopDeliveryView(shop.businessId, orderId);
  await confirmPickup(driverId, deliveryId, view!.pickupCode!);
  await driverStep(driverId, deliveryId, "ARRIVE_DROPOFF");
  await confirmDelivery(driverId, deliveryId, await customerCode(orderId));

  const amount = (await deliveryOf(deliveryId)).driverEarningCents;
  assert.deepEqual(await getDriverBalance(driverId), { pendingCents: amount, availableCents: 0, inPayoutCents: 0, paidCents: 0 });
  await assert.rejects(createDriverPayout("admin-test", driverId), /Nothing available/);

  await releaseDueEarnings(new Date(Date.now() + 25 * 60 * 60 * 1000));
  assert.equal((await getDriverBalance(driverId)).availableCents, amount);

  const [p1, p2] = await Promise.allSettled([createDriverPayout("admin-test", driverId), createDriverPayout("admin-test", driverId)]);
  const made = [p1, p2].filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ id: string; amountCents: number }>[];
  assert.equal(made.length, 1, "entries are claimed once");
  assert.equal(made[0].value.amountCents, amount);
  await markPayoutPaid("admin-test", made[0].value.id, "EFT-REF-1");
  assert.deepEqual(await getDriverBalance(driverId), { pendingCents: 0, availableCents: 0, inPayoutCents: 0, paidCents: amount });
  await assert.rejects(markPayoutPaid("admin-test", made[0].value.id, "again"), /Only a requested payout/);
});

test("dispatch housekeeping: expired offers lapse back to searching and re-offer to someone new", async () => {
  const shop = await makeShop("expire");
  // Only this test's drivers are online, so the nearest-3 ranking is predictable.
  await prisma.driverProfile.updateMany({ where: { availability: "ONLINE" }, data: { availability: "OFFLINE" } });
  const first = await makeDriver("expire-1");
  const { deliveryId } = await requested(shop);
  const offered = await prisma.deliveryOffer.findMany({ where: { networkDeliveryId: deliveryId } });
  assert.ok(offered.some((o) => o.driverId === first));
  // Simulate the 90s offer window passing: offers expired, last round long ago.
  await prisma.deliveryOffer.updateMany({ where: { networkDeliveryId: deliveryId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await prisma.networkDelivery.update({ where: { id: deliveryId }, data: { dispatchAttemptAt: new Date(Date.now() - 120_000) } });
  const second = await makeDriver("expire-2");
  await tickDispatch(new Date(), 50);
  assert.equal(await prisma.deliveryOffer.count({ where: { networkDeliveryId: deliveryId, status: "EXPIRED" } }) >= 1, true);
  assert.ok(await prisma.deliveryOffer.findFirst({ where: { networkDeliveryId: deliveryId, driverId: second, status: "PENDING" } }), "re-offered to the new driver");
  // Declining is recorded and frees the delivery for others.
  const o2 = await prisma.deliveryOffer.findFirstOrThrow({ where: { networkDeliveryId: deliveryId, driverId: second } });
  await declineOffer(second, o2.id);
  assert.equal((await prisma.deliveryOffer.findUniqueOrThrow({ where: { id: o2.id } })).status, "DECLINED");
});

test("delivery events are append-only at the database level", async () => {
  const shop = await makeShop("audit");
  const { deliveryId } = await requested(shop);
  const ev = await prisma.deliveryEvent.findFirstOrThrow({ where: { networkDeliveryId: deliveryId } });
  await assert.rejects(prisma.deliveryEvent.update({ where: { id: ev.id }, data: { type: "tampered" } }), /append-only/);
});

test("the money check: a quote's split must add up (database constraint)", async () => {
  const shop = await makeShop("money");
  const { deliveryId } = await requested(shop);
  await assert.rejects(prisma.networkDelivery.update({ where: { id: deliveryId }, data: { driverEarningCents: 999999 } }));
});

test("codes are derived, not stored: the database holds no plaintext code", async () => {
  const shop = await makeShop("codes");
  const { deliveryId } = await requested(shop);
  const d = await deliveryOf(deliveryId);
  const code = deriveCode("PICKUP", d.id, d.pickupCodeNonce);
  assert.equal(JSON.stringify(d).includes(code), false);
});
