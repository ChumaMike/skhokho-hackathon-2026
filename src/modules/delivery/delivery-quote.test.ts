import test from "node:test";
import assert from "node:assert/strict";
import { quoteDeliveryFee, publicZoneTable } from "./delivery-quote";
import { matchZoneByAddress, normaliseArea, type DeliveryZoneRow } from "./zones.service";
import { roadKm, haversineMeters } from "./distance";
import { DEFAULT_DELIVERY_SETTINGS, type DeliverySettings } from "@/modules/tenant/capabilities";
import { quoteNetworkDelivery, NETWORK_PRICING } from "@/modules/skhokholetha/pricing";

const SHOP = { lat: -26.2485, lng: 27.854 };
const NEAR = { lat: -26.26, lng: 27.87 }; // ~2 km
const FAR = { lat: -26.1, lng: 28.05 }; // ~26 km

const zone = (over: Partial<DeliveryZoneRow>): DeliveryZoneRow => ({
  id: "z1",
  businessId: "b1",
  name: "Zone",
  matchKind: "CUSTOMER_PICK",
  suburbs: [],
  feeCents: 2000,
  minOrderCents: null,
  active: true,
  priority: 0,
  ...over,
});
const settings = (over: Partial<DeliverySettings>): DeliverySettings => ({ ...DEFAULT_DELIVERY_SETTINGS, enabled: true, ...over });

test("1. flat: one fee whatever the address", () => {
  const r = quoteDeliveryFee({ settings: settings({ pricingMode: "FLAT", feeCents: 3000 }), pickup: SHOP, dropoff: FAR, zones: [] });
  assert.deepEqual(r, { ok: true, quote: { feeCents: 3000, pricingMode: "FLAT" } });
});

test("2. distance: base + per-km on road-ish km, floored at the minimum, rounded to 50c, refused past maxDistanceKm", () => {
  const s = settings({ pricingMode: "PER_KM", baseFeeCents: 1000, perKmFeeCents: 700, minFeeCents: 2500, maxDistanceKm: 10 });
  const r = quoteDeliveryFee({ settings: s, pickup: SHOP, dropoff: NEAR, zones: [] });
  assert.ok(r.ok);
  if (!r.ok) return;
  const km = roadKm(SHOP, NEAR);
  assert.equal(r.quote.distanceKm, km);
  const expected = Math.max(2500, Math.round((1000 + Math.round(km * 700)) / 50) * 50);
  assert.equal(r.quote.feeCents, expected);
  assert.equal(r.quote.feeCents % 50, 0);
  const far = quoteDeliveryFee({ settings: s, pickup: SHOP, dropoff: FAR, zones: [] });
  assert.equal(far.ok, false);
  if (!far.ok && !far.pending) assert.equal(far.code, "OUTSIDE_SERVICE_AREA");
  // No address yet → pending (not an error); no shop pin → configuration problem.
  const pending = quoteDeliveryFee({ settings: s, pickup: SHOP, dropoff: null, zones: [] });
  assert.ok(!pending.ok && pending.pending && pending.code === "DELIVERY_ADDRESS_REQUIRED");
  const noPin = quoteDeliveryFee({ settings: s, pickup: { lat: null, lng: null }, dropoff: NEAR, zones: [] });
  assert.ok(!noPin.ok && !noPin.pending && noPin.code === "DELIVERY_PRICING_UNAVAILABLE");
  // Legacy: a merchant who only ever set perKmFeeCents keeps working (no base, no floor, no cap).
  const legacy = quoteDeliveryFee({ settings: settings({ pricingMode: "PER_KM", perKmFeeCents: 500 }), pickup: SHOP, dropoff: FAR, zones: [] });
  assert.ok(legacy.ok);
});

test("3./4. zone: the chosen zone's exact fee is the quote; the same number is what gets charged", () => {
  const zones = [zone({ id: "a", name: "Near", feeCents: 2000 }), zone({ id: "b", name: "Far", feeCents: 3500, minOrderCents: 15000 })];
  const s = settings({ pricingMode: "ZONE" });
  const picked = quoteDeliveryFee({ settings: s, pickup: SHOP, dropoff: null, zoneId: "b", zones });
  assert.ok(picked.ok);
  if (!picked.ok) return;
  assert.equal(picked.quote.feeCents, 3500);
  assert.deepEqual(picked.quote.zone, { id: "b", name: "Far", minOrderCents: 15000 });
  // Shown == charged: the public table carries the identical cents.
  assert.deepEqual(publicZoneTable(s, zones).find((z) => z.id === "b")?.feeCents, 3500);
  // Nothing picked and nothing matched → pending, so checkout can't proceed.
  const none = quoteDeliveryFee({ settings: s, pickup: SHOP, dropoff: NEAR, zones });
  assert.ok(!none.ok && none.pending && none.code === "DELIVERY_AREA_REQUIRED");
});

test("5. unknown / foreign / hidden area → OUTSIDE_SERVICE_AREA; no zones at all → pricing unavailable", () => {
  const zones = [zone({ id: "a", name: "Near" }), zone({ id: "hidden", name: "Hidden", active: false })];
  const s = settings({ pricingMode: "ZONE" });
  for (const zoneId of ["not-mine", "hidden"]) {
    const r = quoteDeliveryFee({ settings: s, pickup: SHOP, dropoff: null, zoneId, zones });
    assert.ok(!r.ok && !r.pending && r.code === "OUTSIDE_SERVICE_AREA", zoneId);
  }
  const empty = quoteDeliveryFee({ settings: s, pickup: SHOP, dropoff: null, zoneId: "a", zones: [] });
  assert.ok(!empty.ok && !empty.pending && empty.code === "DELIVERY_PRICING_UNAVAILABLE");
  assert.equal(quoteDeliveryFee({ settings: settings({ enabled: false }), pickup: SHOP, dropoff: NEAR, zones: [] }).ok, false);
});

test("suburb matching: normalised whole-word match on the typed address; longest name wins, then priority; CUSTOMER_PICK zones never auto-match", () => {
  const zones = [
    zone({ id: "p", name: "Pick-only", matchKind: "CUSTOMER_PICK", suburbs: ["orlando"] }),
    zone({ id: "ow", name: "Orlando West", matchKind: "SUBURB_LIST", suburbs: ["orlando west"], priority: 1 }),
    zone({ id: "o", name: "Orlando", matchKind: "SUBURB_LIST", suburbs: ["orlando"], priority: 0 }),
  ];
  assert.equal(matchZoneByAddress(zones, "12 Vilakazi St, Orlando West, Soweto")?.id, "ow");
  assert.equal(matchZoneByAddress(zones, "5 Main Rd, ORLANDO")?.id, "o");
  assert.equal(matchZoneByAddress(zones, "Orlandoville 9"), null, "no partial-word match");
  assert.equal(matchZoneByAddress(zones, "Diepkloof zone 3"), null);
  assert.equal(normaliseArea("  Orlando-West,  SOWETO "), "orlando west soweto");
  const auto = quoteDeliveryFee({ settings: settings({ pricingMode: "ZONE" }), pickup: SHOP, dropoff: null, address: "7 Khumalo St, Orlando West", zones });
  assert.ok(auto.ok && auto.quote.zone?.id === "ow");
});

test("parity: a network delivery costs exactly the customer's fee (or the network minimum), and the shop's top-up is explicit", () => {
  const customer = quoteDeliveryFee({ settings: settings({ pricingMode: "FLAT", feeCents: 1500 }), pickup: SHOP, dropoff: NEAR, zones: [] });
  assert.ok(customer.ok);
  if (!customer.ok) return;
  const network = quoteNetworkDelivery({ deliveryEnabled: true, customerFeeCents: customer.quote.feeCents, pickup: SHOP, dropoff: NEAR });
  assert.ok(network.ok);
  if (!network.ok) return;
  assert.equal(network.quote.customerFeeCents, 1500);
  assert.equal(network.quote.quoteFeeCents, NETWORK_PRICING.minimumFeeCents);
  assert.equal(network.quote.merchantCostCents, NETWORK_PRICING.minimumFeeCents - 1500);
  assert.equal(network.quote.quoteFeeCents, network.quote.customerFeeCents + network.quote.merchantCostCents, "customer + merchant = network cost");
  const covered = quoteNetworkDelivery({ deliveryEnabled: true, customerFeeCents: 4000, pickup: SHOP, dropoff: NEAR });
  assert.ok(covered.ok && covered.quote.merchantCostCents === 0 && covered.quote.quoteFeeCents === 4000);
  // Both sides use the same road-distance rule.
  assert.equal(covered.ok && covered.quote.snapshot.roadKm, roadKm(SHOP, NEAR));
});

test("distance helpers are sane", () => {
  const m = haversineMeters(SHOP, NEAR);
  assert.ok(m > 1500 && m < 2500, String(m));
  assert.ok(roadKm(SHOP, NEAR) >= m / 1000, "road km never below straight line");
  assert.equal(roadKm(SHOP, SHOP), 0);
});
