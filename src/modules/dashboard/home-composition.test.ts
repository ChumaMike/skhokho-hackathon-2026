import test from "node:test";
import assert from "node:assert/strict";
import { computeLapsedRegulars, getHomeSections, getQuickActions } from "./home-composition";
import { ALL_PERMISSIONS, NO_PERMISSIONS, STAFF_PERMISSIONS_BY_PRESET } from "@/types";
import type { MemberRow } from "@/modules/customers/customer.service";

function member(overrides: Partial<Pick<MemberRow, "stamps" | "last_seen">>): Pick<MemberRow, "stamps" | "last_seen"> {
  return { stamps: 1, last_seen: new Date(), ...overrides };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// computeLapsedRegulars
// ---------------------------------------------------------------------------

test("a customer with only one stamp never counts as a lapsed regular, no matter how long ago", () => {
  const members = [member({ stamps: 1, last_seen: new Date(Date.now() - 90 * DAY_MS) })];
  assert.equal(computeLapsedRegulars(members), 0);
});

test("a regular (2+ stamps) seen recently is not counted as lapsed", () => {
  const members = [member({ stamps: 5, last_seen: new Date(Date.now() - 2 * DAY_MS) })];
  assert.equal(computeLapsedRegulars(members), 0);
});

test("a regular (2+ stamps) not seen in 30+ days is counted as lapsed", () => {
  const members = [member({ stamps: 3, last_seen: new Date(Date.now() - 45 * DAY_MS) })];
  assert.equal(computeLapsedRegulars(members), 1);
});

test("computeLapsedRegulars counts correctly across a mixed set", () => {
  const members = [
    member({ stamps: 1, last_seen: new Date(Date.now() - 90 * DAY_MS) }), // one-timer, never counts
    member({ stamps: 4, last_seen: new Date(Date.now() - 60 * DAY_MS) }), // lapsed regular
    member({ stamps: 6, last_seen: new Date(Date.now() - 1 * DAY_MS) }), // active regular
    member({ stamps: 2, last_seen: new Date(Date.now() - 31 * DAY_MS) }), // lapsed regular
  ];
  assert.equal(computeLapsedRegulars(members), 2);
});

// ---------------------------------------------------------------------------
// getHomeSections
// ---------------------------------------------------------------------------

const BOOKING_ONLY = new Set(["SERVICES", "BOOKINGS", "LOYALTY"] as const);
const ORDERS_ONLY = new Set(["PRODUCTS", "ORDERS"] as const);
const FOOD_WITH_DELIVERY = new Set(["PRODUCTS", "ORDERS", "PICKUP", "DELIVERY", "LOYALTY"] as const);

test("a booking-only business shows no orders section", () => {
  const sections = getHomeSections(BOOKING_ONLY, ALL_PERMISSIONS, true);
  assert.equal(sections.showOrdersToday, false);
  assert.equal(sections.showBookingsToday, true);
});

test("an order-only business shows no bookings section", () => {
  const sections = getHomeSections(ORDERS_ONLY, ALL_PERMISSIONS, true);
  assert.equal(sections.showOrdersToday, true);
  assert.equal(sections.showBookingsToday, false);
});

test("retention requires the LOYALTY capability, not just a permission", () => {
  const withLoyalty = getHomeSections(new Set(["PRODUCTS", "ORDERS", "LOYALTY"] as const), ALL_PERMISSIONS, true);
  assert.equal(withLoyalty.showRetention, true);
  const withoutLoyalty = getHomeSections(ORDERS_ONLY, ALL_PERMISSIONS, true);
  assert.equal(withoutLoyalty.showRetention, false);
});

test("Kitchen-shaped permissions (canPrepareOrders only) still surface 'happening now' for an ORDERS business", () => {
  const kitchenLike = { ...NO_PERMISSIONS, canPrepareOrders: true };
  const sections = getHomeSections(FOOD_WITH_DELIVERY, kitchenLike, false);
  assert.equal(sections.showHappeningNow, true);
});

test("a permission set with nothing operational (Kitchen-shaped, no CRM/payments/analytics) shows no retention section", () => {
  const kitchenLike = { ...NO_PERMISSIONS, canPrepareOrders: true };
  const sections = getHomeSections(FOOD_WITH_DELIVERY, kitchenLike, false);
  assert.equal(sections.showRetention, false, "Kitchen has no canManageCustomers/canIssueLoyalty");
});

test("Manager gets full operational sections without owner-only anything (getHomeSections has no owner-only concept beyond bypass)", () => {
  const sections = getHomeSections(FOOD_WITH_DELIVERY, STAFF_PERMISSIONS_BY_PRESET.MANAGER, false);
  assert.equal(sections.showOrdersToday, true);
  assert.equal(sections.showHappeningNow, true);
  assert.equal(sections.showRetention, true);
});

test("GENERAL/null-workspace-shaped permissions (the default Staff preset) get backward-compatible section visibility", () => {
  const sections = getHomeSections(FOOD_WITH_DELIVERY, STAFF_PERMISSIONS_BY_PRESET.STAFF, false);
  assert.equal(sections.showOrdersToday, true);
  assert.equal(sections.showRetention, true, "General Staff has canManageCustomers/canIssueLoyalty");
});

// ---------------------------------------------------------------------------
// getQuickActions
// ---------------------------------------------------------------------------

test("Invite a team member only ever appears for the owner", () => {
  const owner = getQuickActions(FOOD_WITH_DELIVERY, ALL_PERMISSIONS, true);
  assert.ok(owner.some((a) => a.id === "invite-staff"));

  const manager = getQuickActions(FOOD_WITH_DELIVERY, STAFF_PERMISSIONS_BY_PRESET.MANAGER, false);
  assert.ok(!manager.some((a) => a.id === "invite-staff"), "Manager is not the owner, even with a broad permission set");
});

test("Give a stamp requires both the LOYALTY capability and canIssueLoyalty", () => {
  const withBoth = getQuickActions(FOOD_WITH_DELIVERY, STAFF_PERMISSIONS_BY_PRESET.CASHIER, false);
  assert.ok(withBoth.some((a) => a.id === "give-stamp"));

  const noCapability = getQuickActions(new Set(["PRODUCTS", "ORDERS"] as const), STAFF_PERMISSIONS_BY_PRESET.CASHIER, false);
  assert.ok(!noCapability.some((a) => a.id === "give-stamp"));

  const noPermission = getQuickActions(FOOD_WITH_DELIVERY, { ...NO_PERMISSIONS, canPrepareOrders: true }, false);
  assert.ok(!noPermission.some((a) => a.id === "give-stamp"), "Kitchen-shaped permissions have no canIssueLoyalty");
});

test("a Kitchen-shaped permission set (canPrepareOrders only) gets no quick actions at all — no CRM/product/staff authority", () => {
  const kitchenLike = { ...NO_PERMISSIONS, canPrepareOrders: true };
  const actions = getQuickActions(FOOD_WITH_DELIVERY, kitchenLike, false);
  assert.deepEqual(actions, []);
});

test("no action is ever shown for a capability the business doesn't have, regardless of permission", () => {
  const bookingOnlyBusiness = getQuickActions(BOOKING_ONLY, ALL_PERMISSIONS, true);
  // No PRODUCTS/ORDERS capability, but SERVICES is present so catalog add still shows.
  assert.ok(bookingOnlyBusiness.some((a) => a.id === "add-product"));
  const noCatalogCapability = getQuickActions(new Set(["BOOKINGS"] as const), ALL_PERMISSIONS, true);
  assert.ok(!noCatalogCapability.some((a) => a.id === "add-product"));
});
