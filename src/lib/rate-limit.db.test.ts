import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { RATE_RULES, RATE_LIMITED_MESSAGE, checkRateLimits, clientIp, consumeRateLimit, honeypotTripped, purgeRateLimitBuckets } from "./rate-limit";
import { POST as ownerLogin } from "@/app/api/platform/login/route";
import { POST as checkout } from "@/app/api/store/checkout/route";
import { POST as join } from "@/app/api/platform/join/route";

/** B5 — one shared limiter, backed by the database every instance shares. */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const uniq = (label: string) => `${label}-${run}-${Math.random().toString(36).slice(2, 8)}`;

test("allows up to the limit, then blocks with a retry time", async () => {
  const id = uniq("basic");
  const { limit } = RATE_RULES.loginAccount;
  const now = new Date("2026-10-07T10:00:30Z");
  for (let i = 0; i < limit; i++) assert.equal((await consumeRateLimit("loginAccount", id, now)).allowed, true, `attempt ${i + 1}`);
  const blocked = await consumeRateLimit("loginAccount", id, now);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= RATE_RULES.loginAccount.windowSeconds);
});

test("a new window starts fresh; other identifiers and other rules are independent", async () => {
  const id = uniq("window");
  const t = new Date("2026-10-07T11:00:00Z");
  for (let i = 0; i <= RATE_RULES.recoveryAccount.limit; i++) await consumeRateLimit("recoveryAccount", id, t);
  assert.equal((await consumeRateLimit("recoveryAccount", id, t)).allowed, false);
  assert.equal((await consumeRateLimit("recoveryAccount", uniq("other"), t)).allowed, true, "another account");
  assert.equal((await consumeRateLimit("recoveryIp", id, t)).allowed, true, "another rule");
  const nextWindow = new Date(t.getTime() + RATE_RULES.recoveryAccount.windowSeconds * 1000);
  assert.equal((await consumeRateLimit("recoveryAccount", id, nextWindow)).allowed, true);
});

test("concurrent attempts across instances are counted exactly (atomic upsert)", async () => {
  const id = uniq("race");
  const t = new Date("2026-10-07T12:00:00Z");
  const results = await Promise.all(Array.from({ length: 30 }, () => consumeRateLimit("checkoutIp", id, t)));
  assert.equal(results.filter((r) => r.allowed).length, RATE_RULES.checkoutIp.limit);
});

test("no personal data is stored — only hashed keys", async () => {
  const email = `${uniq("privacy")}@example.test`;
  await consumeRateLimit("loginAccount", email);
  assert.equal(await prisma.rateLimitBucket.count({ where: { key: { contains: email } } }), 0);
  const rows = await prisma.$queryRaw<{ ok: boolean }[]>`SELECT bool_and(key ~ '^[0-9a-f]{64}$') AS ok FROM rate_limit_buckets`;
  assert.equal(rows[0].ok, true);
});

test("checkRateLimits counts every pair and blocks if any is over", async () => {
  const ip = uniq("ip");
  const account = uniq("acct");
  for (let i = 0; i < RATE_RULES.loginAccount.limit; i++) await checkRateLimits([["loginIp", ip], ["loginAccount", account]]);
  const blocked = await checkRateLimits([["loginIp", uniq("fresh-ip")], ["loginAccount", account]]);
  assert.equal(blocked.allowed, false, "a new IP doesn't reset the per-account limit");
  assert.equal((await checkRateLimits([["loginIp", null], ["loginAccount", ""]])).allowed, true, "empty identifiers are skipped");
});

test("old windows are purged", async () => {
  const id = uniq("purge");
  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  await consumeRateLimit("reviewIp", id, old);
  const before = await prisma.rateLimitBucket.count({ where: { windowStart: { lt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } } });
  assert.ok(before >= 1);
  await purgeRateLimitBuckets();
  assert.equal(await prisma.rateLimitBucket.count({ where: { windowStart: { lt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } } }), 0);
});

test("client IP comes from Vercel's edge headers, first hop only", () => {
  assert.equal(clientIp(new Headers({ "x-vercel-forwarded-for": "41.1.1.1", "x-forwarded-for": "9.9.9.9" })), "41.1.1.1");
  assert.equal(clientIp(new Headers({ "x-real-ip": "41.2.2.2" })), "41.2.2.2");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "41.3.3.3, 10.0.0.1" })), "41.3.3.3");
  assert.equal(clientIp(new Headers()), "unknown");
});

test("honeypot: any value trips it", () => {
  assert.equal(honeypotTripped(""), false);
  assert.equal(honeypotTripped(null), false);
  assert.equal(honeypotTripped("http://spam.example"), true);
});

// --- applied to real routes -------------------------------------------------------

function form(url: string, fields: Record<string, string>, ip: string) {
  return new NextRequest(url, {
    method: "POST",
    body: new URLSearchParams(fields).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": ip },
  });
}

test("owner login: repeated attempts on one account are refused, even from new IPs", async () => {
  const email = `${uniq("brute")}@example.test`;
  let last: Response | null = null;
  for (let i = 0; i <= RATE_RULES.loginAccount.limit; i++) {
    last = await ownerLogin(form("https://app.example.test/api/platform/login", { email, password: "wrong-password" }, `10.9.${i}.1`));
  }
  assert.match(decodeURIComponent(last!.headers.get("location") ?? ""), new RegExp(RATE_LIMITED_MESSAGE.slice(0, 20)));
});

test("checkout: one IP hammering the endpoint gets 429 with Retry-After", async () => {
  const ip = uniq("shopper");
  let res: Response | null = null;
  for (let i = 0; i <= RATE_RULES.checkoutIp.limit; i++) {
    res = await checkout(new NextRequest("https://app.example.test/api/store/checkout", { method: "POST", body: "{}", headers: { "content-type": "application/json", "x-forwarded-for": ip } }));
  }
  assert.equal(res!.status, 429);
  assert.ok(Number(res!.headers.get("retry-after")) > 0);
});

test("join: a bot filling the honeypot creates nothing", async () => {
  const email = `${uniq("bot")}@example.test`;
  const res = await join(form("https://app.example.test/api/platform/join", {
    name: "Spam Shop", category: "FOOD_VENDOR", firstName: "Bot", lastName: "Bot", email, password: "password-1234", website: "http://spam.example",
  }, uniq("botip")));
  assert.match(res.headers.get("location") ?? "", /err=/);
  assert.equal(await prisma.appUser.count({ where: { email } }), 0);
});
