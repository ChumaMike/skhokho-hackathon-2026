import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { clearHostnameCache, resolveHostname } from "@/lib/tenant/context";
import { isPlatformAppHost, isPlatformOwnedHost, platformOwnedApexes } from "@/lib/tenant/platform-hosts";
import { addDomain, checkDomain, isValidCustomDomainHostname, removeDomain, DomainUnavailableError } from "./domain.service";
import { TestHostingProvider, setHostingProviderForTests } from "./domain-provider";
import { setTxtResolverForTests } from "./ownership";
import { challengeName, challengeValue } from "./domain-names";

/**
 * B8 (platform hosts can't be claimed, attached or detached by a merchant)
 * and B9 (nothing reaches a hostname until ownership is proven; unknown and
 * unverified hosts fail closed), against a real database.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const created: string[] = [];
const txt = new Map<string, string[]>();
const ENV_KEYS = ["PLATFORM_DOMAIN", "ADMIN_DOMAIN", "STOREFRONT_DOMAIN", "NEXT_PUBLIC_APP_URL", "PLATFORM_OWNED_DOMAINS", "PLATFORM_EXTRA_HOSTS"] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
let hosting: TestHostingProvider;

async function makeBusiness(label: string) {
  const b = await prisma.business.create({ data: { name: `Sec ${label}`, slug: `domsec-${label}-${run}`, status: "ACTIVE" }, select: { id: true, slug: true } });
  created.push(b.id);
  return b;
}

/** The merchant publishes their TXT proof. */
function prove(hostname: string, token: string) {
  txt.set(challengeName(hostname), [challengeValue(token)]);
}

test.before(() => {
  // Platform configuration as production would set it.
  process.env.PLATFORM_DOMAIN = "skhokho.sgdataint.co.za";
  process.env.ADMIN_DOMAIN = "admin.skhokho.co.za";
  process.env.STOREFRONT_DOMAIN = "skhokholabs.app";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.skhokholabs.app";
  process.env.PLATFORM_OWNED_DOMAINS = "skhokho.co.za,skhokholabs.co.za";
  delete process.env.PLATFORM_EXTRA_HOSTS;
  hosting = new TestHostingProvider();
  setHostingProviderForTests(hosting);
  setTxtResolverForTests(async (name) => {
    const values = txt.get(name);
    if (!values) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    return values.map((v) => [v]);
  });
});

test.beforeEach(clearHostnameCache);

test.after(async () => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  setHostingProviderForTests(null);
  setTxtResolverForTests(null);
  clearHostnameCache();
  await prisma.businessDomain.deleteMany({ where: { businessId: { in: created } } });
  await prisma.business.deleteMany({ where: { id: { in: created } } });
});

// ---------------------------------------------------------------------------
// The reservation policy (pure)
// ---------------------------------------------------------------------------

test("B8: everything under a platform-owned domain is reserved — infrastructure labels included", () => {
  for (const host of [
    "skhokho.sgdataint.co.za", "www.skhokho.sgdataint.co.za", "sgdataint.co.za", "mail.sgdataint.co.za",
    "admin.skhokho.co.za", "skhokho.co.za", "api.skhokho.co.za", "billing.skhokho.co.za", "status.skhokho.co.za",
    "skhokholabs.app", "kota.skhokholabs.app", "app.skhokholabs.app", "login.skhokholabs.app", "docs.skhokholabs.app",
    "skhokholabs.co.za", "support.skhokholabs.co.za",
    "anything.vercel.app", "localhost", "shop.localhost",
  ]) {
    assert.equal(isPlatformOwnedHost(host), true, host);
    assert.equal(isValidCustomDomainHostname(host), false, host);
  }
});

test("B8: the policy is apex-based, not a string-prefix rule", () => {
  // Merchant domains that merely LOOK like platform words are theirs.
  for (const host of ["kotatainment.co.za", "www.kotatainment.co.za", "admin.kotatainment.co.za", "api.nomsahair.co.za", "skhokhofan.co.za", "notskhokholabs.app", "skhokho.co.za.evil.com"]) {
    assert.equal(isPlatformOwnedHost(host), false, host);
  }
  assert.ok(platformOwnedApexes().includes("sgdataint.co.za"), "co.za apex, not co.za itself");
  assert.equal(platformOwnedApexes().includes("co.za"), false);
});

test("B9: the Skhokho app renders only on known platform hosts", () => {
  for (const host of ["skhokho.sgdataint.co.za", "www.skhokho.sgdataint.co.za", "app.skhokholabs.app", "admin.skhokho.co.za", "localhost", "my-project-git-x.vercel.app"]) {
    assert.equal(isPlatformAppHost(host), true, host);
  }
  for (const host of ["skhokho-login.co.za", "kotatainment.co.za", "api.skhokho.co.za", "evil.example.com"]) {
    assert.equal(isPlatformAppHost(host), false, host);
  }
});

// ---------------------------------------------------------------------------
// Claiming, attaching, detaching
// ---------------------------------------------------------------------------

test("B8: a merchant can't add a platform host (admin, app, storefront root, vercel.app)", async () => {
  const biz = await makeBusiness("reserved");
  for (const hostname of ["admin.skhokho.co.za", "app.skhokholabs.app", "skhokholabs.app", "kota.skhokholabs.app", "project.vercel.app"]) {
    await assert.rejects(addDomain(biz.id, { hostname }), /real domain name you own/, hostname);
  }
  assert.equal(hosting.attachCalls.length, 0, "nothing was ever attached");
});

test("B9: adding a domain attaches NOTHING; it attaches only after the TXT proof", async () => {
  const biz = await makeBusiness("attach");
  const hostname = `kota-${run}.co.za`;
  const [row] = await addDomain(biz.id, { hostname, includePartner: false });
  assert.equal(hosting.attachCalls.includes(hostname), false, "not attached on add");

  await checkDomain(biz.id, row.id);
  assert.equal(hosting.attachCalls.includes(hostname), false, "still not attached without proof");

  prove(hostname, row.verificationToken!);
  const checked = await checkDomain(biz.id, row.id);
  assert.equal(hosting.attachCalls.includes(hostname), true, "attached once proven");
  assert.equal(checked.providerAttached, true);
  assert.equal(checked.status, "VERIFYING");

  hosting.pointAtUs(hostname);
  assert.equal((await checkDomain(biz.id, row.id)).status, "ACTIVE");
});

test("B8: a hostname that was already on the project is never detached by a merchant's removal", async () => {
  const biz = await makeBusiness("preattached");
  const hostname = `shared-${run}.co.za`;
  hosting.preAttached(hostname); // e.g. something the platform put there itself
  const [row] = await addDomain(biz.id, { hostname, includePartner: false });
  prove(hostname, row.verificationToken!);
  const checked = await checkDomain(biz.id, row.id);
  assert.equal(checked.providerAttached, false, "'already exists' is not our attachment");

  await removeDomain(biz.id, row.id);
  assert.equal(hosting.detached.includes(hostname), false, "not ours — not detached");
  assert.equal(hosting.attachedHosts.has(hostname), true);
});

test("B8: removing a domain we attached detaches exactly it; re-adding starts from scratch", async () => {
  const biz = await makeBusiness("remove");
  const hostname = `remove-${run}.co.za`;
  const [row] = await addDomain(biz.id, { hostname, includePartner: false });
  prove(hostname, row.verificationToken!);
  await checkDomain(biz.id, row.id);
  await removeDomain(biz.id, row.id);
  assert.deepEqual(hosting.detached.filter((h) => h === hostname), [hostname]);

  // Reattachment: a fresh row, nothing attached until proven again.
  const callsBefore = hosting.attachCalls.filter((h) => h === hostname).length;
  const [again] = await addDomain(biz.id, { hostname, includePartner: false });
  assert.equal(again.status, "PENDING");
  assert.equal(again.providerAttached, false);
  assert.equal(hosting.attachCalls.filter((h) => h === hostname).length, callsBefore);
});

test("B8: another merchant's domain can't be taken, and a duplicate add is refused", async () => {
  const a = await makeBusiness("owner");
  const b = await makeBusiness("rival");
  const hostname = `owned-${run}.co.za`;
  const [row] = await addDomain(a.id, { hostname, includePartner: false });
  prove(hostname, row.verificationToken!);
  await checkDomain(a.id, row.id);

  await assert.rejects(addDomain(b.id, { hostname, includePartner: false }), DomainUnavailableError);
  await assert.rejects(addDomain(a.id, { hostname, includePartner: false }), /already connected to your business/);
  // B can't detach it either: removal is scoped to the caller's own rows.
  await assert.rejects(removeDomain(b.id, row.id), /not found/i);
  assert.equal(hosting.attachedHosts.has(hostname), true);
});

test("B8: a hostname still on another business's legacy customDomain can't be claimed", async () => {
  const legacy = await makeBusiness("legacy");
  const hostname = `legacy-${run}.co.za`;
  await prisma.business.update({ where: { id: legacy.id }, data: { customDomain: hostname } });
  const other = await makeBusiness("legacyclaim");
  await assert.rejects(addDomain(other.id, { hostname, includePartner: false }), DomainUnavailableError);
});

// ---------------------------------------------------------------------------
// Unknown and unverified hosts fail closed
// ---------------------------------------------------------------------------

test("B9: an unverified custom domain resolves to not-found — never the console, never the tenant", async () => {
  const biz = await makeBusiness("pending");
  const hostname = `pending-${run}.co.za`;
  await addDomain(biz.id, { hostname, includePartner: false });
  const r = await resolveHostname(hostname);
  assert.equal(r.type, "not_found");
  assert.match((r as { reason: string }).reason, /not live yet/);
});

test("B9: an unknown host (a look-alike) resolves to not-found", async () => {
  for (const host of [`skhokho-login-${run}.co.za`, "evil.example.com"]) {
    const r = await resolveHostname(host);
    assert.equal(r.type, "not_found", host);
  }
});

test("B9: a verified, live custom domain resolves to its own business", async () => {
  const biz = await makeBusiness("live");
  const hostname = `live-${run}.co.za`;
  const [row] = await addDomain(biz.id, { hostname, includePartner: false });
  prove(hostname, row.verificationToken!);
  await checkDomain(biz.id, row.id);
  hosting.pointAtUs(hostname);
  await checkDomain(biz.id, row.id);
  clearHostnameCache();
  const r = await resolveHostname(hostname);
  assert.equal(r.type, "tenant");
  assert.equal((r as { tenant: { id: string } }).tenant.id, biz.id);
});

test("B9: Host manipulation — case, trailing dot and port don't change the verdict", async () => {
  for (const host of [`EVIL-${run}.example.com`, `evil-${run}.example.com.`, `evil-${run}.example.com:443`]) {
    const r = await resolveHostname(host);
    assert.equal(r.type, "not_found", host);
  }
  assert.equal((await resolveHostname("SKHOKHO.SGDATAINT.CO.ZA:443")).type, "platform_root");
});
