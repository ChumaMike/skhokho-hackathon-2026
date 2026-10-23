import test from "node:test";
import assert from "node:assert/strict";
import { formatOperatingHours, isBusinessOpenNow } from "@/modules/tenant/storefront-hours";

// South Africa is UTC+2 year-round (no DST). 2026-10-05 is a confirmed
// Monday; these are built as explicit UTC instants (SAST = UTC + 2h) so the
// tests are deterministic regardless of the machine's own local timezone.
const MONDAY_10AM_SAST = new Date(Date.UTC(2026, 9, 5, 8, 0)); // 2026-10-05 10:00 SAST
const MONDAY_11PM_SAST = new Date(Date.UTC(2026, 9, 5, 21, 0)); // 2026-10-05 23:00 SAST
const TUESDAY_1AM_SAST = new Date(Date.UTC(2026, 9, 5, 23, 0)); // 2026-10-06 01:00 SAST

test("formatOperatingHours returns [] for missing/malformed input rather than throwing", () => {
  assert.deepEqual(formatOperatingHours(undefined), []);
  assert.deepEqual(formatOperatingHours(null), []);
  assert.deepEqual(formatOperatingHours("not an object"), []);
  assert.deepEqual(formatOperatingHours(42), []);
  assert.deepEqual(formatOperatingHours({}), []);
});

test("formatOperatingHours formats open days and skips days with no valid entry", () => {
  const result = formatOperatingHours({
    monday: { open: "08:00", close: "18:00", closed: false },
    tuesday: "garbage",
    sunday: { closed: true },
  });
  assert.deepEqual(result, [
    { day: "Monday", label: "08:00 – 18:00" },
    { day: "Sunday", label: "Closed" },
  ]);
});

test("formatOperatingHours preserves weekday order regardless of input key order", () => {
  const result = formatOperatingHours({
    sunday: { closed: true },
    monday: { open: "09:00", close: "17:00" },
  });
  assert.deepEqual(
    result.map((r) => r.day),
    ["Monday", "Sunday"],
  );
});

test("isBusinessOpenNow fails open on missing/malformed hours — never locks out a business that hasn't configured any", () => {
  assert.equal(isBusinessOpenNow(undefined, MONDAY_10AM_SAST), true);
  assert.equal(isBusinessOpenNow(null, MONDAY_10AM_SAST), true);
  assert.equal(isBusinessOpenNow("garbage", MONDAY_10AM_SAST), true);
  assert.equal(isBusinessOpenNow({}, MONDAY_10AM_SAST), true);
});

test("isBusinessOpenNow fails open for a day not present in the data — owner configured 6 days, forgot one, that one day must still accept orders", () => {
  const hours = {
    tuesday: { open: "08:00", close: "18:00" },
    wednesday: { open: "08:00", close: "18:00" },
  };
  // Monday isn't configured at all.
  assert.equal(isBusinessOpenNow(hours, MONDAY_10AM_SAST), true);
});

test("isBusinessOpenNow fails open for a malformed entry on today specifically", () => {
  assert.equal(isBusinessOpenNow({ monday: "not an object" }, MONDAY_10AM_SAST), true);
  assert.equal(isBusinessOpenNow({ monday: { open: "08:00" } }, MONDAY_10AM_SAST), true); // missing close
  assert.equal(isBusinessOpenNow({ monday: { open: "not-a-time", close: "18:00" } }, MONDAY_10AM_SAST), true);
});

test("isBusinessOpenNow: closed: true always closes, regardless of time", () => {
  assert.equal(isBusinessOpenNow({ monday: { closed: true } }, MONDAY_10AM_SAST), false);
});

test("isBusinessOpenNow: a normal same-day window is open inside it and closed outside it", () => {
  const hours = { monday: { open: "08:00", close: "18:00" } };
  assert.equal(isBusinessOpenNow(hours, MONDAY_10AM_SAST), true); // 10:00, inside
  assert.equal(isBusinessOpenNow(hours, MONDAY_11PM_SAST), false); // 23:00, outside
});

test("isBusinessOpenNow: an overnight window spans into the next calendar day", () => {
  const hours = {
    monday: { open: "18:00", close: "02:00" },
    tuesday: { open: "18:00", close: "02:00" },
  };
  assert.equal(isBusinessOpenNow(hours, MONDAY_11PM_SAST), true); // Monday 23:00 — within Monday's overnight window
  assert.equal(isBusinessOpenNow(hours, TUESDAY_1AM_SAST), true); // Tuesday 01:00 — still within Monday's overnight window, carried over
  assert.equal(isBusinessOpenNow(hours, MONDAY_10AM_SAST), false); // Monday 10:00 — outside any configured window
});

test("isBusinessOpenNow: today's own not-yet-started overnight window must not be confused with yesterday's carried-over tail (regression)", () => {
  // Monday is explicitly closed (no overnight spillover into Tuesday).
  // Tuesday opens at 18:00 — at Tuesday 01:00, Tuesday's own window hasn't
  // started yet, and there is no Monday-night window to carry over, so this
  // must be closed. A naive implementation that reuses TODAY's own entry
  // for the "before close" half of an overnight check (instead of
  // YESTERDAY's) would wrongly treat this as still-open from midnight.
  const hours = {
    monday: { closed: true },
    tuesday: { open: "18:00", close: "02:00" },
  };
  assert.equal(isBusinessOpenNow(hours, TUESDAY_1AM_SAST), false);
});

test("isBusinessOpenNow uses the SAST weekday/time, not the server's UTC weekday/time", () => {
  // 2026-10-05T23:00:00Z is UTC Monday, but SAST Tuesday 01:00 — if the
  // function used UTC instead of Africa/Johannesburg, this would wrongly
  // check Monday's hours (closed) instead of Tuesday's (open), getting it
  // backwards by up to 2 hours.
  const hours = {
    monday: { closed: true },
    tuesday: { open: "00:00", close: "06:00" },
  };
  assert.equal(isBusinessOpenNow(hours, TUESDAY_1AM_SAST), true);
});
