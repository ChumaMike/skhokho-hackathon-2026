import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Static guard checks for the Skhokholetha surface. The guards themselves
 * read next/headers request context, which node:test can't provide; this
 * makes sure every entry point at least CALLS the right guard, so a new route
 * can't quietly ship without one.
 */

const ROOT = join(process.cwd(), "src", "app");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

const rel = (p: string) => p.slice(ROOT.length + 1).replaceAll("\\", "/");

// Public by design: signing up, logging in/out, confirming an email, and the
// owner → driver route (guarded by requireOwner instead).
const PUBLIC_DRIVER_ROUTES = new Set([
  "api/driver/signup/route.ts",
  "api/driver/login/route.ts",
  "api/driver/logout/route.ts",
  "api/driver/verify-email/route.ts",
]);
// The in-house (staff) driver tracking route predates Skhokholetha and uses its own staff guard.
const IN_HOUSE_DRIVER_ROUTE = "api/driver/deliveries/[deliveryId]/location/route.ts";

test("every Skhokholetha driver API route requires a driver session", () => {
  const routes = files(join(ROOT, "api", "driver")).filter((p) => p.endsWith("route.ts")).map((p) => [rel(p), p] as const);
  assert.ok(routes.length >= 10);
  for (const [name, path] of routes) {
    if (PUBLIC_DRIVER_ROUTES.has(name) || name === IN_HOUSE_DRIVER_ROUTE) continue;
    const src = readFileSync(path, "utf8");
    if (name === "api/driver/become/route.ts") {
      assert.match(src, /requireOwner\(/, `${name} must require the owner session`);
      continue;
    }
    assert.match(src, /requireDriverSession\(\)/, `${name} must call requireDriverSession()`);
  }
});

test("the in-house driver route still uses its staff delivery guard", () => {
  assert.match(readFileSync(join(ROOT, IN_HOUSE_DRIVER_ROUTE), "utf8"), /assertCanActOnDelivery\(/);
});

test("every platform-admin page, action and admin API route checks an MFA admin session with a permission", () => {
  // Public by design: the two sign-in steps (as served on the admin host) and the
  // login/MFA/logout endpoints (each with its own pending-session check).
  const PUBLIC = /admin-login|admin-mfa|api[\\/]admin[\\/](login|logout|mfa)/;
  const targets = [
    ...files(join(ROOT, "platform-admin")).filter((p) => /(page\.tsx|actions\.ts)$/.test(p) && !PUBLIC.test(p)),
    ...files(join(ROOT, "api", "admin")).filter((p) => p.endsWith("route.ts") && !PUBLIC.test(p)),
  ];
  assert.ok(targets.length >= 20, `found ${targets.length}`);
  for (const p of targets) {
    const src = readFileSync(p, "utf8");
    // Pages: adminPage("perm"); actions: adminCommand({ permission }) or requireAdmin("perm"); routes: requireAdmin("perm").
    assert.match(src, /adminPage\("[a-z.]+"\)|adminCommand\(\{ permission: "[a-z.]+"|requireAdmin\(["'][a-z.]+["']\)/, `${rel(p)} must check an admin permission`);
    assert.doesNotMatch(src, /requireSuperAdmin\(/, `${rel(p)} must use the permission model, not the legacy helper`);
  }
  // The MFA endpoints: enrol/confirm/verify accept ONLY the pending session; regenerate needs a full one.
  for (const r of ["enroll", "confirm", "verify"]) assert.match(readFileSync(join(ROOT, "api", "admin", "mfa", r, "route.ts"), "utf8"), /requireMfaPending\(req\)/);
  assert.match(readFileSync(join(ROOT, "api", "admin", "mfa", "recovery-codes", "route.ts"), "utf8"), /requireAdmin\(\)/);
});

test("driver onboarding server actions resolve the driver from the session, never from the form", () => {
  const src = readFileSync(join(ROOT, "driver", "actions.ts"), "utf8");
  assert.match(src, /requireDriverSession\(\)/);
  assert.doesNotMatch(src, /fd\.get\("(driverId|status|verificationStatus|availability)"\)/);
});

test("no driver endpoint accepts a raw status or a client-asserted 'online' flag beyond the availability request", () => {
  for (const p of files(join(ROOT, "api", "driver")).filter((f) => f.endsWith("route.ts"))) {
    const src = readFileSync(p, "utf8");
    assert.doesNotMatch(src, /status:\s*z\./, `${rel(p)} must not accept a status field`);
    assert.doesNotMatch(src, /verificationStatus/, `${rel(p)} must not touch verification status`);
  }
  const delivery = readFileSync(join(ROOT, "api", "driver", "delivery", "[deliveryId]", "route.ts"), "utf8");
  assert.match(delivery, /discriminatedUnion\('action'/, "delivery steps are a closed list of named actions");
});

test("tracking pages are noindex, send no referrer and are rate limited; only the customer page can show a code", () => {
  for (const page of [["track", "[token]", "page.tsx"], ["delivery", "[key]", "page.tsx"]]) {
    const src = readFileSync(join(ROOT, ...page), "utf8");
    assert.match(src, /index:\s*false/);
    assert.match(src, /referrer:\s*"no-referrer"/);
    assert.match(src, /trackingIp/);
  }
  // The shop-shareable status page and its shared card never touch the drop-off code.
  assert.doesNotMatch(readFileSync(join(ROOT, "track", "[token]", "page.tsx"), "utf8"), /dropoffCode/);
  assert.doesNotMatch(readFileSync(join(ROOT, "track", "DeliveryStatusCard.tsx"), "utf8"), /dropoffCode/);
  // Nothing in the shop's dashboard references the customer's code or key.
  for (const p of files(join(ROOT, "dashboard"))) assert.doesNotMatch(readFileSync(p, "utf8"), /dropoffCode(?!Locked)|customerKey|getCustomerDeliveryView/, rel(p));
});

test("driver documents are served only as admin-only attachments", () => {
  const src = readFileSync(join(ROOT, "api", "admin", "driver-documents", "[documentId]", "route.ts"), "utf8");
  assert.match(src, /requireAdmin\('drivers\.documents'\)/);
  assert.match(src, /driver_document_downloaded/);
  assert.match(src, /attachment/);
  assert.match(src, /no-store/);
  assert.match(src, /nosniff/);
});
