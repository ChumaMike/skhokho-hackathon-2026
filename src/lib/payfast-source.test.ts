import test from "node:test";
import assert from "node:assert/strict";
import { PAYFAST_ITN_HOSTS, normaliseIp, setPayfastResolverForTests, sourceCheckEnabled, verifyPayfastSource } from "./payfast-source";

/** The ITN source check: trusted hosts only, DNS blips retry rather than refuse, off outside production unless asked. */

const PROD = { NODE_ENV: "production" };
const table: Record<string, string[]> = {
  "www.payfast.co.za": ["197.97.145.144", "197.97.145.145"],
  "sandbox.payfast.co.za": ["197.97.145.150"],
  "w1w.payfast.co.za": ["41.74.179.194"],
  "w2w.payfast.co.za": ["41.74.179.195"],
};

test.afterEach(() => setPayfastResolverForTests(null));

test("an IP that resolves from any PayFast host is trusted; anything else is not", async () => {
  setPayfastResolverForTests(async (host) => table[host] ?? []);
  assert.equal(await verifyPayfastSource("197.97.145.145", PROD), "TRUSTED");
  assert.equal(await verifyPayfastSource("41.74.179.195", PROD), "TRUSTED");
  assert.equal(await verifyPayfastSource("::ffff:197.97.145.150", PROD), "TRUSTED", "IPv4-mapped");
  assert.equal(await verifyPayfastSource("203.0.113.9", PROD), "UNTRUSTED");
  assert.equal(await verifyPayfastSource(null, PROD), "UNTRUSTED");
  assert.equal(await verifyPayfastSource("unknown", PROD), "UNTRUSTED");
});

test("when DNS answers for no host at all the verdict is UNAVAILABLE (the route answers 503 so PayFast retries)", async () => {
  setPayfastResolverForTests(async () => {
    throw Object.assign(new Error("SERVFAIL"), { code: "ESERVFAIL" });
  });
  assert.equal(await verifyPayfastSource("197.97.145.145", PROD), "UNAVAILABLE");
});

test("a partial DNS failure still judges against the hosts that did answer", async () => {
  setPayfastResolverForTests(async (host) => {
    if (host === "www.payfast.co.za") return table[host];
    throw new Error("timeout");
  });
  assert.equal(await verifyPayfastSource("197.97.145.144", PROD), "TRUSTED");
  assert.equal(await verifyPayfastSource("41.74.179.194", PROD), "UNTRUSTED", "w1w could not be resolved this time");
});

test("answers are cached for an hour, and a stale answer outlives a later DNS failure", async () => {
  let calls = 0;
  setPayfastResolverForTests(async (host) => {
    calls += 1;
    if (calls > PAYFAST_ITN_HOSTS.length) throw new Error("down");
    return table[host] ?? [];
  });
  const t0 = new Date("2026-10-21T10:00:00Z");
  assert.equal(await verifyPayfastSource("197.97.145.145", PROD, t0), "TRUSTED");
  assert.equal(calls, PAYFAST_ITN_HOSTS.length);
  assert.equal(await verifyPayfastSource("197.97.145.145", PROD, new Date(t0.getTime() + 10 * 60_000)), "TRUSTED");
  assert.equal(calls, PAYFAST_ITN_HOSTS.length, "served from cache");
  // Past the TTL, DNS is down: the last known addresses still decide.
  assert.equal(await verifyPayfastSource("197.97.145.145", PROD, new Date(t0.getTime() + 2 * 60 * 60_000)), "TRUSTED");
});

test("the switch: production on unless off; elsewhere off unless on", async () => {
  assert.equal(sourceCheckEnabled({ NODE_ENV: "production" }), true);
  assert.equal(sourceCheckEnabled({ NODE_ENV: "production", PAYFAST_ITN_SOURCE_CHECK: "off" }), false);
  assert.equal(sourceCheckEnabled({ NODE_ENV: "test" }), false);
  assert.equal(sourceCheckEnabled({ NODE_ENV: "development", PAYFAST_ITN_SOURCE_CHECK: "on" }), true);
  setPayfastResolverForTests(async () => []);
  assert.equal(await verifyPayfastSource("203.0.113.9", { NODE_ENV: "test" }), "SKIPPED");
  assert.equal(normaliseIp(" ::FFFF:1.2.3.4 "), "1.2.3.4");
  assert.equal(normaliseIp("fe80::1%eth0"), "fe80::1");
});
