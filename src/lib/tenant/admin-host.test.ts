import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { hashPassword, verifyToken, COOKIE_NAME } from "@/modules/auth/auth.service";
import { clearHostnameCache } from "@/lib/tenant/context";
import { middleware } from "@/middleware";
import { POST as adminLogin } from "@/app/api/admin/login/route";
import { adminPath, stripAdminPrefix } from "./admin-paths";

/**
 * Regression: on the admin host (admin.<platform>) middleware already adds
 * /platform-admin, so anything that carried the prefix itself used to become
 * /platform-admin/platform-admin/… and 404 — including the post-login
 * redirect. Real middleware and the real login route.
 */

const ADMIN_HOST = "admin.localhost";
const PLATFORM_HOST = "localhost";
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const adminEmail = `admin-host-${run}@example.test`;
const ownerEmail = `admin-host-owner-${run}@example.test`;
const PASSWORD = "correct-horse-battery";

test.before(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  await prisma.appUser.create({ data: { email: adminEmail, role: "ADMIN", passwordHash } });
  await prisma.appUser.create({ data: { email: ownerEmail, role: "OWNER", passwordHash } });
});
test.after(async () => {
  clearHostnameCache();
  await prisma.platformAdmin.deleteMany({ where: { user: { email: { in: [adminEmail, ownerEmail] } } } });
  await prisma.appUser.deleteMany({ where: { email: { in: [adminEmail, ownerEmail] } } });
});
test.beforeEach(clearHostnameCache);

async function mw(host: string, path: string) {
  const res = await middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }));
  return { status: res.status, location: res.headers.get("location"), rewrite: res.headers.get("x-middleware-rewrite") };
}

function login(host: string, email: string, password: string) {
  const body = new FormData();
  body.set("email", email);
  body.set("password", password);
  // A per-test IP so the login rate limiter never couples these cases.
  return adminLogin(new NextRequest(`https://${host}/api/admin/login`, { method: "POST", body, headers: { host, "x-real-ip": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } }));
}

test("pure: the prefix is stripped exactly once, and admin paths are built per host", () => {
  assert.equal(stripAdminPrefix("/platform-admin/drivers/abc"), "/drivers/abc");
  assert.equal(stripAdminPrefix("/platform-admin"), "/");
  assert.equal(stripAdminPrefix("/drivers"), null);
  assert.equal(stripAdminPrefix("/platform-administrator"), null, "only a whole path segment counts");
  assert.equal(adminPath("/drivers", true), "/drivers");
  assert.equal(adminPath("/drivers", false), "/platform-admin/drivers");
  assert.equal(adminPath("/", false), "/platform-admin");
});

test("admin host: a clean path is served from /platform-admin (unchanged behaviour)", async () => {
  const r = await mw(ADMIN_HOST, "/drivers");
  assert.ok(r.rewrite?.endsWith("/platform-admin/drivers"), String(r.rewrite));
});

test("admin host: a /platform-admin/… path is redirected to the clean URL, never prefixed twice", async () => {
  const r = await mw(ADMIN_HOST, "/platform-admin/drivers/abc?status=APPROVED");
  assert.equal(r.status, 308);
  const loc = new URL(r.location!);
  assert.equal(loc.host, ADMIN_HOST);
  assert.equal(loc.pathname, "/drivers/abc");
  assert.equal(loc.search, "?status=APPROVED");
  const root = await mw(ADMIN_HOST, "/platform-admin");
  assert.equal(new URL(root.location!).pathname, "/");
});

test("admin host: /admin-login reaches a real page (/platform-admin/admin-login)", async () => {
  const r = await mw(ADMIN_HOST, "/admin-login");
  assert.ok(r.rewrite?.endsWith("/platform-admin/admin-login"), String(r.rewrite));
});

test("platform host: /platform-admin/… is passed through untouched (unchanged behaviour)", async () => {
  const r = await mw(PLATFORM_HOST, "/platform-admin/drivers");
  assert.equal(r.location, null);
  assert.equal(r.rewrite, null);
});

test("password step on either host: lands on /admin-mfa with ONLY the MFA-pending session (no admin session yet)", async () => {
  for (const host of [ADMIN_HOST, PLATFORM_HOST]) {
    const res = await login(host, adminEmail, PASSWORD);
    assert.equal(res.status, 303);
    assert.equal(new URL(res.headers.get("location")!).pathname, "/admin-mfa", host);
    const pending = res.cookies.get(COOKIE_NAME.admin_mfa)?.value;
    assert.ok(pending);
    assert.equal((await verifyToken(pending!)).type, "admin_mfa");
    assert.equal(res.cookies.get(COOKIE_NAME.platform_admin)?.value || undefined, undefined, "a password alone never yields an admin session");
  }
});

test("admin host: /admin-mfa reaches a real page (/platform-admin/admin-mfa)", async () => {
  const r = await mw(ADMIN_HOST, "/admin-mfa");
  assert.ok(r.rewrite?.endsWith("/platform-admin/admin-mfa"), String(r.rewrite));
});

test("after MFA, the home is host-aware: / on the admin host, /platform-admin on the platform host", async () => {
  const { adminHome } = await import("@/modules/platform-admin/session");
  assert.equal(await adminHome(new NextRequest(`https://${ADMIN_HOST}/api/admin/mfa/verify`, { headers: { host: ADMIN_HOST } })), "/");
  assert.equal(await adminHome(new NextRequest(`https://${PLATFORM_HOST}/api/admin/mfa/verify`, { headers: { host: PLATFORM_HOST } })), "/platform-admin");
});

test("unauthenticated: wrong password or a non-admin account gets the login page back and no session", async () => {
  for (const [email, password] of [[adminEmail, "wrong-password-1"], [ownerEmail, PASSWORD], [`nobody-${run}@example.test`, PASSWORD]]) {
    for (const host of [ADMIN_HOST, PLATFORM_HOST]) {
      const res = await login(host, email, password);
      assert.equal(res.status, 303);
      const loc = new URL(res.headers.get("location")!);
      assert.equal(loc.pathname, "/admin-login", `${email} on ${host}`);
      assert.ok(loc.searchParams.get("err"));
      assert.equal(res.cookies.get(COOKIE_NAME.platform_admin)?.value || undefined, undefined);
      assert.equal(res.cookies.get(COOKIE_NAME.admin_mfa)?.value || undefined, undefined);
    }
  }
});
