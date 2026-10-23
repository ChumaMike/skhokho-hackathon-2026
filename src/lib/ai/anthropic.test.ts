import test from "node:test";
import assert from "node:assert/strict";
import { monthWindow } from "./anthropic";
import { estimateCostUsdMicros, formatUsdMicros } from "./pricing";

test("monthWindow: calendar month in South African time (UTC+2)", () => {
  // 2026-10-31 23:30 SAST is still October; 2026-11-01 00:30 SAST is November.
  const lateOct = monthWindow(new Date("2026-10-31T21:30:00Z"));
  assert.equal(lateOct.start.toISOString(), "2026-09-30T22:00:00.000Z");
  assert.equal(lateOct.end.toISOString(), "2026-10-31T22:00:00.000Z");
  const earlyNov = monthWindow(new Date("2026-10-31T22:30:00Z"));
  assert.equal(earlyNov.start.toISOString(), "2026-10-31T22:00:00.000Z");
});

test("pricing: known models are estimated, unknown models are null (never a made-up figure)", () => {
  assert.equal(estimateCostUsdMicros("claude-sonnet-5", 1_000_000, 0), 3_000_000);
  assert.equal(estimateCostUsdMicros("claude-sonnet-5-20261001", 0, 1_000_000), 15_000_000);
  assert.equal(estimateCostUsdMicros("some-future-model", 1000, 1000), null);
  assert.equal(formatUsdMicros(3_000_000), "$3.00");
  assert.equal(formatUsdMicros(4_500), "$0.0045");
});
