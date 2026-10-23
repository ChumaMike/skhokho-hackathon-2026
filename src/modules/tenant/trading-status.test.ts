import test from "node:test";
import assert from "node:assert/strict";
import { getTradingStatus, isTakingOrders } from "./trading-status";
import { parseHoursForm, hoursForEditor, OperatingHoursSchema, defaultOperatingHours } from "./operating-hours";
import { getFulfilmentSettings, getOrderingSettings, getDeliverySettings, allowsNetworkDrivers, allowsOwnDrivers } from "./capabilities";

/** A UTC instant that is Wednesday 12:00 in Johannesburg (UTC+2). */
const WED_NOON = new Date("2026-10-07T10:00:00Z");
const WED_2300 = new Date("2026-10-07T21:00:00Z");
const hours = { wednesday: { open: "09:00", close: "20:00" } };

test("OPEN inside hours, CLOSED outside, with today's hours in the label", () => {
  const open = getTradingStatus({ settings: null, operatingHours: hours }, WED_NOON);
  assert.equal(open.state, "OPEN");
  assert.match(open.label, /Open now · 09:00 – 20:00/);
  const closed = getTradingStatus({ settings: null, operatingHours: hours }, WED_2300);
  assert.equal(closed.state, "CLOSED");
  assert.equal(isTakingOrders({ settings: null, operatingHours: hours }, WED_2300), false);
});

test("no hours configured = open (fail-open, as before)", () => {
  assert.equal(getTradingStatus({ settings: null, operatingHours: null }, WED_2300).state, "OPEN");
});

test("PAUSED beats hours while pausedUntil is in the future; an expired pause is ignored", () => {
  const paused = getTradingStatus({ settings: { ordering: { pausedUntil: new Date(WED_NOON.getTime() + 60 * 60_000).toISOString() } }, operatingHours: hours }, WED_NOON);
  assert.equal(paused.state, "PAUSED");
  assert.match(paused.label, /Orders paused — back at 13:00/);
  const expired = getTradingStatus({ settings: { ordering: { pausedUntil: new Date(WED_NOON.getTime() - 60_000).toISOString() } }, operatingHours: hours }, WED_NOON);
  assert.equal(expired.state, "OPEN");
  assert.equal(getOrderingSettings({ settings: { ordering: { pausedUntil: "garbage", minOrderCents: 500 } } }).pausedUntil, null);
});

test("hours form parsing: HH:MM only, closed days carry no times, overnight allowed, same open/close refused", () => {
  const fd = new FormData();
  for (const d of ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]) {
    fd.set(`${d}-open`, "18:00");
    fd.set(`${d}-close`, "02:00");
  }
  fd.set("sunday-closed", "on");
  const parsed = parseHoursForm(fd);
  assert.deepEqual(parsed.sunday, { closed: true });
  assert.deepEqual(parsed.monday, { open: "18:00", close: "02:00" });
  fd.set("monday-open", "9am");
  assert.throws(() => parseHoursForm(fd), /Monday: Use HH:MM/);
  fd.set("monday-open", "10:00");
  fd.set("monday-close", "10:00");
  assert.throws(() => parseHoursForm(fd), /Monday/);
  assert.equal(OperatingHoursSchema.safeParse({ ...defaultOperatingHours(), funday: { closed: true } }).success, false, "strict shape");
  assert.deepEqual(hoursForEditor({ monday: { open: "09:00", close: "17:00" }, tuesday: "nonsense" }).tuesday, { closed: true });
});

test("fulfilment defaults keep every existing merchant working: collection on, both driver sources, legacy delivery modes", () => {
  const legacy = { settings: { delivery: { enabled: true, pricingMode: "PER_KM", feeCents: 0, perKmFeeCents: 500 } } };
  const f = getFulfilmentSettings(legacy);
  assert.deepEqual(f, { collectionEnabled: true, deliveryEnabled: true, deliverySources: "BOTH" });
  assert.equal(allowsOwnDrivers(legacy), true);
  assert.equal(allowsNetworkDrivers(legacy), true);
  const d = getDeliverySettings(legacy);
  assert.equal(d.pricingMode, "PER_KM");
  assert.deepEqual([d.baseFeeCents, d.minFeeCents, d.maxDistanceKm], [0, 0, 0]);
  const own = { settings: { delivery: { enabled: true }, fulfilment: { collectionEnabled: false, deliverySources: "OWN" } } };
  assert.equal(allowsNetworkDrivers(own), false);
  assert.equal(allowsOwnDrivers(own), true);
  assert.equal(getFulfilmentSettings(own).collectionEnabled, false);
  assert.equal(allowsOwnDrivers({ settings: { delivery: { enabled: false }, fulfilment: { deliverySources: "OWN" } } }), false, "no delivery at all → no drivers");
  assert.equal(getDeliverySettings({ settings: { delivery: { enabled: true, pricingMode: "ZONE" } } }).pricingMode, "ZONE");
  assert.equal(getDeliverySettings({ settings: { delivery: { enabled: true, pricingMode: "BOGUS" } } }).pricingMode, "FLAT");
});
