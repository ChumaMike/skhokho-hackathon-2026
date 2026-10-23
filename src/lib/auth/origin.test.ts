import test from "node:test";
import assert from "node:assert/strict";
import { checkCrossSite, hasSessionCookie, requestHost } from "./origin";

/** The cross-site check behind every cookie-authenticated /api write. */

function req(method: string, headers: Record<string, string>) {
  const h = new Headers(headers);
  return { method, headers: { get: (n: string) => h.get(n) } };
}
const COOKIE = "skhokho-staff-token=abc; theme=dark";

test("a forged cross-site POST carrying our cookie is blocked, by fetch metadata or by Origin", () => {
  assert.deepEqual(checkCrossSite(req("POST", { cookie: COOKIE, host: "app.skhokho.test", "sec-fetch-site": "cross-site", origin: "https://app.skhokho.test" })), { blocked: true, reason: "cross_site" });
  assert.deepEqual(checkCrossSite(req("POST", { cookie: COOKIE, host: "app.skhokho.test", origin: "https://evil.example" })), { blocked: true, reason: "origin_mismatch" });
  assert.deepEqual(checkCrossSite(req("DELETE", { cookie: COOKIE, host: "app.skhokho.test", origin: "null" })), { blocked: true, reason: "origin_mismatch" });
});

test("same-site requests pass: fetch metadata, or an Origin matching the addressed host (proxy-forwarded too)", () => {
  assert.deepEqual(checkCrossSite(req("POST", { cookie: COOKIE, host: "app.skhokho.test", "sec-fetch-site": "same-origin" })), { blocked: false });
  assert.deepEqual(checkCrossSite(req("POST", { cookie: COOKIE, host: "app.skhokho.test", origin: "https://app.skhokho.test" })), { blocked: false });
  assert.deepEqual(checkCrossSite(req("POST", { cookie: COOKIE, host: "APP.skhokho.test", origin: "https://app.SKHOKHO.test" })), { blocked: false });
  // Behind Vercel the addressed host arrives in x-forwarded-host.
  assert.deepEqual(checkCrossSite(req("PATCH", { cookie: COOKIE, host: "internal.vercel.app", "x-forwarded-host": "admin.skhokho.test", origin: "https://admin.skhokho.test" })), { blocked: false });
  // A tenant storefront host posting to its own API.
  assert.deepEqual(checkCrossSite(req("POST", { cookie: COOKIE, host: "kota.skhokholabs.app", origin: "https://kota.skhokholabs.app" })), { blocked: false });
});

test("nothing to protect: reads, requests without our cookie, Bearer tokens, and clients that send no browser metadata", () => {
  assert.deepEqual(checkCrossSite(req("GET", { cookie: COOKIE, host: "app.skhokho.test", origin: "https://evil.example" })), { blocked: false });
  assert.deepEqual(checkCrossSite(req("POST", { host: "app.skhokho.test", origin: "https://evil.example" })), { blocked: false }, "no session cookie (e.g. the PayFast ITN)");
  assert.deepEqual(checkCrossSite(req("POST", { cookie: "theme=dark", host: "app.skhokho.test", origin: "https://evil.example" })), { blocked: false }, "unrelated cookie only");
  assert.deepEqual(checkCrossSite(req("POST", { cookie: COOKIE, host: "app.skhokho.test", authorization: "Bearer x.y.z", origin: "https://evil.example" })), { blocked: false }, "token auth");
  assert.deepEqual(checkCrossSite(req("POST", { cookie: COOKIE, host: "app.skhokho.test" })), { blocked: false }, "no Origin, no Sec-Fetch-Site: not a browser");
});

test("helpers: session cookie detection and the addressed host", () => {
  assert.equal(hasSessionCookie(req("GET", { cookie: "a=1; skhokho-driver-token=zz" }).headers), true);
  assert.equal(hasSessionCookie(req("GET", { cookie: "a=1" }).headers), false);
  assert.equal(hasSessionCookie(req("GET", {}).headers), false);
  assert.equal(requestHost(req("GET", { host: "A.Example", "x-forwarded-host": "b.example, c.example" }).headers), "b.example");
  assert.equal(requestHost(req("GET", { host: "A.Example" }).headers), "a.example");
});
