import test from "node:test";
import assert from "node:assert/strict";
import { Secret, TOTP } from "otpauth";
import { prisma } from "@/lib/prisma/client";
import { resetTestDb, testDb } from "@/lib/testing/db";
import { hashPassword, signToken, COOKIE_NAME } from "@/modules/auth/auth.service";
import { startAppServer, cookies, type AppServer } from "@/lib/testing/http-server";
import { resetAdminMfa } from "@/modules/platform-admin/mfa.service";

/**
 * Admin MFA and admin authorization over real HTTP: the production server,
 * real cookies, the real login → MFA → console flow.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const PASSWORD = "correct-horse-battery-staple";
const C = COOKIE_NAME;
let app: AppServer;
const ip = () => ({ "x-real-ip": `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
const u: Record<string, { id: string; email: string }> = {};
let staffToken = "";
let driverToken = "";

function setCookieValue(res: { headers: Record<string, string | string[] | undefined> }, name: string): string | null {
  const raw = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const c of list) {
    const [pair] = c.split(";");
    const [k, v] = pair.split("=");
    if (k === name) return v || null;
  }
  return null;
}

async function login(email: string, password = PASSWORD) {
  const body = new URLSearchParams({ email, password }).toString();
  return app.request("POST", "/api/admin/login", { body, headers: { "content-type": "application/x-www-form-urlencoded", ...ip() } });
}

const json = (cookie: Record<string, string | undefined>, body: unknown) => ({ body: JSON.stringify(body), headers: { "content-type": "application/json", ...cookies(cookie), ...ip() } });
const totpNow = (secret: string, offsetSteps = 0) => new TOTP({ secret: Secret.fromBase32(secret), period: 30 }).generate({ timestamp: Date.now() + offsetSteps * 30_000 });

test.before(async () => {
  await resetTestDb();
  const passwordHash = await hashPassword(PASSWORD);
  for (const label of ["super", "support", "fresh", "ratelimit"]) {
    u[label] = await prisma.appUser.create({ data: { email: `http-${label}-${run}@example.test`, role: "ADMIN", passwordHash }, select: { id: true, email: true } });
  }
  const owner = await prisma.appUser.create({ data: { email: `http-owner-${run}@example.test`, role: "OWNER", passwordHash }, select: { id: true, email: true } });
  const biz = await prisma.business.create({ data: { name: `HTTP Admin Biz ${run}`, slug: `http-admin-${run}`, status: "ACTIVE", ownerUserId: owner.id }, select: { id: true } });
  staffToken = await signToken({ type: "staff", staffId: owner.id, tenantId: biz.id, email: owner.email, isOwner: true });
  const duser = await prisma.appUser.create({ data: { email: `http-drv-${run}@example.test`, role: "DRIVER" }, select: { id: true, email: true } });
  const drv = await prisma.driverProfile.create({ data: { userId: duser.id, displayName: "Http Drv" }, select: { id: true } });
  driverToken = await signToken({ type: "driver", userId: duser.id, driverId: drv.id, email: duser.email });
  app = await startAppServer({});
});

test.after(async () => {
  await app?.stop();
  await resetTestDb();
  await testDb.$disconnect();
});

const state: { superSecret?: string; superCookie?: string; recovery?: string[] } = {};

test("no MFA yet: a correct password gives only the pending session — the console stays a 404", async () => {
  const res = await login(u.super.email);
  assert.equal(res.status, 303);
  assert.equal(new URL(String(res.headers.location), "http://x").pathname, "/admin-mfa");
  const pending = setCookieValue(res, C.admin_mfa);
  assert.ok(pending);
  assert.equal(setCookieValue(res, C.platform_admin), null, "no admin session from a password alone");
  // The pending cookie opens nothing: not as itself, not placed in the admin cookie.
  for (const cookie of [{ [C.admin_mfa]: pending! }, { [C.platform_admin]: pending! }]) {
    assert.equal((await app.request("GET", "/platform-admin", { headers: { ...cookies(cookie), ...ip() } })).status, 404);
    assert.equal((await app.request("GET", "/platform-admin/audit", { headers: { ...cookies(cookie), ...ip() } })).status, 404);
  }
  // The MFA page renders for the pending session.
  assert.equal((await app.request("GET", "/admin-mfa", { headers: { ...cookies({ [C.admin_mfa]: pending! }), ...ip() } })).status, 200);

  // Enrol: a secret is issued; a wrong code is refused; the right code signs in and returns 10 recovery codes once.
  const enroll = await app.request("POST", "/api/admin/mfa/enroll", json({ [C.admin_mfa]: pending! }, {}));
  assert.equal(enroll.status, 200);
  const { secret, qrSvg } = JSON.parse(enroll.body);
  assert.match(secret, /^[A-Z2-7]+$/);
  assert.match(qrSvg, /<svg/);
  assert.equal(enroll.headers["cache-control"], "no-store");
  const wrong = totpNow(secret) === "000000" ? "111111" : "000000";
  assert.equal((await app.request("POST", "/api/admin/mfa/confirm", json({ [C.admin_mfa]: pending! }, { code: wrong }))).status, 422);
  const ok = await app.request("POST", "/api/admin/mfa/confirm", json({ [C.admin_mfa]: pending! }, { code: totpNow(secret) }));
  assert.equal(ok.status, 200, ok.body);
  const okBody = JSON.parse(ok.body);
  assert.equal(okBody.recoveryCodes.length, 10);
  const session = setCookieValue(ok, C.platform_admin);
  assert.ok(session);
  state.superSecret = secret;
  state.superCookie = session!;
  state.recovery = okBody.recoveryCodes;
  // The confirm response never echoes the code.
  assert.equal(ok.body.includes(totpNow(secret)), false);
});

test("a fresh admin (no row yet) is SUPPORT; promote the first super admin like the bootstrap script does", async () => {
  // The admin created above became SUPPORT by default — least privilege.
  const row = await prisma.platformAdmin.findUniqueOrThrow({ where: { userId: u.super.id } });
  assert.equal(row.role, "SUPPORT");
  // Support can't see the audit log even with a valid MFA session.
  assert.equal((await app.request("GET", "/platform-admin/audit", { headers: { ...cookies({ [C.platform_admin]: state.superCookie! }), ...ip() } })).status, 404);
  // Promote (as admin-bootstrap.ts grant-super does) — this ends the existing session (epoch).
  await prisma.platformAdmin.update({ where: { id: row.id }, data: { role: "SUPER_ADMIN", sessionEpoch: { increment: 1 } } });
  assert.equal((await app.request("GET", "/platform-admin", { headers: { ...cookies({ [C.platform_admin]: state.superCookie! }), ...ip() } })).status, 404, "old session ended by the role change");
});

test("valid MFA: password + current code → full console access for a super admin", async () => {
  const res = await login(u.super.email);
  const pending = setCookieValue(res, C.admin_mfa)!;
  const usedCode = totpNow(state.superSecret!, 1);
  const verify = await app.request("POST", "/api/admin/mfa/verify", json({ [C.admin_mfa]: pending }, { code: usedCode }));
  assert.equal(verify.status, 200, verify.body);
  assert.equal(JSON.parse(verify.body).next, "/platform-admin");
  state.superCookie = setCookieValue(verify, C.platform_admin)!;
  for (const page of ["/platform-admin", "/platform-admin/audit", "/platform-admin/security", "/platform-admin/health", "/platform-admin/settings", "/platform-admin/businesses", "/platform-admin/payments", "/platform-admin/drivers", "/platform-admin/deliveries", "/platform-admin/payouts"]) {
    const r = await app.request("GET", page, { headers: { ...cookies({ [C.platform_admin]: state.superCookie }), ...ip() } });
    assert.equal(r.status, 200, page);
  }
  // The same code can't be used again (replay).
  const again = await login(u.super.email);
  // Exactly the code already used (still inside the ±1-step window), so this is a true replay.
  const replay = await app.request("POST", "/api/admin/mfa/verify", json({ [C.admin_mfa]: setCookieValue(again, C.admin_mfa)! }, { code: usedCode }));
  assert.equal(replay.status, 422);
});

test("invalid MFA, tampered sessions, staff and driver sessions never pass", async () => {
  const res = await login(u.super.email);
  const pending = setCookieValue(res, C.admin_mfa)!;
  assert.equal((await app.request("POST", "/api/admin/mfa/verify", json({ [C.admin_mfa]: pending }, { code: "12345x" }))).status, 422);
  // MFA endpoints need the pending session — staff/driver/admin cookies don't count.
  for (const cookie of [{}, { [C.staff]: staffToken }, { [C.driver]: driverToken }, { [C.platform_admin]: state.superCookie! }, { [C.admin_mfa]: staffToken }]) {
    assert.equal((await app.request("POST", "/api/admin/mfa/verify", json(cookie, { code: "123456" }))).status, 401, JSON.stringify(Object.keys(cookie)));
  }
  // Tampered admin session → 404 everywhere.
  const tampered = state.superCookie!.slice(0, -3) + (state.superCookie!.endsWith("A") ? "BBB" : "AAA");
  assert.equal((await app.request("GET", "/platform-admin", { headers: { ...cookies({ [C.platform_admin]: tampered }), ...ip() } })).status, 404);
  // Staff / driver tokens, in their own cookies or the admin cookie → 404.
  for (const cookie of [{ [C.staff]: staffToken }, { [C.driver]: driverToken }, { [C.platform_admin]: staffToken }, { [C.platform_admin]: driverToken }]) {
    assert.equal((await app.request("GET", "/platform-admin", { headers: { ...cookies(cookie), ...ip() } })).status, 404);
  }
  // A forged admin token with mfa:true but the wrong epoch → 404.
  const row = await prisma.platformAdmin.findUniqueOrThrow({ where: { userId: u.super.id } });
  const forged = await signToken({ type: "platform_admin", adminId: u.super.id, platformId: "skhokho", email: u.super.email, mfa: true, epoch: row.sessionEpoch + 7 });
  assert.equal((await app.request("GET", "/platform-admin", { headers: { ...cookies({ [C.platform_admin]: forged }), ...ip() } })).status, 404);
  // Failed MFA was audited, without the code.
  const events = await prisma.platformAuditEvent.findMany({ where: { action: "admin_mfa_failed", actorId: u.super.id } });
  assert.ok(events.length >= 1);
  assert.equal(JSON.stringify(events).includes("12345x"), false);
});

test("recovery code signs in once; MFA attempts are rate-limited (429) and audited", async () => {
  // Its own admin, enrolled through the real endpoints (each admin has its own 5-per-15-min MFA budget).
  const l = await login(u.ratelimit.email);
  const pending = setCookieValue(l, C.admin_mfa)!;
  const { secret } = JSON.parse((await app.request("POST", "/api/admin/mfa/enroll", json({ [C.admin_mfa]: pending }, {}))).body);
  const conf = await app.request("POST", "/api/admin/mfa/confirm", json({ [C.admin_mfa]: pending }, { code: totpNow(secret) }));
  assert.equal(conf.status, 200);
  const recovery: string[] = JSON.parse(conf.body).recoveryCodes;

  // A recovery code works once.
  const r1 = await app.request("POST", "/api/admin/mfa/verify", json({ [C.admin_mfa]: setCookieValue(await login(u.ratelimit.email), C.admin_mfa)! }, { recoveryCode: recovery[0] }));
  assert.equal(r1.status, 200);
  assert.equal(JSON.parse(r1.body).usedRecoveryCode, true);
  const r2 = await app.request("POST", "/api/admin/mfa/verify", json({ [C.admin_mfa]: setCookieValue(await login(u.ratelimit.email), C.admin_mfa)! }, { recoveryCode: recovery[0] }));
  assert.equal(r2.status, 422, "a used recovery code is refused");

  // Wrong codes until locked out (budget: confirm + 2 recovery uses already spent).
  const p2 = setCookieValue(await login(u.ratelimit.email), C.admin_mfa)!;
  const statuses: number[] = [];
  for (let i = 0; i < 4; i++) statuses.push((await app.request("POST", "/api/admin/mfa/verify", json({ [C.admin_mfa]: p2 }, { code: "000000" }))).status);
  assert.ok(statuses.includes(429), `statuses ${statuses}`);
  assert.equal((await app.request("POST", "/api/admin/mfa/verify", json({ [C.admin_mfa]: p2 }, { code: totpNow(secret, 1) }))).status, 429, "even the right code waits out the lockout");
  assert.ok(await prisma.platformAuditEvent.findFirst({ where: { action: "admin_mfa_rate_limited", actorId: u.ratelimit.id } }));
});

test("roles over HTTP: SUPPORT reads drivers but not documents, audit or security; reset by a super admin ends their session", async () => {
  // Enrol the support admin through the real endpoints.
  const l = await login(u.support.email);
  const pending = setCookieValue(l, C.admin_mfa)!;
  const { secret } = JSON.parse((await app.request("POST", "/api/admin/mfa/enroll", json({ [C.admin_mfa]: pending }, {}))).body);
  const conf = await app.request("POST", "/api/admin/mfa/confirm", json({ [C.admin_mfa]: pending }, { code: totpNow(secret) }));
  const support = setCookieValue(conf, C.platform_admin)!;
  const h = { headers: { ...cookies({ [C.platform_admin]: support }), ...ip() } };
  assert.equal((await app.request("GET", "/platform-admin/drivers", h)).status, 200);
  for (const page of ["/platform-admin/audit", "/platform-admin/security", "/platform-admin/payouts"]) assert.equal((await app.request("GET", page, h)).status, 404, page);
  const doc = await app.request("GET", "/api/admin/driver-documents/does-not-matter", h);
  assert.equal(doc.status, 404);
  assert.ok(await prisma.platformAuditEvent.findFirst({ where: { action: "admin_permission_denied", actorId: u.support.id } }), "the denial is a security event");

  // A super admin resets the support admin's MFA (reason required, audited) → their session dies at once.
  const target = await prisma.platformAdmin.findUniqueOrThrow({ where: { userId: u.support.id } });
  await resetAdminMfa(u.super.id, target.id, "Lost phone — verified by video call", { ip: null });
  assert.equal((await app.request("GET", "/platform-admin/drivers", h)).status, 404);
  const ev = await prisma.platformAuditEvent.findFirst({ where: { action: "admin_mfa_reset", resourceId: target.id } });
  assert.ok(ev?.reason?.includes("video call"));
});

test("health endpoints: liveness and readiness are up and leak nothing; every response carries a request id", async () => {
  const live = await app.request("GET", "/api/health");
  assert.equal(live.status, 200);
  assert.deepEqual(JSON.parse(live.body), { ok: true });
  const ready = await app.request("GET", "/api/health/ready");
  assert.equal(ready.status, 200);
  const body = JSON.parse(ready.body);
  assert.equal(body.database, "up");
  assert.equal(/postgres|neon|password|ep-/i.test(ready.body), false, "no connection details");
  assert.match(String(live.headers["x-request-id"]), /^[A-Za-z0-9._-]{8,64}$/);
  const echoed = await app.request("GET", "/api/health", { headers: { "x-request-id": "trace-abc-12345" } });
  assert.equal(echoed.headers["x-request-id"], "trace-abc-12345", "a valid caller id is kept for tracing");
  const junk = await app.request("GET", "/api/health", { headers: { "x-request-id": "<script>alert(1)</script>" } });
  assert.notEqual(junk.headers["x-request-id"], "<script>alert(1)</script>");
});

test("logout clears both admin cookies", async () => {
  const r = await app.request("POST", "/api/admin/logout", { headers: { ...cookies({ [C.platform_admin]: state.superCookie! }), ...ip() } });
  assert.equal(r.status, 303);
  const raw = ([] as string[]).concat(r.headers["set-cookie"] ?? []);
  assert.ok(raw.some((c) => c.startsWith(`${C.platform_admin}=;`) && /Max-Age=0/i.test(c)));
  assert.ok(raw.some((c) => c.startsWith(`${C.admin_mfa}=;`) && /Max-Age=0/i.test(c)));
});
