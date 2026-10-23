import test from "node:test";
import assert from "node:assert/strict";
import { bookingRefusal, isWithinOpeningHours, windowForDate, windowForWeekday, BookingRefusedError, assertBookable } from "./booking-rules";

/** Booking rules (Tab 5): capability and opening hours, pure. */

const HOURS = {
  monday: { open: "09:00", close: "17:00" },
  tuesday: { closed: true },
  friday: { open: "18:00", close: "02:00" }, // overnight
};
// 2026-10-19 is a Monday; 2026-10-20 a Tuesday; 2026-10-23 a Friday. SAST = UTC+2.
const sast = (iso: string) => new Date(`${iso}+02:00`);
const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);

test("windows: a normal day, a closed day, an overnight day, an unconfigured day", () => {
  assert.deepEqual(windowForWeekday(HOURS, "monday"), { kind: "open", openMinutes: 540, closeMinutes: 1020 });
  assert.deepEqual(windowForWeekday(HOURS, "tuesday"), { kind: "closed" });
  assert.deepEqual(windowForWeekday(HOURS, "friday"), { kind: "open", openMinutes: 1080, closeMinutes: 1560 });
  assert.deepEqual(windowForWeekday(HOURS, "wednesday"), { kind: "unconfigured" });
  assert.deepEqual(windowForWeekday(null, "monday"), { kind: "unconfigured" });
  assert.deepEqual(windowForDate(HOURS, "2026-10-19"), windowForWeekday(HOURS, "monday"));
  assert.deepEqual(windowForDate(HOURS, "2026-10-20"), { kind: "closed" });
  assert.deepEqual(windowForDate(HOURS, "not-a-date"), { kind: "closed" });
});

test("a slot must start and end inside the day's hours, in South African time", () => {
  const start = sast("2026-10-19T09:00:00");
  assert.equal(isWithinOpeningHours(HOURS, start, plus(start, 60)), true, "09:00–10:00 Monday");
  assert.equal(isWithinOpeningHours(HOURS, sast("2026-10-19T16:30:00"), sast("2026-10-19T17:00:00")), true, "ends exactly at close");
  assert.equal(isWithinOpeningHours(HOURS, sast("2026-10-19T16:30:00"), sast("2026-10-19T17:30:00")), false, "runs past close");
  assert.equal(isWithinOpeningHours(HOURS, sast("2026-10-19T08:30:00"), sast("2026-10-19T09:30:00")), false, "starts before open");
  assert.equal(isWithinOpeningHours(HOURS, sast("2026-10-20T10:00:00"), sast("2026-10-20T11:00:00")), false, "closed Tuesday");
  assert.equal(isWithinOpeningHours(HOURS, sast("2026-10-21T10:00:00"), sast("2026-10-21T11:00:00")), true, "unconfigured Wednesday fails open");
  assert.equal(isWithinOpeningHours(null, sast("2026-10-20T03:00:00"), sast("2026-10-20T04:00:00")), true, "no hours at all fails open");
  // Overnight Friday 18:00–02:00: 23:30–00:30 is inside; 17:00 is before open.
  assert.equal(isWithinOpeningHours(HOURS, sast("2026-10-23T23:30:00"), sast("2026-10-24T00:30:00")), true);
  assert.equal(isWithinOpeningHours(HOURS, sast("2026-10-23T17:00:00"), sast("2026-10-23T18:00:00")), false);
  // The same instant expressed in UTC is still judged in SAST.
  assert.equal(isWithinOpeningHours(HOURS, new Date("2026-10-19T07:00:00Z"), new Date("2026-10-19T08:00:00Z")), true, "09:00 SAST");
  assert.equal(isWithinOpeningHours(HOURS, new Date("2026-10-19T15:30:00Z"), new Date("2026-10-19T16:30:00Z")), false, "17:30–18:30 SAST");
});

test("capability first, then hours; the error says which", () => {
  const start = sast("2026-10-19T10:00:00");
  const salon = { category: "SALON" as const, settings: null, operatingHours: HOURS };
  const food = { category: "FOOD_VENDOR" as const, settings: null, operatingHours: HOURS };
  assert.equal(bookingRefusal(salon, start, plus(start, 30)), null);
  assert.equal(bookingRefusal(food, start, plus(start, 30)), "BOOKINGS_OFF");
  assert.equal(bookingRefusal({ ...food, settings: { capabilities: ["PRODUCTS", "ORDERS", "BOOKINGS"] } }, start, plus(start, 30)), null, "switched on in Settings › Modules");
  assert.equal(bookingRefusal(salon, sast("2026-10-20T10:00:00"), sast("2026-10-20T10:30:00")), "OUTSIDE_HOURS");
  assert.throws(() => assertBookable(food, start, plus(start, 30)), (e: unknown) => e instanceof BookingRefusedError && e.code === "BOOKINGS_OFF");
  assert.doesNotThrow(() => assertBookable(salon, start, plus(start, 30)));
});
