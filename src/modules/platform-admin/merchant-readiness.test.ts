import test from "node:test";
import assert from "node:assert/strict";
import { computeMerchantReadiness, type ReadinessInput } from "./merchant-readiness";

/** The Settings › Legal section filled in (ECTA s43 block complete). */
const LEGAL_OK = { legalName: "Mzansi Eats (Pty) Ltd", returnsText: "Prepared food cannot be returned once made; tell us within an hour if something is wrong.", complaintsContact: "082 111 2222" };

/** A takeaway that has done everything the onboarding checklist asks. */
function takeaway(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    status: "ACTIVE",
    category: "FOOD_VENDOR",
    settings: {
      fulfilment: { collectionEnabled: true, deliverySources: "BOTH" },
      delivery: { enabled: true, pricingMode: "ZONE", feeCents: 0 },
      payment: { online: true },
      legal: LEGAL_OK,
    },
    operatingHours: { monday: { open: "08:00", close: "20:00" } },
    phone: "+27821112222",
    whatsapp: null,
    email: "shop@example.test",
    latitude: -26.2,
    longitude: 27.9,
    activeProducts: 4,
    activeServices: 0,
    activeStaff: 3,
    pendingInvites: 0,
    activeZones: 2,
    liveConnection: { status: "VERIFIED" },
    platform: { emailConfigured: true, networkDeliveryEnabled: true, geocodingConfigured: true },
    ...over,
  };
}

const state = (r: ReturnType<typeof computeMerchantReadiness>, key: string) => r.checks.find((c) => c.key === key)!.state;

test("readiness: a fully configured takeaway is READY TO TRADE with every check READY or N/A", () => {
  const r = computeMerchantReadiness(takeaway());
  assert.equal(r.overall, "READY_TO_TRADE");
  assert.deepEqual(r.actions, []);
  assert.equal(r.checks.length, 12);
  assert.equal(state(r, "legal"), "READY");
  for (const c of r.checks) assert.ok(c.state === "READY" || c.state === "NOT_APPLICABLE", `${c.key} is ${c.state}`);
  assert.equal(state(r, "deliveryAreas"), "READY");
});

test("readiness: each real gap turns exactly its check to NEEDS ACTION and the overall to NOT READY", () => {
  const cases: [Partial<ReadinessInput>, string, RegExp][] = [
    [{ status: "PENDING_VERIFICATION" }, "storefront", /not published/i],
    [{ activeProducts: 0 }, "catalogue", /nothing active to sell/i],
    [{ operatingHours: null }, "hours", /no opening hours/i],
    [{ phone: null, whatsapp: null }, "profile", /no phone or whatsapp/i],
    [{ activeZones: 0 }, "deliveryAreas", /no active delivery area/i],
    [{ liveConnection: null }, "payments", /no payfast account is connected/i],
    [{ liveConnection: { status: "PENDING_VERIFICATION" } }, "payments", /pending verification/i],
    [{ platform: { emailConfigured: false, networkDeliveryEnabled: true, geocodingConfigured: true } }, "email", /platform email is not configured/i],
    [{ latitude: null, longitude: null }, "delivery", /address pinned/i],
    [{ settings: { fulfilment: { collectionEnabled: false, deliverySources: "BOTH" }, delivery: { enabled: false }, payment: { online: false }, legal: LEGAL_OK } }, "fulfilment", /cannot check out/i],
    [{ settings: { ...(takeaway().settings as object), legal: { ...LEGAL_OK, legalName: "" } } }, "legal", /missing legal name/i],
    [{ settings: { ...(takeaway().settings as object), legal: { ...LEGAL_OK, returnsText: null } } }, "legal", /returns and cancellation terms/i],
  ];
  for (const [over, key, msg] of cases) {
    const r = computeMerchantReadiness(takeaway(over));
    assert.equal(r.overall, "NOT_READY_TO_TRADE", key);
    assert.equal(state(r, key), "NEEDS_ACTION", key);
    assert.match(r.checks.find((c) => c.key === key)!.detail, msg);
    assert.equal(r.actions.length, 1, `${key}: ${r.actions.join(" | ")}`);
  }
});

test("readiness: the legal block needs a legal name and returns text; the complaints contact may fall back to the shop's own contact details", () => {
  // No complaints contact typed, but the shop has a phone — the footer shows that, so no gap.
  const fallback = computeMerchantReadiness(takeaway({ settings: { ...(takeaway().settings as object), legal: { ...LEGAL_OK, complaintsContact: null } } }));
  assert.equal(state(fallback, "legal"), "READY");
  // No complaints contact AND no phone / WhatsApp / email: now it is a gap (alongside the profile gap).
  const none = computeMerchantReadiness(takeaway({ phone: null, whatsapp: null, email: null, settings: { ...(takeaway().settings as object), legal: { ...LEGAL_OK, complaintsContact: null } } }));
  assert.equal(state(none, "legal"), "NEEDS_ACTION");
  assert.match(none.checks.find((c) => c.key === "legal")!.detail, /complaints contact/);
  // Nothing filled in at all lists every gap in one plain sentence.
  const empty = computeMerchantReadiness(takeaway({ settings: { ...(takeaway().settings as object), legal: undefined } }));
  assert.match(empty.checks.find((c) => c.key === "legal")!.detail, /legal name, returns and cancellation terms/);
  assert.equal(empty.overall, "NOT_READY_TO_TRADE");
});

test("readiness: legitimate business models are not blocked", () => {
  // Cash-only spaza with collection only: no card connection, no delivery — still ready.
  const spaza = computeMerchantReadiness(takeaway({ category: "TUCK_SHOP", settings: { fulfilment: { collectionEnabled: true, deliverySources: "OWN" }, delivery: { enabled: false }, payment: { online: false }, legal: LEGAL_OK }, liveConnection: null, activeZones: 0, latitude: null, longitude: null }));
  assert.equal(spaza.overall, "READY_TO_TRADE");
  assert.equal(state(spaza, "payments"), "READY");
  assert.equal(state(spaza, "delivery"), "NOT_APPLICABLE");
  assert.equal(state(spaza, "deliveryAreas"), "NOT_APPLICABLE");

  // Flat-fee delivery with own drivers needs no pin, no areas and no network.
  const flat = computeMerchantReadiness(takeaway({ settings: { fulfilment: { collectionEnabled: true, deliverySources: "OWN" }, delivery: { enabled: true, pricingMode: "FLAT", feeCents: 2000 }, payment: { online: false }, legal: LEGAL_OK }, liveConnection: null, activeZones: 0, latitude: null, longitude: null, platform: { emailConfigured: true, networkDeliveryEnabled: false, geocodingConfigured: false } }));
  assert.equal(flat.overall, "READY_TO_TRADE");
  assert.match(flat.checks.find((c) => c.key === "delivery")!.detail, /R 20\.00/);

  // A salon: bookings, no checkout — fulfilment checks are N/A, services count as catalogue.
  const salon = computeMerchantReadiness(takeaway({ category: "SALON", settings: { legal: LEGAL_OK }, activeProducts: 0, activeServices: 3, activeZones: 0, liveConnection: null }));
  assert.equal(salon.overall, "READY_TO_TRADE");
  assert.equal(state(salon, "fulfilment"), "NOT_APPLICABLE");
  assert.equal(state(salon, "catalogue"), "READY");
  // Bookings are paid in person by design, so a salon is never asked for a card connection.
  assert.equal(state(computeMerchantReadiness(takeaway({ category: "SALON", settings: { payment: { online: true } }, activeProducts: 0, activeServices: 3, liveConnection: null })), "payments"), "NOT_APPLICABLE");
});

test("readiness: platform switches matter only when the business depends on them", () => {
  const off = { emailConfigured: true, networkDeliveryEnabled: false, geocodingConfigured: false };
  // Network-only shop with the network switched off platform-wide: no way to deliver.
  const networkOnly = computeMerchantReadiness(takeaway({ settings: { fulfilment: { collectionEnabled: true, deliverySources: "NETWORK" }, delivery: { enabled: true, pricingMode: "ZONE", feeCents: 0 }, payment: { online: false } }, liveConnection: null, platform: off }));
  assert.equal(state(networkOnly, "delivery"), "NEEDS_ACTION");
  assert.match(networkOnly.checks.find((c) => c.key === "delivery")!.detail, /switched off on the platform/);
  // BOTH with the network off is fine: own drivers still work.
  const both = computeMerchantReadiness(takeaway({ settings: { fulfilment: { collectionEnabled: true, deliverySources: "BOTH" }, delivery: { enabled: true, pricingMode: "ZONE", feeCents: 0 }, payment: { online: false } }, liveConnection: null, platform: off }));
  assert.equal(state(both, "delivery"), "READY");
  // Distance pricing without the geocoding key cannot price anything.
  const perKm = computeMerchantReadiness(takeaway({ settings: { fulfilment: { collectionEnabled: true, deliverySources: "OWN" }, delivery: { enabled: true, pricingMode: "PER_KM", feeCents: 0, perKmFeeCents: 500 }, payment: { online: false } }, liveConnection: null, platform: off }));
  assert.equal(state(perKm, "delivery"), "NEEDS_ACTION");
  assert.match(perKm.checks.find((c) => c.key === "delivery")!.detail, /Google Maps key/);
});

test("readiness: a suspended business is BLOCKED, and trading state is reported but never blocks", () => {
  const r = computeMerchantReadiness(takeaway({ status: "SUSPENDED" }));
  assert.equal(r.overall, "BLOCKED");
  assert.equal(state(r, "storefront"), "BLOCKED");
  const closed = computeMerchantReadiness(takeaway({ operatingHours: { monday: { open: "08:00", close: "09:00" } } }), new Date("2026-10-12T20:00:00Z"));
  assert.equal(closed.overall, "READY_TO_TRADE");
  assert.equal(closed.trading.state, "CLOSED");
  const paused = computeMerchantReadiness(takeaway({ settings: { ...takeaway().settings as object, ordering: { pausedUntil: new Date(Date.now() + 3600_000).toISOString() } } }));
  assert.equal(paused.trading.state, "PAUSED");
});
