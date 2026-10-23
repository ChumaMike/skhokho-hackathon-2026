import test from "node:test";
import assert from "node:assert/strict";
import { endOfTradingDay, isSoldOut } from "./catalog.service";
import { getOrderingSettings, MAX_PREP_MINUTES } from "@/modules/tenant/capabilities";

/** Tab 5 merchant controls — the pure parts: the sold-out window and the prep-time setting. */

test("'sold out today' ends at midnight South African time, whatever the server's zone", () => {
  // 2026-10-21 09:15 SAST = 07:15 UTC → ends 2026-10-21 24:00 SAST = 2026-10-21 22:00 UTC.
  assert.equal(endOfTradingDay(new Date("2026-10-21T07:15:00Z")).toISOString(), "2026-10-21T22:00:00.000Z");
  // 23:30 SAST on the 21st is 21:30 UTC — still the 21st in SAST, so it ends 30 minutes later.
  assert.equal(endOfTradingDay(new Date("2026-10-21T21:30:00Z")).toISOString(), "2026-10-21T22:00:00.000Z");
  // 00:30 SAST on the 22nd (22:30 UTC on the 21st) is already the 22nd.
  assert.equal(endOfTradingDay(new Date("2026-10-21T22:30:00Z")).toISOString(), "2026-10-22T22:00:00.000Z");
});

test("a product is sold out only while its window is running — it clears itself", () => {
  const now = new Date("2026-10-21T10:00:00Z");
  assert.equal(isSoldOut(null, now), false);
  assert.equal(isSoldOut(endOfTradingDay(now), now), true);
  assert.equal(isSoldOut(endOfTradingDay(now), new Date("2026-10-22T05:00:00Z")), false);
});

test("prepMinutes reads tolerant of absence and of bad values, within 0..240", () => {
  assert.equal(getOrderingSettings({ settings: null }).prepMinutes, 0);
  assert.equal(getOrderingSettings({ settings: { ordering: { minOrderCents: 500 } } }).prepMinutes, 0);
  assert.equal(getOrderingSettings({ settings: { ordering: { prepMinutes: 25 } } }).prepMinutes, 25);
  assert.equal(getOrderingSettings({ settings: { ordering: { prepMinutes: 25.5 } } }).prepMinutes, 0);
  assert.equal(getOrderingSettings({ settings: { ordering: { prepMinutes: -5 } } }).prepMinutes, 0);
  assert.equal(getOrderingSettings({ settings: { ordering: { prepMinutes: MAX_PREP_MINUTES + 1 } } }).prepMinutes, 0);
  assert.equal(getOrderingSettings({ settings: { ordering: { prepMinutes: "20" } } }).prepMinutes, 0);
  // The other ordering keys are untouched by the new one.
  const s = getOrderingSettings({ settings: { ordering: { minOrderCents: 1500, prepMinutes: 40 } } });
  assert.deepEqual(s, { minOrderCents: 1500, pausedUntil: null, prepMinutes: 40 });
});
