import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { clearHostnameCache, PLATFORM_DOMAIN } from "@/lib/tenant/context";
import { middleware } from "./middleware";

/**
 * End-to-end tenant routing: real middleware, real hostname resolution,
 * real database rows (the app's Prisma singleton, like domain-attacks.test.ts).
 * Two ACTIVE tenants A and B, plus an inactive one, with STOREFRONT_DOMAIN
 * switched on — proving A's hostname only ever reaches A.
 */

const STOREFRONT = "skhokholabs.app";
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slugA = `mw-a-${run}`;
const slugB = `mw-b-${run}`;
const slugDraft = `mw-draft-${run}`;
const slugOld = `mw-old-${run}`;
const previousStorefront = process.env.STOREFRONT_DOMAIN;

let A: { id: string };
let B: { id: string };
let draft: { id: string };

test.before(async () => {
  process.env.STOREFRONT_DOMAIN = STOREFRONT;
  A = await prisma.business.create({ data: { name: "Tenant A", slug: slugA, status: "ACTIVE" }, select: { id: true } });
  B = await prisma.business.create({ data: { name: "Tenant B ☕", slug: slugB, status: "ACTIVE" }, select: { id: true } });
  draft = await prisma.business.create({ data: { name: "Draft", slug: slugDraft }, select: { id: true } });
  await prisma.businessSlugHistory.create({ data: { businessId: A.id, slug: slugOld } });
});

test.after(async () => {
  clearHostnameCache();
  if (previousStorefront === undefined) delete process.env.STOREFRONT_DOMAIN;
  else process.env.STOREFRONT_DOMAIN = previousStorefront;
  await prisma.businessSlugHistory.deleteMany({ where: { businessId: { in: [A.id, B.id, draft.id] } } });
  await prisma.business.deleteMany({ where: { id: { in: [A.id, B.id, draft.id] } } });
});

test.beforeEach(clearHostnameCache);

function request(host: string, path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://${host}${path}`, { headers: { host, ...headers } });
}

type Outcome =
  | { kind: "rewrite"; path: string; tenantId: string | null; tenantSlug: string | null }
  | { kind: "next"; tenantId: string | null; tenantSlug: string | null }
  | { kind: "redirect"; status: number; location: string };

/** What middleware decided, plus the tenant headers the PAGE would see. */
async function route(host: string, path: string, headers: Record<string, string> = {}): Promise<Outcome> {
  const res = await middleware(request(host, path, headers));
  const location = res.headers.get("location");
  if (location) return { kind: "redirect", status: res.status, location };

  // Request-header overrides: listed names are the FULL set the page receives.
  const overridden = (res.headers.get("x-middleware-override-headers") ?? "").split(",");
  const seen = (name: string) => (overridden.includes(name) ? res.headers.get(`x-middleware-request-${name}`) : null);
  const tenantId = seen("x-tenant-id");
  const tenantSlug = seen("x-tenant-slug");

  const rewrite = res.headers.get("x-middleware-rewrite");
  if (rewrite) return { kind: "rewrite", path: new URL(rewrite).pathname, tenantId, tenantSlug };
  return { kind: "next", tenantId, tenantSlug };
}

// ---------------------------------------------------------------------------
// Hostname → Business
// ---------------------------------------------------------------------------

test("tenant A hostname → tenant A; tenant B hostname → tenant B", async () => {
  assert.deepEqual(await route(`${slugA}.${STOREFRONT}`, "/"), { kind: "rewrite", path: `/store/${slugA}`, tenantId: A.id, tenantSlug: slugA });
  assert.deepEqual(await route(`${slugB}.${STOREFRONT}`, "/"), { kind: "rewrite", path: `/store/${slugB}`, tenantId: B.id, tenantSlug: slugB });
});

test("subdomain paths map onto the ONE /store/<slug> route tree (no duplicate storefront)", async () => {
  for (const path of ["/basket", "/checkout", "/shop", "/about", `/product/p1`, `/configure/p1`]) {
    const outcome = await route(`${slugA}.${STOREFRONT}`, path);
    assert.deepEqual(outcome, { kind: "rewrite", path: `/store/${slugA}${path}`, tenantId: A.id, tenantSlug: slugA }, path);
  }
});

test("hostname resolution is case-insensitive and ignores a port / trailing dot", async () => {
  const outcome = await route(`${slugA.toUpperCase()}.SKHOKHOLABS.APP.:443`, "/");
  assert.equal(outcome.kind, "rewrite");
  assert.equal((outcome as { tenantId: string }).tenantId, A.id);
});

// ---------------------------------------------------------------------------
// Tenant A can't reach tenant B
// ---------------------------------------------------------------------------

test("URL: A's host can't reach B through B's /store path", async () => {
  assert.deepEqual(await route(`${slugA}.${STOREFRONT}`, `/store/${slugB}`), {
    kind: "rewrite", path: "/not-found", tenantId: A.id, tenantSlug: slugA,
  });
  assert.deepEqual(await route(`${slugA}.${STOREFRONT}`, `/store/${slugB}/basket`), {
    kind: "rewrite", path: "/not-found", tenantId: A.id, tenantSlug: slugA,
  });
});

test("URL: path traversal-ish input stays pinned under A's own prefix", async () => {
  const outcome = await route(`${slugA}.${STOREFRONT}`, `/..%2Fstore%2F${slugB}`);
  assert.equal(outcome.kind, "rewrite");
  assert.ok((outcome as { path: string }).path.startsWith(`/store/${slugA}/`));
});

test("headers: a client-sent x-tenant-* header can never choose the tenant", async () => {
  const forged = { "x-tenant-id": B.id, "x-tenant-slug": slugB, "x-tenant-surface": "STOREFRONT", "x-tenant-name": "B" };

  // On A's host: resolution overwrites the forgery with A.
  const onA = await route(`${slugA}.${STOREFRONT}`, "/", forged);
  assert.equal((onA as { tenantId: string }).tenantId, A.id);
  assert.equal((onA as { tenantSlug: string }).tenantSlug, slugA);

  // On the platform host: the forgery is deleted outright.
  const onPlatform = await route(PLATFORM_DOMAIN, `/store/${slugA}`, forged);
  assert.deepEqual(onPlatform, { kind: "next", tenantId: null, tenantSlug: null });
});

test("query: query parameters play no part in tenant resolution", async () => {
  const outcome = await route(`${slugA}.${STOREFRONT}`, `/?slug=${slugB}&businessId=${B.id}&tenant=${slugB}`);
  assert.deepEqual(outcome, { kind: "rewrite", path: `/store/${slugA}`, tenantId: A.id, tenantSlug: slugA });
});

test("server actions / console: dashboard and login paths don't exist on a tenant host", async () => {
  for (const path of ["/dashboard", "/dashboard/orders", "/login", "/staff-login", "/join"]) {
    const outcome = await route(`${slugA}.${STOREFRONT}`, path, { "next-action": "deadbeef" });
    assert.equal(outcome.kind, "rewrite", path);
    assert.equal((outcome as { path: string }).path, `/store/${slugA}${path}`, path); // → no such storefront page → 404
  }
});

test("cache: alternating A/B lookups never serve one tenant's resolution to the other", async () => {
  for (let i = 0; i < 3; i++) {
    assert.equal((await route(`${slugA}.${STOREFRONT}`, "/") as { tenantId: string }).tenantId, A.id);
    assert.equal((await route(`${slugB}.${STOREFRONT}`, "/") as { tenantId: string }).tenantId, B.id);
  }
});

test("order-keyed pages pass through on a tenant host with that tenant pinned (pages refuse other tenants' orders)", async () => {
  assert.deepEqual(await route(`${slugA}.${STOREFRONT}`, "/store/pay/order123"), { kind: "next", tenantId: A.id, tenantSlug: slugA });
  assert.deepEqual(await route(`${slugA}.${STOREFRONT}`, "/store/order/order123"), { kind: "next", tenantId: A.id, tenantSlug: slugA });
});

test("a business name with non-Latin-1 characters doesn't break header injection", async () => {
  // Tenant B's name contains ☕ — header values must stay ByteStrings.
  assert.equal((await route(`${slugB}.${STOREFRONT}`, "/") as { tenantId: string }).tenantId, B.id);
});

// ---------------------------------------------------------------------------
// Unknown / inactive / reserved
// ---------------------------------------------------------------------------

test("unknown slug under the storefront domain → not found, never another tenant", async () => {
  assert.deepEqual(await route(`nobody-${run}.${STOREFRONT}`, "/"), { kind: "rewrite", path: "/not-found", tenantId: null, tenantSlug: null });
});

test("an inactive (unpublished) business doesn't resolve", async () => {
  assert.equal((await route(`${slugDraft}.${STOREFRONT}`, "/") as { path: string }).path, "/not-found");
});

test("reserved subdomains never resolve as a tenant", async () => {
  for (const label of ["api", "admin", "billing", "dashboard", "skhokho"]) {
    const outcome = await route(`${label}.${STOREFRONT}`, "/");
    assert.deepEqual(outcome, { kind: "rewrite", path: "/not-found", tenantId: null, tenantSlug: null }, label);
  }
});

test("unknown hostname → 404, never the Skhokho app and never a tenant fallback (B9)", async () => {
  for (const path of ["/", "/login", "/dashboard", "/staff-login", "/join"]) {
    assert.deepEqual(await route(`unknown-${run}.example.com`, path), { kind: "rewrite", path: "/not-found", tenantId: null, tenantSlug: null }, path);
  }
});

test("unknown hostname → API routes don't exist there either (B9)", async () => {
  for (const path of ["/api/platform/login", "/api/platform/join", "/api/platform/forgot-password", "/api/store/checkout"]) {
    const res = await middleware(request(`unknown-${run}.example.com`, path));
    assert.equal(res.status, 404, path);
  }
});

test("the deployment's own *.vercel.app host still serves the app (previews keep working)", async () => {
  assert.deepEqual(await route(`skhokho-platform-git-preview-${run}.vercel.app`, "/login"), { kind: "next", tenantId: null, tenantSlug: null });
  const api = await middleware(request(`skhokho-platform-git-preview-${run}.vercel.app`, "/api/platform/login"));
  assert.notEqual(api.status, 404);
});

test("platform host API routes pass through untouched, client tenant headers stripped", async () => {
  const res = await middleware(request(PLATFORM_DOMAIN, "/api/store/events", { "x-tenant-id": "forged" }));
  assert.equal(res.status, 200);
  const overridden = (res.headers.get("x-middleware-override-headers") ?? "").split(",");
  assert.equal(overridden.includes("x-tenant-id") && res.headers.get("x-middleware-request-x-tenant-id") !== null, false);
});

// ---------------------------------------------------------------------------
// Legacy route, canonical redirects
// ---------------------------------------------------------------------------

test("legacy route: platform-host /store/<slug> keeps working, no tenant headers", async () => {
  assert.deepEqual(await route(PLATFORM_DOMAIN, `/store/${slugA}`), { kind: "next", tenantId: null, tenantSlug: null });
  assert.deepEqual(await route(PLATFORM_DOMAIN, `/store/${slugA}/basket`), { kind: "next", tenantId: null, tenantSlug: null });
});

test("legacy route: unknown /store/<slug> falls through to the page's own 404", async () => {
  assert.deepEqual(await route(PLATFORM_DOMAIN, `/store/nobody-${run}`), { kind: "next", tenantId: null, tenantSlug: null });
});

test("legacy platform subdomain 308s to the canonical storefront host, keeping path and query", async () => {
  assert.deepEqual(await route(`${slugA}.${PLATFORM_DOMAIN}`, "/shop?x=1"), {
    kind: "redirect", status: 308, location: `https://${slugA}.${STOREFRONT}/shop?x=1`,
  });
});

test("legacy platform subdomain still resolves in place while STOREFRONT_DOMAIN is unset", async () => {
  delete process.env.STOREFRONT_DOMAIN;
  try {
    clearHostnameCache();
    assert.deepEqual(await route(`${slugA}.${PLATFORM_DOMAIN}`, "/"), { kind: "rewrite", path: `/store/${slugA}`, tenantId: A.id, tenantSlug: slugA });
  } finally {
    process.env.STOREFRONT_DOMAIN = STOREFRONT;
  }
});

test("a retired slug 308s to the current one — on the subdomain and on the legacy path", async () => {
  assert.deepEqual(await route(`${slugOld}.${STOREFRONT}`, "/about"), {
    kind: "redirect", status: 308, location: `https://${slugA}.${STOREFRONT}/about`,
  });
  // Same-host redirects stay on the host the visitor used.
  assert.deepEqual(await route(PLATFORM_DOMAIN, `/store/${slugOld}/about?x=1`), {
    kind: "redirect", status: 308, location: `https://${PLATFORM_DOMAIN}/store/${slugA}/about?x=1`,
  });
});

test("an old /store/<own-slug> link on the tenant host 308s to the clean URL", async () => {
  assert.deepEqual(await route(`${slugA}.${STOREFRONT}`, `/store/${slugA}/basket?ok=order`), {
    kind: "redirect", status: 308, location: `https://${slugA}.${STOREFRONT}/basket?ok=order`,
  });
});

test("a cross-host redirect keeps a dev port", async () => {
  const outcome = await route(`${slugOld}.localhost:3002`, "/about");
  assert.deepEqual(outcome, { kind: "redirect", status: 308, location: `https://${slugA}.localhost:3002/about` });
});

test("the bare storefront domain hosts no console: it 308s to the platform app", async () => {
  const outcome = await route(STOREFRONT, "/dashboard");
  assert.equal(outcome.kind, "redirect");
  assert.ok(!(outcome as { location: string }).location.includes(STOREFRONT));
});

test("public files are served as-is on a tenant host, not rewritten into the storefront", async () => {
  assert.equal((await route(`${slugA}.${STOREFRONT}`, "/homepage/hero.webp")).kind, "next");
});
