import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { hashPassword } from "@/modules/auth/auth.service";
import { createBusiness, publishBusiness } from "@/modules/tenant/tenant.service";
import { createProduct, createService } from "@/modules/catalog/catalog.service";
import { setDeliverySettings, setFulfilmentSettings, setOrderingPause, setPaymentSettings } from "@/modules/tenant/capabilities";
import { setOperatingHours } from "@/modules/tenant/operating-hours";
import { setLegalInformation } from "@/modules/tenant/legal-information";
import { inviteStaff, setStaffActive } from "@/modules/staff/staff.service";
import { createZone } from "@/modules/delivery/zones.service";
import { createOrder, advanceOrderStatus, completeOrder, cancelOrder, recordInPersonPayment } from "@/modules/orders/order.service";
import { assignDriver } from "@/modules/orders/order-delivery.service";
import { registerCustomer } from "@/modules/customers/customer.service";
import { createAppointment } from "@/modules/appointments/appointment.service";
import { saveConnection, getConnection, markConnectionVerified } from "@/modules/payments/payment-connection.service";
import { __setEmailTransportForTests } from "@/lib/email";
import { enableLethaForTests } from "@/modules/skhokholetha/testing";
import { loadMerchantReadiness, readinessSummary } from "./merchant-readiness";
import { ATTENTION_KINDS, ORDER_ATTENTION, orderAttentionCounts, listOrdersNeedingAttention } from "./order-attention";
import { businessDetail, listBusinesses, setBusinessStatus } from "./businesses.service";
import { runJob } from "./jobs";
import { commerceMetrics, systemMetrics } from "./metrics";
import { evaluateAlerts } from "./alerts";
import { maybeTickDispatch } from "@/modules/skhokholetha/dispatch.service";
import { ensurePlatformAdmin } from "./mfa.service";
import { setAdminRole } from "./admins.service";
import { resetTestDb, testDb } from "@/lib/testing/db";

/**
 * Multi-merchant pilot operations rehearsal. Three GENERIC archetypes are set
 * up through the same services the dashboard calls — nothing merchant-specific
 * in code — and then read back the way the Control Centre reads them:
 *
 *   A. takeaway (FOOD_VENDOR): zones, own + network drivers, card payments wanted
 *   B. spaza (TUCK_SHOP): collection + flat-fee own delivery, cash only
 *   C. salon (SALON): services and bookings, no checkout
 *
 * Covers: derived readiness from real state, stuck-order detection, per-tenant
 * admin visibility, cross-tenant containment of every admin read, and the
 * failure rehearsals that have no other home (job failure, staff removal,
 * admin session revocation, dispatch-tick failure, paused store).
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const NAME = (label: string) => `Pilot Ops ${label} ${run}`;
const MIN = 60_000;
const H = 60 * MIN;

interface Shop { id: string; ownerStaffId: string; productId?: string; serviceId?: string; staff: string[] }
let takeaway: Shop;
let spaza: Shop;
let salon: Shop;
let restoreEnv: () => void;

async function makeBusiness(label: string, category: string) {
  const { business, owner } = await createBusiness({
    name: NAME(label),
    category: category as never,
    owner: { firstName: "Owner", lastName: label, email: `ops-${label}-${run}@example.test`, passwordHash: await hashPassword("SomePassword123") },
  });
  // Readiness also wants the ECTA s43 facts (Dashboard › Settings › Legal); a pilot shop has them filled in.
  await setLegalInformation(business.id, { legalName: `${NAME(label)} (Pty) Ltd`, returnsText: "Bring it back within 7 days with your receipt.", complaintsContact: "082 000 0000" });
  return { business, owner };
}

const HOURS = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, { open: "00:00", close: "23:59" }]));

async function order(shop: Shop, opts: { fulfilment: "COLLECTION" | "DELIVERY"; paid?: boolean; online?: boolean }) {
  const o = await createOrder(shop.id, {
    source: "online",
    items: [{ productId: shop.productId!, name: "Item", quantity: 1, unitPrice: 50, discount: 0 }],
    fulfilmentMethod: opts.fulfilment,
    deliveryFee: 0,
    deliveryAddress: opts.fulfilment === "DELIVERY" ? "1 Test St" : undefined,
    deliveryContactPhone: opts.fulfilment === "DELIVERY" ? "+27821112222" : undefined,
    paymentStatus: opts.paid ? "PAID" : "PENDING",
    // Checkout writes CASH for in-person orders and nothing for online (card) orders.
    ...(opts.online ? {} : { paymentMethod: "CASH" }),
    checkoutIdempotencyKey: `ops-${run}-${Math.random().toString(36).slice(2)}`,
  } as never);
  if (!o) throw new Error("order not created");
  return o;
}

/** Orders are judged by their own clocks; the rehearsal moves those clocks instead of waiting. */
const backdate = (orderId: string, msAgo: number) =>
  prisma.order.update({ where: { id: orderId }, data: { createdAt: new Date(Date.now() - msAgo), updatedAt: new Date(Date.now() - msAgo) } });

test.before(async () => {
  restoreEnv = enableLethaForTests();
  __setEmailTransportForTests(async () => ({ id: "ok" }));

  // --- A. takeaway -----------------------------------------------------------
  const a = await makeBusiness("Takeaway", "FOOD_VENDOR");
  await prisma.business.update({ where: { id: a.business.id }, data: { latitude: -26.2485, longitude: 27.854, phone: "+27821112222" } });
  const aProduct = await createProduct(a.business.id, { name: `Kota ${run}`, price: 50 } as never);
  await publishBusiness(a.business.id);
  await setOperatingHours(a.business.id, HOURS as never);
  await setFulfilmentSettings(a.business.id, { collectionEnabled: true, deliverySources: "BOTH" });
  await setDeliverySettings(a.business.id, { enabled: true, pricingMode: "ZONE", feeCents: 0 });
  await createZone(a.business.id, { name: "Near", feeCents: 1500 });
  await setPaymentSettings(a.business.id, { online: true });
  const driver = await inviteStaff(a.business.id, { firstName: "Dumi", lastName: "Driver", email: `ops-driver-${run}@example.test`, preset: "DRIVER" });
  const cashier = await inviteStaff(a.business.id, { firstName: "Cindy", lastName: "Counter", email: `ops-cashier-${run}@example.test`, preset: "COUNTER" });
  await prisma.businessStaff.update({ where: { id: driver.staff.id }, data: { isActive: true, resetToken: null, lastLoginAt: new Date() } });
  takeaway = { id: a.business.id, ownerStaffId: a.owner.id, productId: aProduct.id, staff: [driver.staff.id, cashier.staff.id] };

  // --- B. spaza ---------------------------------------------------------------
  const b = await makeBusiness("Spaza", "TUCK_SHOP");
  await prisma.business.update({ where: { id: b.business.id }, data: { whatsapp: "+27821113333" } });
  const bProduct = await createProduct(b.business.id, { name: `Bread ${run}`, price: 18 } as never);
  await publishBusiness(b.business.id);
  await setOperatingHours(b.business.id, HOURS as never);
  await setFulfilmentSettings(b.business.id, { collectionEnabled: true, deliverySources: "OWN" });
  await setDeliverySettings(b.business.id, { enabled: true, pricingMode: "FLAT", feeCents: 1000 });
  await setPaymentSettings(b.business.id, { online: false });
  spaza = { id: b.business.id, ownerStaffId: b.owner.id, productId: bProduct.id, staff: [] };

  // --- C. salon ----------------------------------------------------------------
  const c = await makeBusiness("Salon", "SALON");
  await prisma.business.update({ where: { id: c.business.id }, data: { phone: "+27821114444" } });
  const cService = await createService(c.business.id, { name: `Braids ${run}`, price: 350, duration: 120 } as never);
  await publishBusiness(c.business.id);
  await setOperatingHours(c.business.id, HOURS as never);
  salon = { id: c.business.id, ownerStaffId: c.owner.id, serviceId: cService.id, staff: [] };
});

test.after(async () => {
  restoreEnv();
  __setEmailTransportForTests(null);
  const businesses = await prisma.business.findMany({ where: { name: { startsWith: "Pilot Ops " } }, select: { id: true } });
  const ids = businesses.map((b) => b.id);
  const orderIds = (await prisma.order.findMany({ where: { businessId: { in: ids } }, select: { id: true } })).map((o) => o.id);
  await prisma.appointment.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessPaymentAttempt.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessPaymentConnection.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.orderDelivery.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.deliveryZone.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.product.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.service.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessNotificationRead.deleteMany({ where: { notification: { businessId: { in: ids } } } });
  await prisma.businessNotification.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessStaff.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessRole.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessSubscription.deleteMany({ where: { businessId: { in: ids } } });
  // The salon's booking created a membership + consent; consents are append-only by trigger (DELETE refused),
  // so the whole test database is reset the way the tenant-isolation suite does it (TRUNCATE ... CASCADE).
  await resetTestDb();
  await testDb.$disconnect();
  await prisma.jobRun.deleteMany({ where: { job: { startsWith: `ops-${run}` } } });
  await prisma.appUser.deleteMany({ where: { email: { contains: `-${run}@example.test` } } });
});

// ===========================================================================
// Readiness from real state
// ===========================================================================

test("readiness: the takeaway wants card payments and has no verified account — NOT READY until the LIVE connection is verified", async () => {
  let r = (await loadMerchantReadiness([takeaway.id])).get(takeaway.id)!;
  assert.equal(r.overall, "NOT_READY_TO_TRADE");
  assert.deepEqual(r.checks.filter((c) => c.state === "NEEDS_ACTION").map((c) => c.key), ["payments"]);
  assert.equal(r.checks.find((c) => c.key === "deliveryAreas")!.state, "READY");
  assert.equal(r.checks.find((c) => c.key === "staff")!.detail.includes("1 invite(s) not yet accepted"), true, r.checks.find((c) => c.key === "staff")!.detail);

  // The merchant connects and verifies their own LIVE account (the R5 verification flow ends in markConnectionVerified).
  await saveConnection(takeaway.id, { environment: "LIVE", merchantId: "10000100", merchantKey: "46f0cd694581a", passphrase: "a-passphrase-of-length" } as never);
  const conn = await getConnection(takeaway.id, "LIVE");
  const attempt = await prisma.businessPaymentAttempt.create({
    data: { businessId: takeaway.id, connectionId: conn!.id, purpose: "LIVE_VERIFICATION", provider: "PAYFAST", environment: "LIVE", reference: `ver-${run}`, merchantIdSnapshot: "10000100", expectedAmount: 5, currency: "ZAR", status: "COMPLETE" },
    select: { id: true },
  });
  assert.equal(await markConnectionVerified(conn!.id, attempt.id), true);
  r = (await loadMerchantReadiness([takeaway.id])).get(takeaway.id)!;
  assert.equal(r.overall, "READY_TO_TRADE", r.actions.join(" | "));
});

test("readiness: a cash-only spaza with flat-fee own delivery and a bookings-only salon are READY without card or zones", async () => {
  const m = await loadMerchantReadiness([spaza.id, salon.id]);
  const s = m.get(spaza.id)!;
  assert.equal(s.overall, "READY_TO_TRADE", s.actions.join(" | "));
  assert.equal(s.checks.find((c) => c.key === "payments")!.detail, "Pay in person (card payments switched off by the owner).");
  assert.equal(s.checks.find((c) => c.key === "deliveryAreas")!.state, "NOT_APPLICABLE");
  const h = m.get(salon.id)!;
  assert.equal(h.overall, "READY_TO_TRADE", h.actions.join(" | "));
  assert.equal(h.checks.find((c) => c.key === "fulfilment")!.state, "NOT_APPLICABLE");
  assert.equal(h.checks.find((c) => c.key === "catalogue")!.detail, "0 active product(s), 1 active service(s).");
});

test("readiness: hiding the only product, removing hours, or a suspension changes the verdict immediately", async () => {
  await prisma.product.update({ where: { id: spaza.productId! }, data: { isActive: false } });
  let r = (await loadMerchantReadiness([spaza.id])).get(spaza.id)!;
  assert.equal(r.overall, "NOT_READY_TO_TRADE");
  assert.deepEqual(r.actions, ["Products / services: Nothing active to sell — add at least one product or service."]);
  await prisma.product.update({ where: { id: spaza.productId! }, data: { isActive: true } });

  await setBusinessStatus(spaza.id, "SUSPEND");
  r = (await loadMerchantReadiness([spaza.id])).get(spaza.id)!;
  assert.equal(r.overall, "BLOCKED");
  await setBusinessStatus(spaza.id, "REACTIVATE");
  r = (await loadMerchantReadiness([spaza.id])).get(spaza.id)!;
  assert.equal(r.overall, "READY_TO_TRADE");

  const summary = await readinessSummary();
  assert.ok(summary.readyToTrade >= 3, JSON.stringify(summary));
});

test("readiness: a paused store is reported as PAUSED but is still 'ready' (pausing is a trading choice)", async () => {
  await setOrderingPause(spaza.id, new Date(Date.now() + 2 * H));
  const r = (await loadMerchantReadiness([spaza.id])).get(spaza.id)!;
  assert.equal(r.trading.state, "PAUSED");
  assert.equal(r.overall, "READY_TO_TRADE");
  await setOrderingPause(spaza.id, null);
  assert.equal((await loadMerchantReadiness([spaza.id])).get(spaza.id)!.trading.state, "OPEN");
});

// ===========================================================================
// Stuck orders — surfaced, never changed
// ===========================================================================

test("order attention: every defined situation is detected, scoped per business, and nothing is mutated", async () => {
  const fresh = await order(takeaway, { fulfilment: "COLLECTION" });
  const paidUnconfirmed = await order(takeaway, { fulfilment: "COLLECTION", paid: true, online: true });
  await backdate(paidUnconfirmed.id, ORDER_ATTENTION.paidUnconfirmedMin * MIN + MIN);
  const newUnactioned = await order(takeaway, { fulfilment: "COLLECTION" });
  await backdate(newUnactioned.id, ORDER_ATTENTION.newUnactionedMin * MIN + MIN);
  const unpaidOnline = await order(spaza, { fulfilment: "COLLECTION", online: true });
  await backdate(unpaidOnline.id, ORDER_ATTENTION.unpaidOnlineHours * H + MIN);
  const stuck = await order(spaza, { fulfilment: "COLLECTION" });
  await advanceOrderStatus(spaza.id, stuck.id); // CONFIRMED
  await backdate(stuck.id, ORDER_ATTENTION.stuckProcessingHours * H + MIN);
  const readyCollect = await order(spaza, { fulfilment: "COLLECTION" });
  for (let i = 0; i < 3; i++) await advanceOrderStatus(spaza.id, readyCollect.id); // READY
  await backdate(readyCollect.id, ORDER_ATTENTION.readyNotCollectedHours * H + MIN);
  const readyNoDriver = await order(takeaway, { fulfilment: "DELIVERY" });
  for (let i = 0; i < 3; i++) await advanceOrderStatus(takeaway.id, readyNoDriver.id); // READY
  await backdate(readyNoDriver.id, ORDER_ATTENTION.readyNoDeliveryMin * MIN + MIN);
  const ancient = await order(spaza, { fulfilment: "COLLECTION" });
  await backdate(ancient.id, ORDER_ATTENTION.oldActiveHours * H + MIN);

  const now = new Date();
  const all = await orderAttentionCounts(now);
  const a = await orderAttentionCounts(now, takeaway.id);
  const b = await orderAttentionCounts(now, spaza.id);
  const ids = async (kind: (typeof ATTENTION_KINDS)[number]["kind"], businessId?: string) => (await listOrdersNeedingAttention(kind, { now, businessId })).map((o) => o.id);

  assert.ok((await ids("paid_unconfirmed", takeaway.id)).includes(paidUnconfirmed.id));
  assert.ok(!(await ids("paid_unconfirmed", takeaway.id)).includes(fresh.id), "a fresh order is not flagged");
  assert.ok((await ids("new_unactioned", takeaway.id)).includes(newUnactioned.id));
  assert.ok((await ids("unpaid_online", spaza.id)).includes(unpaidOnline.id));
  assert.ok(!(await ids("unpaid_online", spaza.id)).includes(stuck.id), "a cash order is never 'unpaid online'");
  assert.ok((await ids("stuck_processing", spaza.id)).includes(stuck.id));
  assert.ok((await ids("ready_not_collected", spaza.id)).includes(readyCollect.id));
  assert.ok((await ids("ready_no_delivery", takeaway.id)).includes(readyNoDriver.id));
  assert.ok((await ids("old_active", spaza.id)).includes(ancient.id));
  // Scoping: the spaza's problems never appear under the takeaway and vice versa.
  assert.equal(a.stuck_processing, 0);
  assert.equal(b.ready_no_delivery, 0);
  assert.ok(all.total >= a.total + b.total - 0 && all.total >= 7, JSON.stringify(all));
  assert.ok(a.total >= 3 && b.total >= 4);

  // Assigning a driver clears "ready, no driver" — the only way out is a real action.
  const od = await prisma.orderDelivery.findUniqueOrThrow({ where: { orderId: readyNoDriver.id }, select: { id: true } });
  await assignDriver(takeaway.id, od.id, takeaway.staff[0]);
  assert.ok(!(await ids("ready_no_delivery", takeaway.id)).includes(readyNoDriver.id));

  // Nothing was mutated by detection: every flagged order still has the status it had.
  const rows = await prisma.order.findMany({ where: { id: { in: [paidUnconfirmed.id, newUnactioned.id, unpaidOnline.id, stuck.id, readyCollect.id, ancient.id] } }, select: { id: true, status: true } });
  assert.deepEqual(
    Object.fromEntries(rows.map((r) => [r.id, r.status])),
    { [paidUnconfirmed.id]: "PENDING", [newUnactioned.id]: "PENDING", [unpaidOnline.id]: "PENDING", [stuck.id]: "CONFIRMED", [readyCollect.id]: "READY", [ancient.id]: "PENDING" },
  );

  // The alert layer turns the paid-unconfirmed one into a HIGH alert for the overview.
  const alerts = evaluateAlerts({
    db: { up: true, ms: 10 },
    lastDailyRun: new Date(),
    config: { email: true, cronSecret: true, paymentsEncryptionKey: true, livePaymentVerification: false, platformBilling: false, externalAi: false, skhokholetha: { network: false, driverSignup: false, deliveryRequests: false, driverApprovals: false, legalConfigured: false } },
    commerce: await commerceMetrics(now),
    delivery: { drivers: { pending: 0, approved: 0, suspended: 0, online: 0, busy: 0 }, deliveries: { active: 0, searching: 0, late: 0, searchingTooLong: 0, failedLast7d: 0, disputed: 0 }, latency: { medianSecondsToFirstOffer: null, medianSecondsToAssignment: null, samples: 0 } },
    security: { last24h: {}, adminActionsLast24h: 0 },
    system: await systemMetrics(now),
    orders: all,
  });
  assert.ok(alerts.some((x) => x.key === "orders_paid_unconfirmed" && x.severity === "HIGH"));
  assert.ok(alerts.some((x) => x.key === "orders_old_active"));
});

// ===========================================================================
// Admin visibility — each business on its own, no cross-tenant leakage
// ===========================================================================

test("admin: business detail shows each shop's own configuration, staff, catalogue and orders — and only its own", async () => {
  const paid = await order(spaza, { fulfilment: "COLLECTION" });
  await recordInPersonPayment(spaza.id, paid.id, "CASH");
  for (let i = 0; i < 3; i++) await advanceOrderStatus(spaza.id, paid.id);
  await completeOrder(spaza.id, paid.id);
  const cancelled = await order(spaza, { fulfilment: "COLLECTION" });
  await cancelOrder(spaza.id, cancelled.id, { reason: "CUSTOMER_ASKED", detail: null });

  const a = (await businessDetail(takeaway.id))!;
  const b = (await businessDetail(spaza.id))!;
  const c = (await businessDetail(salon.id))!;

  assert.equal(a.configuration.delivery?.mode, "ZONE");
  assert.equal(a.configuration.delivery?.sources, "BOTH");
  assert.deepEqual(a.configuration.zones.map((z) => [z.name, z.feeCents, z.active]), [["Near", 1500, true]]);
  assert.equal(a.configuration.onlinePaymentWanted, true);
  assert.equal(a.configuration.connections[0]?.status, "VERIFIED");
  assert.deepEqual(a.staff.map((s) => [s.role, s.state]).sort(), [["Owner", "active"], ["COUNTER", "invited"], ["DRIVER", "active"]].sort());
  assert.equal(a.readiness?.overall, "READY_TO_TRADE");
  assert.ok(a.recent.orders.length >= 3);
  assert.ok(a.recent.orders.every((o) => !("deliveryAddress" in o)), "no customer details in the detail page");

  assert.equal(b.configuration.delivery?.mode, "FLAT");
  assert.equal(b.configuration.delivery?.feeCents, 1000);
  assert.equal(b.configuration.onlinePaymentWanted, false);
  assert.equal(b.configuration.connections.length, 0);
  assert.equal(b.counts.products, 1);
  assert.ok(b.counts.orders30 >= 6);
  assert.ok(b.gmv30Cents >= 5000, String(b.gmv30Cents));
  assert.ok(b.recent.orders.some((o) => o.status === "COMPLETED") && b.recent.orders.some((o) => o.status === "CANCELLED"));

  assert.equal(c.configuration.delivery, null);
  assert.equal(c.counts.services, 1);
  assert.equal(c.counts.orders30, 0);
  assert.equal(c.readiness?.checks.find((x) => x.key === "fulfilment")?.state, "NOT_APPLICABLE");

  // Containment: nothing of the spaza's shows under the takeaway or the salon.
  const spazaOrderIds = new Set(b.recent.orders.map((o) => o.id));
  assert.ok(a.recent.orders.every((o) => !spazaOrderIds.has(o.id)));
  assert.equal(a.counts.products, 1);
  assert.equal(c.staff.length, 1);
  assert.equal(a.attention.stuck_processing, 0);

  // The list shows all three with their own plan and counts; search is by name only.
  const listed = await listBusinesses({ q: `Pilot Ops`, take: 50 });
  const mine = listed.filter((x) => x.name.endsWith(run));
  assert.equal(mine.length, 3);
  assert.ok(mine.every((x) => x.subscription?.planRef?.name === "Free" || x.subscription?.planRef?.name === "FREE" || x.subscription !== null));

  // Commerce metrics see today's completed and cancelled orders.
  const m = await commerceMetrics();
  assert.ok(m.completedToday >= 1 && m.cancelledToday >= 1 && m.awaitingMerchant >= 1);
});

test("admin: a salon booking shows up as an appointment, never as an order needing attention", async () => {
  const reg = await registerCustomer(salon.id, "+27831230000", "Thandi", "owner_dashboard", salon.ownerStaffId);
  // The business only ever sees the pairwise public id; the membership row id is internal to this tenant.
  const membership = await prisma.membership.findFirstOrThrow({ where: { businessId: salon.id, publicId: reg.public_id }, select: { id: true } });
  await createAppointment(salon.id, { membershipId: membership.id, serviceId: salon.serviceId!, startTime: new Date(Date.now() + 2 * H) });
  assert.equal(await prisma.appointment.count({ where: { businessId: salon.id } }), 1);
  assert.equal((await orderAttentionCounts(new Date(), salon.id)).total, 0);
});

// ===========================================================================
// Failure rehearsals that have no other home
// ===========================================================================

test("failure: a merchant staff member removed mid-shift loses access on the next request (guard reads isActive)", async () => {
  const driverId = takeaway.staff[0];
  await setStaffActive(takeaway.id, driverId, false);
  const row = await prisma.businessStaff.findUniqueOrThrow({ where: { id: driverId }, select: { isActive: true, resetToken: true } });
  assert.equal(row.isActive, false);
  assert.equal(row.resetToken, null, "no invite token survives a removal");
  // The admin view shows the removal, and readiness staff counts drop.
  const d = (await businessDetail(takeaway.id))!;
  assert.equal(d.staff.find((s) => s.id === driverId)?.state, "removed");
  assert.equal(d.counts.staff, 2);
  await setStaffActive(takeaway.id, driverId, true);
});

test("failure: revoking an admin ends their sessions (epoch bump) without touching anyone else", async () => {
  const u1 = await prisma.appUser.create({ data: { email: `ops-admin1-${run}@example.test`, role: "ADMIN" }, select: { id: true } });
  const u2 = await prisma.appUser.create({ data: { email: `ops-admin2-${run}@example.test`, role: "ADMIN" }, select: { id: true } });
  const a1 = await ensurePlatformAdmin(u1.id);
  const a2 = await ensurePlatformAdmin(u2.id);
  await prisma.platformAdmin.update({ where: { id: a1.id }, data: { role: "SUPER_ADMIN" } });
  const before = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: a2.id }, select: { sessionEpoch: true } });
  await setAdminRole(u1.id, a2.id, "FINANCE");
  const after = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: a2.id }, select: { sessionEpoch: true, role: true } });
  assert.equal(after.sessionEpoch, before.sessionEpoch + 1, "a session token minted before the change no longer matches");
  assert.equal(after.role, "FINANCE");
  assert.equal((await prisma.platformAdmin.findUniqueOrThrow({ where: { id: a1.id } })).sessionEpoch, a1.sessionEpoch);
});

test("failure: a failing background job is recorded (job_runs + SYSTEM event), and the alert layer raises it", async () => {
  const r = await runJob(`ops-${run}.broken`, async () => {
    throw new Error("provider timeout after 5000 ms");
  });
  assert.equal(r.ok, false);
  const row = await prisma.jobRun.findFirstOrThrow({ where: { job: `ops-${run}.broken` } });
  assert.equal(row.ok, false);
  assert.match(row.error ?? "", /provider timeout/);
  assert.ok(await prisma.platformAuditEvent.findFirst({ where: { category: "SYSTEM", action: "job_failed", resourceId: `ops-${run}.broken` } }));
  const sys = await systemMetrics();
  assert.ok(sys.jobFailures >= 1);
});

test("failure: a dispatch tick that throws is swallowed for the caller but leaves a SYSTEM event", async () => {
  const count = () => prisma.platformAuditEvent.count({ where: { category: "SYSTEM", action: "dispatch_tick_failed" } });
  const before = await count();
  // A healthy tick: no event.
  assert.equal(typeof (await maybeTickDispatch(new Date())), "boolean");
  assert.equal(await count(), before);
  // An invalid clock makes the rate-limit window computation throw inside the tick — the caller still gets `false`.
  assert.equal(await maybeTickDispatch(new Date(NaN)), false);
  assert.equal(await count(), before + 1, "the failure is recorded once for the health page and the dispatch_errors alert");
});
