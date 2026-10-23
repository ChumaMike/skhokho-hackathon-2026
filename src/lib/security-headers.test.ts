import test from "node:test";
import assert from "node:assert/strict";
import { buildContentSecurityPolicy, securityHeaders, STRICT_TRANSPORT_SECURITY, PERMISSIONS_POLICY } from "./security-headers";

/** The CSP / HSTS / Permissions-Policy set next.config.ts applies (Tab 5). */

function directive(policy: string, name: string): string[] | null {
  const part = policy.split(";").map((p) => p.trim()).find((p) => p === name || p.startsWith(`${name} `));
  return part === undefined ? null : part.slice(name.length).trim().split(/\s+/).filter(Boolean);
}

test("production policy: scripts only from us and Google Maps, forms only to us and PayFast, no plugins, no framing, no base hijack", () => {
  const p = buildContentSecurityPolicy({ dev: false });
  assert.deepEqual(directive(p, "script-src"), ["'self'", "'unsafe-inline'", "https://maps.googleapis.com"]);
  assert.deepEqual(directive(p, "form-action"), ["'self'", "https://www.payfast.co.za", "https://sandbox.payfast.co.za"]);
  assert.deepEqual(directive(p, "object-src"), ["'none'"]);
  assert.deepEqual(directive(p, "base-uri"), ["'self'"]);
  assert.deepEqual(directive(p, "frame-ancestors"), ["'none'"]);
  assert.deepEqual(directive(p, "frame-src"), ["'none'"]);
  assert.deepEqual(directive(p, "upgrade-insecure-requests"), []);
  assert.ok(directive(p, "connect-src")!.includes("https://maps.googleapis.com"));
  assert.ok(directive(p, "connect-src")!.includes("https://*.public.blob.vercel-storage.com"));
  assert.equal(directive(p, "script-src")!.includes("'unsafe-eval'"), false);
  assert.equal(directive(p, "connect-src")!.includes("ws:"), false);
  // Fonts are self-hosted by next/font — no Google Fonts origins anywhere.
  assert.equal(p.includes("fonts.googleapis.com") || p.includes("fonts.gstatic.com"), false);
});

test("development adds only what the dev server needs: eval for React Refresh and a websocket for HMR", () => {
  const p = buildContentSecurityPolicy({ dev: true });
  assert.ok(directive(p, "script-src")!.includes("'unsafe-eval'"));
  assert.ok(directive(p, "connect-src")!.includes("ws:"));
  assert.equal(directive(p, "upgrade-insecure-requests"), null);
});

test("the storefront preview may be framed by the console itself and nothing else", () => {
  assert.deepEqual(directive(buildContentSecurityPolicy({ dev: false, frameAncestors: "self" }), "frame-ancestors"), ["'self'"]);
});

test("HSTS is two years with subdomains and no preload; the headers set is complete", () => {
  assert.equal(STRICT_TRANSPORT_SECURITY, "max-age=63072000; includeSubDomains");
  assert.match(PERMISSIONS_POLICY, /geolocation=\(self\)/);
  assert.match(PERMISSIONS_POLICY, /camera=\(\)/);
  const keys = securityHeaders({ dev: false }).map((h) => h.key);
  assert.deepEqual(keys, ["Content-Security-Policy", "Strict-Transport-Security", "Permissions-Policy"]);
});
