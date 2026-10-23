import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { hashPassword } from "@/modules/auth/auth.service";
import { createBusiness, publishBusiness, getPublishReadiness } from "@/modules/tenant/tenant.service";
import { createProduct } from "@/modules/catalog/catalog.service";
import { createCategory } from "@/modules/catalog/menu-options.service";
import { setDeliverySettings, setFulfilmentSettings, setOrderingPause, setPaymentSettings } from "@/modules/tenant/capabilities";
import { setOperatingHours } from "@/modules/tenant/operating-hours";
import { inviteStaff } from "@/modules/staff/staff.service";
import { changeBusinessPlan } from "@/modules/billing/subscription.service";
import { STAFF_PRESETS } from "@/modules/staff/staff-presets";
import { resolveStorefrontCartQuote } from "./storefront-cart";
import { createOrder, advanceOrderStatus, completeOrder, cancelOrder, recordInPersonPayment, listOrders, getOrder, listKitchenOrders, canAdvanceOrderFromStatus } from "./order.service";
import { assignDriver, markPickedUp, markDelivered, listEligibleDrivers, listMyDeliveries, canActOnDelivery } from "./order-delivery.service";
import { createZone, setZoneActive } from "@/modules/delivery/zones.service";
import { countUnreadNotificationsFor, markAllNotificationsReadFor, listRecentNotificationsFor } from "@/modules/dashboard/notifications";
import { __setEmailTransportForTests } from "@/lib/email";
import { enableLethaForTests, LEGAL_FIELDS_ACCEPTED } from "@/modules/skhokholetha/testing";
import { FeatureDisabledError } from "@/modules/skhokholetha/flags";
import { checkOrderEligibility, quoteForOrder, requestNetworkDelivery, getShopDeliveryView, driverStep, confirmPickup, confirmDelivery, getCustomerDeliveryView, NetworkDeliveryError } from "@/modules/skhokholetha/delivery.service";
import { listDriverOffers, acceptOffer } from "@/modules/skhokholetha/dispatch.service";
import { issueCustomerDeliveryKey } from "@/modules/skhokholetha/customer-key";
import { saveConnection, getConnection, markConnectionVerified } from "@/modules/payments/payment-connection.service";
import { createAttempt, closeAttempt, settleAttempt, expireStaleAttemptsForOrder, MAX_OPEN_ATTEMPTS_PER_ORDER } from "@/modules/payments/payment-attempt.service";

/**
 * Controlled-pilot rehearsal, run against the test database with the real
 * services (the same functions the routes and server actions call). One
 * generic, zone-priced, delivery-heavy shop is configured the way a merchant
 * would configure it in Settings — nothing merchant-specific lives in code.
 *
 * Covers: zone configuration and enforcement (Phase 4), the complete
 * collection, own-driver and Skhokholetha journeys (Phase 5), what each
 * staff preset may do and cross-tenant refusal (Phase 6), a busy period
 * (Phase 7) and practical failure scenarios (Phase 8).
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const PICKUP = { lat: -26.2485, lng: 27.854 };
const DROPOFF = { lat: -26.26, lng: 27.87 };
const CUSTOMER_EMAIL = `customer-${run}@example.test`;

type Sent = { to: string; subject: string };
const sent: Sent[] = [];
let emailShouldFail = false;
const transport = async (msg: { to: string; subject: string }) => {
  if (emailShouldFail) return { id: null, errorName: "provider_down" };
  sent.push({ to: msg.to, subject: msg.subject });
  return { id: `msg-${sent.length}` };
};
const customerMail = () => sent.filter((m) => m.to === CUSTOMER_EMAIL).map((m) => m.subject);
/** Customer emails are fire-and-forget after the transaction (one DB read + send); wait for them to land. */
const settle = () => new Promise((r) => setTimeout(r, 2500));

let restoreEnv: () => void;

interface Shop {
  id: string;
  slug: string;
  ownerStaffId: string;
  productId: string;
  zones: { near: string; mid: string; far: string };
  staff: Record<"manager" | "cashier" | "kitchen" | "driver", string>;
}
let shop: Shop;
let otherShop: { id: string; productId: string; zoneId: string; staffId: string };
let networkDriverId: string;
let seq = 0;

async function makeShop(label: string) {
  const { business, owner } = await createBusiness({
    name: `Pilot Rehearsal ${label}`,
    category: "FOOD_VENDOR" as never,
    owner: { firstName: "Owner", lastName: label, email: `pilot-${label}-${run}@example.test`, passwordHash: await hashPassword("SomePassword123") },
  });
  // The shop pin is set through the address form in Settings; it is what distance and Skhokholetha need.
  await prisma.business.update({ where: { id: business.id }, data: { latitude: PICKUP.lat, longitude: PICKUP.lng, suburb: "Soweto" } });
  return { business, owner };
}

/** Everything the checkout route derives from the quote before calling createOrder. */
async function placeOrder(opts: { fulfilment: "COLLECTION" | "DELIVERY"; zoneId?: string; key?: string; geocoded?: boolean; businessId?: string; productId?: string }) {
  const businessId = opts.businessId ?? shop.id;
  const productId = opts.productId ?? shop.productId;
  const quote = await resolveStorefrontCartQuote({
    businessId,
    lines: [{ productId, quantity: 2 }],
    fulfilmentMethod: opts.fulfilment,
    deliveryAddress: opts.fulfilment === "DELIVERY" ? "12 Vilakazi St, Orlando West" : undefined,
    deliveryZoneId: opts.zoneId,
  } as never);
  assert.ok(quote.ok, JSON.stringify(quote));
  if (!quote.ok) throw new Error("unreachable");
  const q = quote.quote;
  seq += 1;
  const order = await createOrder(businessId, {
    source: "online",
    items: [{ productId, name: "Kota", quantity: 2, unitPrice: 50, discount: 0 }],
    fulfilmentMethod: opts.fulfilment,
    deliveryFee: Number(q.deliveryFee),
    deliveryFeeCents: q.deliveryZone ? q.deliveryZones?.find((z) => z.id === q.deliveryZone?.id)?.feeCents : undefined,
    deliveryZoneId: q.deliveryZone?.id,
    deliveryZoneName: q.deliveryZone?.name,
    deliveryAddress: opts.fulfilment === "DELIVERY" ? "12 Vilakazi St, Orlando West" : undefined,
    deliveryContactPhone: opts.fulfilment === "DELIVERY" ? "+27821112222" : undefined,
    deliveryLat: opts.fulfilment === "DELIVERY" && opts.geocoded !== false ? DROPOFF.lat : undefined,
    deliveryLng: opts.fulfilment === "DELIVERY" && opts.geocoded !== false ? DROPOFF.lng : undefined,
    notifyEmail: CUSTOMER_EMAIL,
    notes: "no onions",
    paymentStatus: "PENDING",
    checkoutIdempotencyKey: opts.key ?? `pilot-${run}-${seq}`,
  } as never);
  if (!order) throw new Error("order not created");
  return { order, quote: q };
}

/** The customer's own delivery key (the checkout route issues it right after createOrder). */
async function customerKeyFor(orderId: string) {
  const od = await prisma.orderDelivery.findUniqueOrThrow({ where: { orderId }, select: { id: true } });
  return issueCustomerDeliveryKey(od.id);
}

async function makeNetworkDriver(label: string) {
  const user = await prisma.appUser.create({ data: { email: `pilot-driver-${label}-${run}@example.test`, role: "DRIVER", emailVerifiedAt: new Date() }, select: { id: true } });
  const driver = await prisma.driverProfile.create({
    data: {
      userId: user.id,
      displayName: `Driver ${label}`,
      phone: "+27831234567",
      verificationStatus: "APPROVED",
      availability: "ONLINE",
      locationConsentAt: new Date(),
      ...LEGAL_FIELDS_ACCEPTED(),
      lastLat: PICKUP.lat + 0.005,
      lastLng: PICKUP.lng + 0.005,
      lastLocationAt: new Date(),
      vehicles: { create: { type: "SCOOTER", registration: "CA123456" } },
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

test.before(async () => {
  restoreEnv = enableLethaForTests();
  __setEmailTransportForTests(transport);

  // --- Phase 3: onboarding, entirely through the merchant's own configuration ---------
  const { business, owner } = await makeShop("main");
  // Not live until the owner publishes; publishing needs one product.
  assert.equal(business.status, "PENDING_VERIFICATION");
  assert.deepEqual((await getPublishReadiness(business.id)).missing, ["Add at least one product or service"]);
  const category = await createCategory(business.id, { name: "Kotas" } as never);
  const product = await createProduct(business.id, { name: `Kota ${run}`, price: 50, categoryId: category.id } as never);
  await publishBusiness(business.id);
  assert.equal((await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).status, "ACTIVE");

  // Open around the clock so the rehearsal is not tied to the time of day it runs at
  // (a realistic 08:00-22:00 week failed every journey when the gate ran after 22:00 SAST).
  // The closed-hours behaviour has its own explicit test in Phase 8.
  await setOperatingHours(business.id, {
    monday: { open: "00:00", close: "23:59" }, tuesday: { open: "00:00", close: "23:59" }, wednesday: { open: "00:00", close: "23:59" },
    thursday: { open: "00:00", close: "23:59" }, friday: { open: "00:00", close: "23:59" }, saturday: { open: "00:00", close: "23:59" }, sunday: { open: "00:00", close: "23:59" },
  } as never);
  await setFulfilmentSettings(business.id, { collectionEnabled: true, deliverySources: "BOTH" });
  await setDeliverySettings(business.id, { enabled: true, pricingMode: "ZONE", feeCents: 0 });
  const near = await createZone(business.id, { name: "Zone A (nearby)", feeCents: 1500 });
  const mid = await createZone(business.id, { name: "Zone B", feeCents: 2500, matchKind: "SUBURB_LIST", suburbs: ["Orlando West", "Orlando East"] });
  const far = await createZone(business.id, { name: "Zone C (far)", feeCents: 4000, minOrderCents: 8000 });
  await setPaymentSettings(business.id, { online: true });

  // This rehearsal shop runs a manager, a cashier, a kitchen hand and a driver.
  // FREE includes 2 team members (seeded by 20261004130000), and since the Phase
  // A limit checks landed, inviteStaff refuses the third — correctly: a shop with
  // this cast is a paying shop. GROW (5 seats) is what it would really be on, so
  // the rehearsal says so explicitly rather than depending on limits not being
  // enforced. The `after` hook already clears businessSubscription rows.
  await changeBusinessPlan(business.id, "GROW");

  const invites = {
    manager: await inviteStaff(business.id, { firstName: "Mandla", lastName: "Manager", email: `pilot-manager-${run}@example.test`, preset: "MANAGER" }),
    cashier: await inviteStaff(business.id, { firstName: "Cindy", lastName: "Counter", email: `pilot-cashier-${run}@example.test`, preset: "COUNTER" }),
    kitchen: await inviteStaff(business.id, { firstName: "Kay", lastName: "Kitchen", email: `pilot-kitchen-${run}@example.test`, preset: "KITCHEN" }),
    driver: await inviteStaff(business.id, { firstName: "Dumi", lastName: "Driver", email: `pilot-driver-${run}@example.test`, preset: "DRIVER" }),
  };
  shop = {
    id: business.id,
    slug: business.slug,
    ownerStaffId: owner.id,
    productId: product.id,
    zones: { near: near.id, mid: mid.id, far: far.id },
    staff: {
      manager: invites.manager.staff.id,
      cashier: invites.cashier.staff.id,
      kitchen: invites.kitchen.staff.id,
      driver: invites.driver.staff.id,
    },
  };
  // Invited staff become active once they set a password; the rehearsal does that directly.
  await prisma.businessStaff.updateMany({ where: { id: { in: Object.values(shop.staff) } }, data: { isActive: true } });

  // A second, unrelated shop — every cross-tenant check uses it.
  const other = await makeShop("other");
  const otherProduct = await createProduct(other.business.id, { name: `Vetkoek ${run}`, price: 50 } as never);
  await publishBusiness(other.business.id);
  await setDeliverySettings(other.business.id, { enabled: true, pricingMode: "ZONE", feeCents: 0 });
  const otherZone = await createZone(other.business.id, { name: "Their zone", feeCents: 100 });
  otherShop = { id: other.business.id, productId: otherProduct.id, zoneId: otherZone.id, staffId: other.owner.id };

  networkDriverId = await makeNetworkDriver("net");
});

test.after(async () => {
  restoreEnv();
  __setEmailTransportForTests(null);
  const businesses = await prisma.business.findMany({ where: { name: { startsWith: "Pilot Rehearsal " } }, select: { id: true } });
  const ids = businesses.map((b) => b.id);
  const orders = await prisma.order.findMany({ where: { businessId: { in: ids } }, select: { id: true } });
  const orderIds = orders.map((o) => o.id);
  await prisma.driverLedgerEntry.deleteMany({ where: { driverId: networkDriverId } });
  await prisma.deliveryOffer.deleteMany({ where: { driverId: networkDriverId } });
  await prisma.deliveryEvent.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.networkDelivery.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessPaymentAttempt.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessPaymentEvent.deleteMany({ where: { businessId: { in: ids } } }).catch(() => undefined);
  await prisma.businessPaymentConnection.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.orderDelivery.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.orderItemOption.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } }).catch(() => undefined);
  await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.order.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.deliveryZone.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.product.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.productCategory.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessNotificationRead.deleteMany({ where: { notification: { businessId: { in: ids } } } });
  await prisma.businessNotification.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessStaff.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessRole.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessSubscription.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.business.deleteMany({ where: { id: { in: ids } } });
  await prisma.driverProfile.deleteMany({ where: { id: networkDriverId } });
  await prisma.appUser.deleteMany({ where: { email: { contains: `-${run}@example.test` } } });
});

// ===========================================================================
// Phase 4 — zone configuration, exact fees, tampering, disabling
// ===========================================================================

test("Phase 4: three merchant-defined zones each quote their exact fee; the suburb list pre-selects; the chosen zone's cents are what the order records", async () => {
  const pick = await resolveStorefrontCartQuote({ businessId: shop.id, lines: [{ productId: shop.productId, quantity: 2 }], fulfilmentMethod: "DELIVERY", deliveryZoneId: shop.zones.near } as never);
  assert.ok(pick.ok && pick.quote.deliveryFee === "15.00" && pick.quote.total === "115.00", JSON.stringify(pick));
  // The typed address matches Zone B by suburb without the customer choosing.
  const matched = await resolveStorefrontCartQuote({ businessId: shop.id, lines: [{ productId: shop.productId, quantity: 2 }], fulfilmentMethod: "DELIVERY", deliveryAddress: "7 Khumalo St, Orlando West, Soweto" } as never);
  assert.ok(matched.ok && matched.quote.deliveryZone?.id === shop.zones.mid && matched.quote.deliveryFee === "25.00", JSON.stringify(matched));
  // Zone C needs a bigger basket than R100.
  const tooSmall = await resolveStorefrontCartQuote({ businessId: shop.id, lines: [{ productId: shop.productId, quantity: 1 }], fulfilmentMethod: "DELIVERY", deliveryZoneId: shop.zones.far } as never);
  assert.ok(!tooSmall.ok && tooSmall.code === "BELOW_MINIMUM_ORDER");
  // What customers see == what is charged: the public table carries the same cents.
  assert.deepEqual(pick.ok && pick.quote.deliveryZones?.map((z) => z.feeCents), [1500, 2500, 4000]);

  const { order } = await placeOrder({ fulfilment: "DELIVERY", zoneId: shop.zones.far, productId: shop.productId });
  const od = await prisma.orderDelivery.findUniqueOrThrow({ where: { orderId: order.id } });
  assert.equal(od.deliveryFeeCents, 4000);
  assert.equal(od.deliveryZoneName, "Zone C (far)");
  assert.equal(String(order.total), "140");
});

test("Phase 4: another shop's zone, a made-up zone and no zone are all refused; nothing is created", async () => {
  const before = await prisma.order.count({ where: { businessId: shop.id } });
  for (const zoneId of [otherShop.zoneId, "zone-that-does-not-exist"]) {
    const r = await resolveStorefrontCartQuote({ businessId: shop.id, lines: [{ productId: shop.productId, quantity: 2 }], fulfilmentMethod: "DELIVERY", deliveryZoneId: zoneId } as never);
    assert.ok(!r.ok && r.code === "OUTSIDE_SERVICE_AREA", zoneId);
  }
  const none = await resolveStorefrontCartQuote({ businessId: shop.id, lines: [{ productId: shop.productId, quantity: 2 }], fulfilmentMethod: "DELIVERY", deliveryAddress: "1 Nowhere Rd, Diepkloof" } as never);
  assert.ok(none.ok && none.quote.deliveryFeePending === true, "no area chosen or matched → fee pending, so checkout refuses");
  assert.equal(await prisma.order.count({ where: { businessId: shop.id } }), before);
});

test("Phase 4: disabling a zone stops new delivery orders for it, while an order already placed there keeps its fee and can still be dispatched", async () => {
  const { order } = await placeOrder({ fulfilment: "DELIVERY", zoneId: shop.zones.mid });
  await setZoneActive(shop.id, shop.zones.mid, false);
  const r = await resolveStorefrontCartQuote({ businessId: shop.id, lines: [{ productId: shop.productId, quantity: 2 }], fulfilmentMethod: "DELIVERY", deliveryZoneId: shop.zones.mid } as never);
  assert.ok(!r.ok && r.code === "OUTSIDE_SERVICE_AREA");
  const visible = await resolveStorefrontCartQuote({ businessId: shop.id, lines: [{ productId: shop.productId, quantity: 2 }], fulfilmentMethod: "DELIVERY" } as never);
  assert.ok(visible.ok && !visible.quote.deliveryZones?.some((z) => z.id === shop.zones.mid), "a disabled zone leaves the customer's list");

  // The existing order is untouched and still goes out.
  const od = await prisma.orderDelivery.findUniqueOrThrow({ where: { orderId: order.id } });
  assert.equal(od.deliveryFeeCents, 2500);
  await advanceOrderStatus(shop.id, order.id); // CONFIRMED
  await advanceOrderStatus(shop.id, order.id); // PROCESSING
  await advanceOrderStatus(shop.id, order.id); // READY
  await assignDriver(shop.id, od.id, shop.staff.driver);
  assert.equal((await prisma.orderDelivery.findUniqueOrThrow({ where: { id: od.id } })).status, "ASSIGNED");
  await setZoneActive(shop.id, shop.zones.mid, true);
});

// ===========================================================================
// Phase 5 — complete customer journeys
// ===========================================================================

test("Phase 5: collection journey — placed → confirmed → preparing → ready (customer told) → paid at the counter → completed", async () => {
  sent.length = 0;
  const { order } = await placeOrder({ fulfilment: "COLLECTION" });
  assert.equal(order.status, "PENDING");
  // Merchant signal: an unread "new order" notification for every staff member who can act on it.
  const unreadManager = await countUnreadNotificationsFor(shop.id, shop.staff.manager);
  assert.ok(unreadManager >= 1);

  assert.equal(canAdvanceOrderFromStatus("PENDING", STAFF_PRESETS.KITCHEN.permissions), false, "kitchen cannot accept an order");
  assert.equal(canAdvanceOrderFromStatus("PENDING", STAFF_PRESETS.MANAGER.permissions), true);
  await advanceOrderStatus(shop.id, order.id); // manager: CONFIRMED
  assert.equal(canAdvanceOrderFromStatus("CONFIRMED", STAFF_PRESETS.KITCHEN.permissions), true, "kitchen moves it to preparing");
  await advanceOrderStatus(shop.id, order.id); // kitchen: PROCESSING
  await assert.rejects(completeOrder(shop.id, order.id), /READY/i, "can't be completed while still being prepared");
  await advanceOrderStatus(shop.id, order.id); // kitchen: READY
  await settle();
  assert.deepEqual(customerMail(), [`Order ${order.orderNumber} confirmed`, `Order ${order.orderNumber} is ready to collect`]);

  await recordInPersonPayment(shop.id, order.id, "CASH");
  const done = await completeOrder(shop.id, order.id, shop.staff.cashier);
  assert.equal(done.status, "COMPLETED");
  assert.equal(done.paymentStatus, "PAID");
});

test("Phase 5: own-driver delivery journey — placed → ready → driver assigned → picked up → delivered, with the customer told at each step", async () => {
  sent.length = 0;
  const { order } = await placeOrder({ fulfilment: "DELIVERY", zoneId: shop.zones.near });
  const od = await prisma.orderDelivery.findUniqueOrThrow({ where: { orderId: order.id } });
  await assert.rejects(assignDriver(shop.id, od.id, shop.staff.driver), /READY/, "no dispatch before the order is ready");
  await advanceOrderStatus(shop.id, order.id);
  await advanceOrderStatus(shop.id, order.id);
  await advanceOrderStatus(shop.id, order.id);
  const drivers = await listEligibleDrivers(shop.id);
  assert.ok(drivers.some((d) => d.id === shop.staff.driver), "the Driver preset is offered for assignment");
  await assignDriver(shop.id, od.id, shop.staff.driver);

  // The driver's screen: this delivery with address, phone and items — and nothing from another shop.
  const mine = await listMyDeliveries(shop.id, shop.staff.driver);
  assert.equal(mine.length >= 1, true);
  const row = mine.find((d) => d.id === od.id)!;
  assert.equal(row.deliveryAddressSnapshot, "12 Vilakazi St, Orlando West");
  assert.equal(row.contactPhone, "+27821112222");
  const actor = (staffId: string, p: { canPerformDeliveries: boolean; canManageDeliveries: boolean }) => ({ staffId, isOwner: false, canPerformDeliveries: p.canPerformDeliveries, canManageDeliveries: p.canManageDeliveries });
  assert.equal(canActOnDelivery(actor(shop.staff.driver, STAFF_PRESETS.DRIVER.permissions), { driverStaffId: shop.staff.driver }), true);
  assert.equal(canActOnDelivery(actor(shop.staff.kitchen, STAFF_PRESETS.KITCHEN.permissions), { driverStaffId: shop.staff.driver }), false, "kitchen can't touch a delivery");
  assert.equal(canActOnDelivery(actor(shop.staff.driver, STAFF_PRESETS.DRIVER.permissions), { driverStaffId: shop.staff.manager }), false, "a driver can't act on someone else's delivery");
  assert.equal(canActOnDelivery(actor(shop.staff.manager, STAFF_PRESETS.MANAGER.permissions), { driverStaffId: shop.staff.driver }), true, "a manager may act on any delivery");

  await markPickedUp(shop.id, od.id);
  await markPickedUp(shop.id, od.id); // a double tap is harmless
  assert.equal((await prisma.orderDelivery.findUniqueOrThrow({ where: { id: od.id } })).status, "PICKED_UP");
  await markDelivered(shop.id, od.id, shop.staff.driver);
  const finished = await getOrder(shop.id, order.id);
  assert.equal(finished?.status, "COMPLETED");
  await settle();
  assert.deepEqual(customerMail(), [
    `Order ${order.orderNumber} confirmed`,
    `Order ${order.orderNumber}: a driver is on the way to the shop`,
    `Order ${order.orderNumber} is on its way`,
    `Order ${order.orderNumber} delivered`,
  ]);
  // The merchant's queue shows the completed delivery and who took it.
  const listed = await listOrders(shop.id, { status: "COMPLETED", perPage: 50 });
  const seen = listed.orders.find((o) => o.id === order.id);
  assert.equal(seen?.delivery?.status, "DELIVERED");
  assert.equal(seen?.delivery?.driverStaff?.firstName, "Dumi");
});

test("Phase 5: Skhokholetha journey — paid online → confirmed → network driver → pickup code → drop-off code → completed; the shop sees the real cost", async () => {
  sent.length = 0;
  // A verified LIVE PayFast account (what Settings › Payments produces after the R5 verification).
  await saveConnection(shop.id, { environment: "LIVE", merchantId: `1${Date.now().toString().slice(-7)}`, merchantKey: "46f0cd694581a", passphrase: "test-passphrase" } as never);
  const conn = await getConnection(shop.id, "LIVE");
  await markConnectionVerified(conn!.id, "bootstrap");

  const { order } = await placeOrder({ fulfilment: "DELIVERY", zoneId: shop.zones.near });
  await customerKeyFor(order.id);
  // Before payment Skhokholetha is not an option.
  assert.deepEqual((await checkOrderEligibility(shop.id, order.id)).ok, false);

  const attempt = await createAttempt(shop.id, "LIVE", { orderId: order.id, amount: Number(order.total) });
  const settled = await settleAttempt(attempt.id, `pf-${run}-ok`, { amountMatches: true });
  assert.equal(settled.outcome, "settled");
  assert.equal((await getOrder(shop.id, order.id))?.paymentStatus, "PAID");

  await advanceOrderStatus(shop.id, order.id); // CONFIRMED
  const quote = await quoteForOrder(shop.id, order.id);
  assert.ok(quote.ok, JSON.stringify(quote));
  // Parity: the customer paid R15; the network minimum is R25; the shop sees the R10 top-up before confirming.
  assert.equal(quote.customerFeeCents, 1500);
  assert.equal(quote.quoteFeeCents, 2500);
  assert.equal(quote.merchantCostCents, 1000);

  const key = `pilot-net-${run}`;
  const [a, b] = await Promise.all([
    requestNetworkDelivery({ businessId: shop.id, staffId: shop.staff.manager }, { orderId: order.id, requestKey: key, confirmedFeeCents: quote.quoteFeeCents }),
    requestNetworkDelivery({ businessId: shop.id, staffId: shop.staff.manager }, { orderId: order.id, requestKey: key, confirmedFeeCents: quote.quoteFeeCents }),
  ]);
  assert.equal(a.deliveryId, b.deliveryId, "a double tap is one request");
  const deliveryId = a.deliveryId;
  // The kitchen gets it ready while a driver is found; an own driver can no longer be assigned to the same order.
  await advanceOrderStatus(shop.id, order.id); // PROCESSING
  await advanceOrderStatus(shop.id, order.id); // READY
  const od = await prisma.orderDelivery.findUniqueOrThrow({ where: { orderId: order.id } });
  await assert.rejects(assignDriver(shop.id, od.id, shop.staff.driver), /Skhokholetha driver is handling/);

  const offers = await listDriverOffers(networkDriverId);
  const offer = offers.find((o) => o.shopName.includes("Pilot Rehearsal main"));
  assert.ok(offer, "the online, nearby, approved driver is offered the job");
  await acceptOffer(networkDriverId, offer!.id);
  await driverStep(networkDriverId, deliveryId, "HEAD_TO_PICKUP");
  await driverStep(networkDriverId, deliveryId, "ARRIVE_PICKUP");
  const shopView = await getShopDeliveryView(shop.id, order.id);
  await confirmPickup(networkDriverId, deliveryId, shopView!.pickupCode!);
  await driverStep(networkDriverId, deliveryId, "START_TRANSIT");
  await driverStep(networkDriverId, deliveryId, "ARRIVE_DROPOFF");
  const customerView = await getCustomerDeliveryView(await customerKeyFor(order.id));
  await confirmDelivery(networkDriverId, deliveryId, customerView!.delivery!.dropoffCode!);

  const nd = await prisma.networkDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  assert.equal(nd.status, "DELIVERED");
  assert.equal(nd.customerFeeCents, 1500);
  assert.equal(nd.merchantCostCents, 1000);
  assert.equal((await getOrder(shop.id, order.id))?.status, "COMPLETED");
  const listed = await listOrders(shop.id, { status: "COMPLETED", perPage: 50 });
  assert.equal(listed.orders.find((o) => o.id === order.id)?.delivery?.networkDeliveries?.[0]?.status, "DELIVERED");
  await settle();
  const mail = customerMail();
  assert.ok(mail.includes(`Order ${order.orderNumber} confirmed`));
  assert.ok(mail.includes(`Order ${order.orderNumber}: a driver is on the way to the shop`), mail.join(" | "));
  assert.ok(mail.includes(`Order ${order.orderNumber} is on its way`), mail.join(" | "));
  assert.ok(mail.includes(`Order ${order.orderNumber} delivered`), mail.join(" | "));
});

// ===========================================================================
// Phase 6 — staff presets and cross-tenant access
// ===========================================================================

test("Phase 6: what each preset may do, from the real permission model", () => {
  const P = STAFF_PRESETS;
  // Kitchen: prepare only.
  assert.equal(P.KITCHEN.permissions.canPrepareOrders, true);
  for (const k of ["canManageOrders", "canProcessPayments", "canManageCustomers", "canManageSettings", "canManageStaff", "canViewAnalytics", "canManageDeliveries"] as const) {
    assert.equal(P.KITCHEN.permissions[k], false, `kitchen ${k}`);
  }
  // Cashier: orders, payments, customers — no settings, analytics or staff.
  assert.equal(P.COUNTER.permissions.canManageOrders, true);
  assert.equal(P.COUNTER.permissions.canProcessPayments, true);
  assert.equal(P.COUNTER.permissions.canManageSettings, false);
  assert.equal(P.COUNTER.permissions.canViewAnalytics, false);
  assert.equal(P.COUNTER.permissions.canManageStaff, false);
  // Manager: operations incl. deliveries, catalogue, analytics — no settings, billing, domains, staff.
  assert.equal(P.MANAGER.permissions.canManageDeliveries, true);
  assert.equal(P.MANAGER.permissions.canManageServices, true);
  assert.equal(P.MANAGER.permissions.canViewAnalytics, true);
  assert.equal(P.MANAGER.permissions.canManageSettings, false, "hours / fulfilment / zones stay with the owner");
  assert.equal(P.MANAGER.permissions.canManageBilling, false);
  assert.equal(P.MANAGER.permissions.canInviteStaff, false);
  // Driver: deliveries only.
  assert.equal(P.DRIVER.permissions.canPerformDeliveries, true);
  assert.equal(P.DRIVER.permissions.canManageOrders, false);
  assert.equal(P.DRIVER.permissions.canManageCustomers, false);
  assert.equal(P.DRIVER.permissions.canManageDeliveries, false);
});

test("Phase 6: the kitchen view carries items, the note and collection-vs-delivery, and never the customer's phone, address or payment", async () => {
  const tickets = await listKitchenOrders(shop.id);
  const anyTicket = tickets[0];
  if (anyTicket) {
    assert.deepEqual(Object.keys(anyTicket).sort(), ["createdAt", "fulfilmentMethod", "id", "items", "notes", "orderNumber", "status"]);
  }
  const blob = JSON.stringify(tickets);
  assert.equal(blob.includes("+27821112222"), false);
  assert.equal(blob.includes("Vilakazi"), false);
  assert.equal(blob.includes("paymentStatus"), false);
});

test("Phase 6: every cross-tenant attempt fails safely — the other shop can't read, advance, dispatch, cancel or request a driver for this shop's order", async () => {
  const { order } = await placeOrder({ fulfilment: "DELIVERY", zoneId: shop.zones.near });
  const od = await prisma.orderDelivery.findUniqueOrThrow({ where: { orderId: order.id } });
  assert.equal(await getOrder(otherShop.id, order.id), null);
  assert.equal((await listOrders(otherShop.id, { perPage: 100 })).orders.some((o) => o.id === order.id), false);
  assert.equal((await listKitchenOrders(otherShop.id)).some((o) => o.id === order.id), false);
  await assert.rejects(advanceOrderStatus(otherShop.id, order.id), /not found/i);
  await assert.rejects(cancelOrder(otherShop.id, order.id, { reason: "OTHER", detail: "cross-tenant probe" }), /not found/i);
  await assert.rejects(completeOrder(otherShop.id, order.id), /not found/i);
  await assert.rejects(assignDriver(otherShop.id, od.id, otherShop.staffId), /not found/i);
  await assert.rejects(markPickedUp(otherShop.id, od.id), /not found/i);
  assert.deepEqual(await checkOrderEligibility(otherShop.id, order.id), { ok: false, reason: "Order not found." });
  await assert.rejects(
    requestNetworkDelivery({ businessId: otherShop.id, staffId: otherShop.staffId }, { orderId: order.id, requestKey: `xt-${run}-1`, confirmedFeeCents: 2500 }),
    (e) => e instanceof NetworkDeliveryError,
  );
  await assert.rejects(setZoneActive(otherShop.id, shop.zones.near, false));
  assert.equal((await listMyDeliveries(otherShop.id, shop.staff.driver)).length, 0);
  // The driver of one shop is not an eligible driver at another.
  await assert.rejects(assignDriver(otherShop.id, od.id, shop.staff.driver), /not found/i);
});

// ===========================================================================
// Phase 7 — a busy period
// ===========================================================================

test("Phase 7: a busy hour — mixed orders across zones; the pulse counts, newest-order marker and per-person read state behave", async () => {
  const pulse = async () => {
    const [pending, active, newest] = await Promise.all([
      prisma.order.count({ where: { businessId: shop.id, status: "PENDING" } }),
      prisma.order.count({ where: { businessId: shop.id, status: { in: ["CONFIRMED", "PROCESSING", "READY"] } } }),
      prisma.order.findFirst({ where: { businessId: shop.id, status: { notIn: ["CANCELLED"] } }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    ]);
    return { pending, active, newest: newest?.id ?? null };
  };
  const before = await pulse();
  const placed = [
    await placeOrder({ fulfilment: "COLLECTION" }),
    await placeOrder({ fulfilment: "DELIVERY", zoneId: shop.zones.near }),
    await placeOrder({ fulfilment: "DELIVERY", zoneId: shop.zones.mid }),
    await placeOrder({ fulfilment: "DELIVERY", zoneId: shop.zones.far }),
    await placeOrder({ fulfilment: "COLLECTION" }),
  ];
  const after = await pulse();
  assert.equal(after.pending, before.pending + 5, "the badge counts exactly the new orders");
  assert.equal(after.newest, placed[4].order.id, "the newest-order marker moves once per order, so the chime fires once per order");

  // Two staff tap "Confirm" on the same order at once: exactly one wins, the other is told to reload.
  const target = placed[1].order.id;
  const results = await Promise.allSettled([advanceOrderStatus(shop.id, target), advanceOrderStatus(shop.id, target)]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  assert.equal(fulfilled.length, 1, JSON.stringify(results.map((r) => r.status)));
  assert.equal((await getOrder(shop.id, target))?.status, "CONFIRMED", "no state skipped");
  const again = await pulse();
  assert.equal(again.pending, after.pending - 1);
  assert.equal(again.active, after.active + 1);

  // Nothing disappears: every placed order is in the queue under its status.
  const all = await listOrders(shop.id, { perPage: 100 });
  for (const p of placed) assert.ok(all.orders.some((o) => o.id === p.order.id), p.order.orderNumber);

  // Read state is per person: the manager clearing their list doesn't clear the cashier's.
  await markAllNotificationsReadFor(shop.id, shop.staff.manager);
  assert.equal(await countUnreadNotificationsFor(shop.id, shop.staff.manager), 0);
  assert.ok((await countUnreadNotificationsFor(shop.id, shop.staff.cashier)) >= 5);
  const recent = await listRecentNotificationsFor(shop.id, shop.staff.cashier, { limit: 50 });
  assert.ok(recent.filter((n) => n.type === "new_order" && !n.isRead).length >= 5);

  // Second network request for an order that already has one open: refused, not duplicated.
  const netOrder = placed[2].order;
  await customerKeyFor(netOrder.id);
  await recordInPersonPayment(shop.id, netOrder.id, "CASH");
  await advanceOrderStatus(shop.id, netOrder.id);
  const q = await quoteForOrder(shop.id, netOrder.id);
  assert.ok(q.ok);
  const first = await requestNetworkDelivery({ businessId: shop.id, staffId: shop.staff.manager }, { orderId: netOrder.id, requestKey: `busy-${run}-1`, confirmedFeeCents: q.quoteFeeCents });
  await assert.rejects(
    requestNetworkDelivery({ businessId: shop.id, staffId: shop.staff.manager }, { orderId: netOrder.id, requestKey: `busy-${run}-2`, confirmedFeeCents: q.quoteFeeCents }),
    /already been requested/,
  );
  assert.equal(await prisma.networkDelivery.count({ where: { orderId: netOrder.id } }), 1);
  // Tidy: the shop cancels that request before pickup (the driver is freed).
  const { cancelNetworkDelivery } = await import("@/modules/skhokholetha/delivery.service");
  await cancelNetworkDelivery({ type: "SHOP", id: shop.staff.manager, businessId: shop.id }, first.deliveryId, "Rehearsal tidy-up");
});

// ===========================================================================
// Phase 8 — failure scenarios
// ===========================================================================

test("Phase 8: closed hours and a pause stop new orders (with a basket already built) and resume cleanly", async () => {
  await setOperatingHours(shop.id, { monday: { closed: true }, tuesday: { closed: true }, wednesday: { closed: true }, thursday: { closed: true }, friday: { closed: true }, saturday: { closed: true }, sunday: { closed: true } } as never);
  const closed = await resolveStorefrontCartQuote({ businessId: shop.id, lines: [{ productId: shop.productId, quantity: 2 }], fulfilmentMethod: "COLLECTION" } as never);
  assert.ok(!closed.ok && closed.code === "HOURS_CLOSED");
  await setOperatingHours(shop.id, {
    monday: { open: "00:00", close: "23:59" }, tuesday: { open: "00:00", close: "23:59" }, wednesday: { open: "00:00", close: "23:59" }, thursday: { open: "00:00", close: "23:59" },
    friday: { open: "00:00", close: "23:59" }, saturday: { open: "00:00", close: "23:59" }, sunday: { open: "00:00", close: "23:59" },
  } as never);
  await setOrderingPause(shop.id, new Date(Date.now() + 30 * 60_000));
  const paused = await resolveStorefrontCartQuote({ businessId: shop.id, lines: [{ productId: shop.productId, quantity: 2 }], fulfilmentMethod: "COLLECTION" } as never);
  assert.ok(!paused.ok && paused.code === "ORDERS_PAUSED");
  await setOrderingPause(shop.id, null);
  const open = await resolveStorefrontCartQuote({ businessId: shop.id, lines: [{ productId: shop.productId, quantity: 2 }], fulfilmentMethod: "COLLECTION" } as never);
  assert.ok(open.ok && open.quote.tradingState === "OPEN");
});

test("Phase 8: a failed card payment leaves the order unpaid and retryable; a duplicate checkout is one order; the attempt cap holds", async () => {
  const { order } = await placeOrder({ fulfilment: "COLLECTION", key: `dup-${run}` });
  const twin = await placeOrder({ fulfilment: "COLLECTION", key: `dup-${run}` });
  assert.equal(twin.order.id, order.id, "same idempotency key → same order, no second charge");

  const failed = await createAttempt(shop.id, "LIVE", { orderId: order.id, amount: Number(order.total) });
  await closeAttempt(failed.id, "FAILED", "Card declined");
  const afterFail = await getOrder(shop.id, order.id);
  assert.equal(afterFail?.paymentStatus, "PENDING");
  assert.equal(afterFail?.status, "PENDING", "a failed payment never moves the order");

  // The customer tries again: a fresh attempt is allowed and succeeds.
  const retry = await createAttempt(shop.id, "LIVE", { orderId: order.id, amount: Number(order.total) });
  assert.equal((await settleAttempt(retry.id, `pf-${run}-retry`, { amountMatches: true })).outcome, "settled");
  assert.equal((await getOrder(shop.id, order.id))?.paymentStatus, "PAID");
  // A late duplicate notification for the failed attempt can't un-pay it.
  assert.equal((await settleAttempt(failed.id, `pf-${run}-late`, { amountMatches: true })).outcome !== "settled", true);

  // Open-attempt cap on another order (link previews, refreshes).
  const { order: capped } = await placeOrder({ fulfilment: "COLLECTION" });
  for (let i = 0; i < MAX_OPEN_ATTEMPTS_PER_ORDER; i++) await createAttempt(shop.id, "LIVE", { orderId: capped.id, amount: Number(capped.total) });
  assert.equal(await expireStaleAttemptsForOrder(shop.id, capped.id), MAX_OPEN_ATTEMPTS_PER_ORDER);
});

test("Phase 8: the email provider failing never touches order state, and recovers", async () => {
  sent.length = 0;
  emailShouldFail = true;
  const { order } = await placeOrder({ fulfilment: "COLLECTION" });
  const moved = await advanceOrderStatus(shop.id, order.id);
  assert.equal(moved.status, "CONFIRMED");
  await settle();
  assert.equal(customerMail().length, 0, "the provider refused it; nothing was recorded as sent");
  assert.equal((await getOrder(shop.id, order.id))?.status, "CONFIRMED", "order state is untouched by the email failure");
  emailShouldFail = false;
  await advanceOrderStatus(shop.id, order.id);
  await advanceOrderStatus(shop.id, order.id);
  await settle();
  assert.deepEqual(customerMail(), [`Order ${order.orderNumber} is ready to collect`]);
});

test("Phase 8: no own driver available → the manager switches to Skhokholetha; switched off → honest refusals; flags off → disabled, never a crash", async () => {
  const { order } = await placeOrder({ fulfilment: "DELIVERY", zoneId: shop.zones.near });
  await customerKeyFor(order.id);
  await recordInPersonPayment(shop.id, order.id, "CASH");
  await advanceOrderStatus(shop.id, order.id);
  await advanceOrderStatus(shop.id, order.id);
  await advanceOrderStatus(shop.id, order.id);
  const od = await prisma.orderDelivery.findUniqueOrThrow({ where: { orderId: order.id } });

  await setFulfilmentSettings(shop.id, { collectionEnabled: true, deliverySources: "OWN" });
  assert.match((await checkOrderEligibility(shop.id, order.id)).ok ? "" : (await checkOrderEligibility(shop.id, order.id) as { reason: string }).reason, /switched off in your fulfilment settings/);
  await prisma.businessStaff.update({ where: { id: shop.staff.driver }, data: { isActive: false } });
  assert.equal((await listEligibleDrivers(shop.id)).some((d) => d.id === shop.staff.driver), false, "a deactivated driver is not offered");
  await assert.rejects(assignDriver(shop.id, od.id, shop.staff.driver), /not found/);

  await setFulfilmentSettings(shop.id, { collectionEnabled: true, deliverySources: "NETWORK" });
  await prisma.businessStaff.update({ where: { id: shop.staff.driver }, data: { isActive: true } });
  await assert.rejects(assignDriver(shop.id, od.id, shop.staff.driver), /Skhokholetha drivers only/);
  assert.equal((await checkOrderEligibility(shop.id, order.id)).ok, true);

  // Platform switch off: the request path is disabled; nothing in progress is touched.
  const previous = process.env.DELIVERY_REQUESTS_ENABLED;
  process.env.DELIVERY_REQUESTS_ENABLED = "false";
  try {
    await assert.rejects(
      requestNetworkDelivery({ businessId: shop.id, staffId: shop.staff.manager }, { orderId: order.id, requestKey: `flag-${run}-1`, confirmedFeeCents: 2500 }),
      (e) => e instanceof FeatureDisabledError,
    );
  } finally {
    process.env.DELIVERY_REQUESTS_ENABLED = previous;
  }
  await setFulfilmentSettings(shop.id, { collectionEnabled: true, deliverySources: "BOTH" });
});

test("Phase 8: a delivery order that can't be located on the map can still go with an own driver, but not with Skhokholetha — with a plain reason", async () => {
  const { order } = await placeOrder({ fulfilment: "DELIVERY", zoneId: shop.zones.near, geocoded: false });
  const key = await customerKeyFor(order.id);
  await recordInPersonPayment(shop.id, order.id, "CASH");
  await advanceOrderStatus(shop.id, order.id);
  const e = await checkOrderEligibility(shop.id, order.id);
  assert.ok(!e.ok && /couldn.t be located on the map/.test(e.reason), JSON.stringify(e));
  await advanceOrderStatus(shop.id, order.id);
  await advanceOrderStatus(shop.id, order.id);
  const od = await prisma.orderDelivery.findUniqueOrThrow({ where: { orderId: order.id } });
  await assignDriver(shop.id, od.id, shop.staff.driver);
  await markPickedUp(shop.id, od.id);
  // Own drivers need the customer's drop-off code too (Tab 5): the customer reads it on their own page.
  const page = await getCustomerDeliveryView(key);
  assert.match(page?.ownDelivery?.dropoffCode ?? "", /^\d{6}$/, "the customer's page shows the own-driver code");
  await assert.rejects(markDelivered(shop.id, od.id, shop.staff.driver), /6-digit delivery code/);
  await markDelivered(shop.id, od.id, shop.staff.driver, { code: page!.ownDelivery!.dropoffCode! });
  assert.equal((await getOrder(shop.id, order.id))?.status, "COMPLETED");
});

test("Phase 8: cancelling an order with a Skhokholetha driver still searching cancels the request and frees nothing it shouldn't; once the goods are with a driver, the queue can't cancel", async () => {
  sent.length = 0;
  const { order } = await placeOrder({ fulfilment: "DELIVERY", zoneId: shop.zones.near });
  await customerKeyFor(order.id);
  await recordInPersonPayment(shop.id, order.id, "CASH");
  await advanceOrderStatus(shop.id, order.id);
  const q = await quoteForOrder(shop.id, order.id);
  assert.ok(q.ok);
  const { deliveryId } = await requestNetworkDelivery({ businessId: shop.id, staffId: shop.staff.manager }, { orderId: order.id, requestKey: `cancel-${run}-1`, confirmedFeeCents: q.quoteFeeCents });
  assert.ok(["SEARCHING", "OFFERED"].includes((await prisma.networkDelivery.findUniqueOrThrow({ where: { id: deliveryId } })).status), "a driver is being looked for");

  await cancelOrder(shop.id, order.id, { reason: "CUSTOMER_ASKED", detail: null }, shop.staff.manager);
  assert.equal((await getOrder(shop.id, order.id))?.status, "CANCELLED");
  const nd = await prisma.networkDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  assert.equal(nd.status, "CANCELLED", "no driver is sent to collect a cancelled order");
  assert.equal(await prisma.deliveryOffer.count({ where: { networkDeliveryId: deliveryId, status: "PENDING" } }), 0);
  await settle();
  assert.deepEqual(customerMail().filter((s) => /cancelled/.test(s)), [`Order ${order.orderNumber} was cancelled`]);

  // Own driver already carrying the goods: the queue refuses — only the driver's "delivered" or "problem" ends it.
  const second = await placeOrder({ fulfilment: "DELIVERY", zoneId: shop.zones.near });
  await advanceOrderStatus(shop.id, second.order.id);
  await advanceOrderStatus(shop.id, second.order.id);
  await advanceOrderStatus(shop.id, second.order.id);
  const od = await prisma.orderDelivery.findUniqueOrThrow({ where: { orderId: second.order.id } });
  await assignDriver(shop.id, od.id, shop.staff.driver);
  // Assigned but not yet collected: cancel is allowed and the driver's list is cleared.
  await cancelOrder(shop.id, second.order.id, { reason: "OUT_OF_STOCK", detail: "Shop ran out" }, shop.staff.manager);
  assert.equal((await listMyDeliveries(shop.id, shop.staff.driver)).some((d) => d.id === od.id), false, "the driver no longer sees a cancelled order");
  assert.equal((await prisma.orderDelivery.findUniqueOrThrow({ where: { id: od.id } })).status, "FAILED");

  const third = await placeOrder({ fulfilment: "DELIVERY", zoneId: shop.zones.near });
  await advanceOrderStatus(shop.id, third.order.id);
  await advanceOrderStatus(shop.id, third.order.id);
  await advanceOrderStatus(shop.id, third.order.id);
  const od3 = await prisma.orderDelivery.findUniqueOrThrow({ where: { orderId: third.order.id } });
  await assignDriver(shop.id, od3.id, shop.staff.driver);
  await markPickedUp(shop.id, od3.id);
  await assert.rejects(cancelOrder(shop.id, third.order.id, { reason: "OTHER", detail: "Too late" }, shop.staff.manager), /on its way|already with/i);
  assert.equal((await getOrder(shop.id, third.order.id))?.status, "READY");
  await markDelivered(shop.id, od3.id, shop.staff.driver);
});
