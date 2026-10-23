import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { clearHostnameCache, resolveHostname } from "@/lib/tenant/context";
import { canonicalStorefrontUrl } from "@/modules/tenant/storefront-url";
import {
  isValidCustomDomainHostname,
  addDomain,
  checkDomain,
  setPrimaryDomain,
  removeDomain,
  listDomains,
  recheckDomains,
  getPrimaryStorefrontHost,
  DomainUnavailableError,
  DomainNotFoundError,
  CLAIM_TTL_MS,
  MAX_FAILED_CHECKS,
} from "./domain.service";
import {
  searchDomains,
  startPurchase,
  completePurchase,
  cancelPurchase,
  syncRegistration,
  setAutoRenew,
  getTransferCode,
  RegistrationError,
} from "./domain-registration.service";
import { TestHostingProvider, VercelHostingProvider, setHostingProviderForTests } from "./domain-provider";
import { SandboxRegistrar, UnconfiguredRegistrar, SANDBOX_PRICE_CENTS, setRegistrarForTests } from "./registrar";
import { setTxtResolverForTests } from "./ownership";
import { apexOf, challengeName, challengeValue, labelFromQuery, wwwPartner } from "./domain-names";

/**
 * Paid custom domains end to end: hostname validation, the connect → prove →
 * point → secure → live state machine, A-can't-take-B's-domain, apex/www/
 * subdomain routing, ownership re-checks, and buying through the registrar
 * abstraction. Runs against the test database; DNS, hosting and the
 * registrar are test doubles — no real DNS, hosting account or registry is
 * touched, and nothing is ever purchased.
 */

// ---------------------------------------------------------------------------
// isValidCustomDomainHostname — pure, no DB
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

test("isValidCustomDomainHostname accepts a real-looking domain", () => {
  assert.equal(isValidCustomDomainHostname("www.nomsahair.co.za"), true);
  assert.equal(isValidCustomDomainHostname("nomsahair.co.za"), true);
});

test("isValidCustomDomainHostname normalizes case and a trailing port before validating", () => {
  assert.equal(isValidCustomDomainHostname("WWW.Nomsahair.CO.ZA"), true);
  assert.equal(isValidCustomDomainHostname("nomsahair.co.za:3000"), true);
});

test("isValidCustomDomainHostname rejects a bare label (no dot)", () => {
  assert.equal(isValidCustomDomainHostname("nomsahair"), false);
});

test("isValidCustomDomainHostname rejects localhost and *.localhost", () => {
  assert.equal(isValidCustomDomainHostname("localhost"), false);
  assert.equal(isValidCustomDomainHostname("shop.localhost"), false);
});

test("isValidCustomDomainHostname rejects an IPv4 address", () => {
  assert.equal(isValidCustomDomainHostname("192.168.1.1"), false);
});

test("isValidCustomDomainHostname rejects an IPv6 literal", () => {
  assert.equal(isValidCustomDomainHostname("::1"), false);
});

test("isValidCustomDomainHostname rejects reserved/private TLDs", () => {
  assert.equal(isValidCustomDomainHostname("shop.test"), false);
  assert.equal(isValidCustomDomainHostname("shop.local"), false);
  assert.equal(isValidCustomDomainHostname("shop.internal"), false);
  assert.equal(isValidCustomDomainHostname("shop.example"), false);
  assert.equal(isValidCustomDomainHostname("shop.invalid"), false);
});

test("isValidCustomDomainHostname rejects malformed labels", () => {
  assert.equal(isValidCustomDomainHostname("-shop.co.za"), false);
  assert.equal(isValidCustomDomainHostname("shop-.co.za"), false);
  assert.equal(isValidCustomDomainHostname("sh op.co.za"), false);
  assert.equal(isValidCustomDomainHostname(""), false);
});

test("isValidCustomDomainHostname rejects the platform domain and any subdomain of it", () => {
  assert.equal(isValidCustomDomainHostname("skhokho.sgdataint.co.za"), false);
  assert.equal(isValidCustomDomainHostname("nomsa.skhokho.sgdataint.co.za"), false);
  assert.equal(isValidCustomDomainHostname("evil.admin.skhokho.sgdataint.co.za"), false);
});


// ---------------------------------------------------------------------------
// Domain names — pure
// ---------------------------------------------------------------------------

test("apexOf understands .co.za second-level registries", () => {
  assert.equal(apexOf("www.kotatainment.co.za"), "kotatainment.co.za");
  assert.equal(apexOf("kotatainment.co.za"), "kotatainment.co.za");
  assert.equal(apexOf("shop.kota.example.com"), "example.com");
  assert.equal(wwwPartner("kotatainment.co.za"), "www.kotatainment.co.za");
  assert.equal(wwwPartner("www.kotatainment.co.za"), "kotatainment.co.za");
  assert.equal(wwwPartner("shop.kotatainment.co.za"), null);
  assert.equal(challengeName("www.kotatainment.co.za"), "_skhokho-verify.kotatainment.co.za");
});

test("labelFromQuery turns a business name into a domain label", () => {
  assert.equal(labelFromQuery("Kota Tainment!"), "kotatainment");
  assert.equal(labelFromQuery("Kota Tainment", true), "kota-tainment");
  assert.equal(labelFromQuery("Hair & Nails"), "hairandnails");
  assert.equal(labelFromQuery("kotatainment.co.za"), "kotatainment");
});

// ---------------------------------------------------------------------------
// The flow — real (test) database; DNS, hosting and registrar are test doubles.
// Nothing here touches real DNS, a real hosting account or a real registry.
// ---------------------------------------------------------------------------

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const created: string[] = [];
const txt = new Map<string, string[]>();
let hosting: TestHostingProvider;
let registrar: SandboxRegistrar;

async function business(label: string, slug = `dom-${label}-${run}`) {
  const b = await prisma.business.create({ data: { name: `Domain ${label}`, slug, status: "ACTIVE" }, select: { id: true, slug: true } });
  created.push(b.id);
  return b;
}

/** The merchant publishes the TXT record we asked for. */
function publishTxt(hostname: string, token: string) {
  txt.set(challengeName(hostname), [challengeValue(token)]);
}

test.before(() => {
  hosting = new TestHostingProvider();
  registrar = new SandboxRegistrar();
  setHostingProviderForTests(hosting);
  setRegistrarForTests(registrar);
  setTxtResolverForTests(async (name) => {
    const values = txt.get(name);
    if (!values) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    return values.map((v) => [v]);
  });
});

test.after(async () => {
  setHostingProviderForTests(null);
  setRegistrarForTests(null);
  setTxtResolverForTests(null);
  clearHostnameCache();
  await prisma.businessDomain.deleteMany({ where: { businessId: { in: created } } });
  await prisma.domainRegistration.deleteMany({ where: { businessId: { in: created } } });
  await prisma.business.deleteMany({ where: { id: { in: created } } });
});

test.beforeEach(clearHostnameCache);

test("addDomain rejects an invalid hostname before creating any row", async () => {
  const b = await business("invalid");
  await assert.rejects(addDomain(b.id, { hostname: "localhost" }));
  assert.equal(await prisma.businessDomain.count({ where: { businessId: b.id } }), 0);
});

test("connecting a domain adds its www partner, PENDING, with one shared random token — nothing routes", async () => {
  const b = await business("connect");
  const rows = await addDomain(b.id, { hostname: `KOTA-${run}.CO.ZA` });
  assert.deepEqual(rows.map((r) => r.hostname).sort(), [`kota-${run}.co.za`, `www.kota-${run}.co.za`]);
  assert.ok(rows.every((r) => r.status === "PENDING" && r.ownershipStatus === "PENDING"));
  assert.equal(new Set(rows.map((r) => r.verificationToken)).size, 1, "one TXT record proves both");
  assert.ok((rows[0].verificationToken ?? "").length >= 20, "unguessable token");
  assert.notEqual((await resolveHostname(`kota-${run}.co.za`)).type, "tenant");
});

test("activation needs ALL of: ownership proof, DNS pointing at us, SSL", async () => {
  const b = await business("activate");
  const [apex] = await addDomain(b.id, { hostname: `act-${run}.co.za`, includePartner: false });

  // Nothing done yet.
  let row = await checkDomain(b.id, apex.id);
  assert.equal(row.status, "PENDING");
  assert.equal(row.ownershipStatus, "PENDING");
  assert.match(row.lastError ?? "", /No TXT record/);

  // DNS + SSL alone are NOT ownership — a Host header pointing here proves nothing.
  hosting.pointAtUs(apex.hostname);
  row = await checkDomain(b.id, apex.id);
  assert.equal(row.status, "PENDING");
  assert.notEqual((await resolveHostname(apex.hostname)).type, "tenant");

  // Ownership proven, DNS fine, SSL pending → not yet.
  publishTxt(apex.hostname, apex.verificationToken!);
  hosting.pointAtUs(apex.hostname, false);
  row = await checkDomain(b.id, apex.id);
  assert.equal(row.status, "VERIFYING");
  assert.equal(row.ownershipStatus, "VERIFIED");
  assert.equal(row.sslStatus, "PENDING");

  // Certificate issued → live, and the first live domain becomes the main address.
  hosting.pointAtUs(apex.hostname, true);
  row = await checkDomain(b.id, apex.id);
  assert.equal(row.status, "ACTIVE");
  assert.equal(row.isPrimary, true);
  assert.equal(row.dnsStatus, "CONFIGURED");
  assert.equal(row.sslStatus, "ISSUED");

  const resolution = await resolveHostname(apex.hostname);
  assert.equal(resolution.type, "tenant");
  if (resolution.type === "tenant") assert.equal(resolution.tenant.id, b.id);
});

test("a TXT record with the wrong token proves nothing", async () => {
  const b = await business("wrongtoken");
  const [row] = await addDomain(b.id, { hostname: `wrong-${run}.co.za`, includePartner: false });
  txt.set(challengeName(row.hostname), [challengeValue("someone-elses-token")]);
  hosting.pointAtUs(row.hostname);
  assert.equal((await checkDomain(b.id, row.id)).status, "PENDING");
});

test("domain A → tenant B is impossible: a verified domain can't be claimed by another business", async () => {
  const a = await business("owner-a");
  const b = await business("owner-b");
  const [mine] = await addDomain(a.id, { hostname: `taken-by-a-${run}.co.za`, includePartner: false });
  publishTxt(mine.hostname, mine.verificationToken!);
  hosting.pointAtUs(mine.hostname);
  await checkDomain(a.id, mine.id);

  await assert.rejects(addDomain(b.id, { hostname: mine.hostname }), DomainUnavailableError);
  // B can't act on A's domain row either.
  await assert.rejects(checkDomain(b.id, mine.id), DomainNotFoundError);
  await assert.rejects(setPrimaryDomain(b.id, mine.id), DomainNotFoundError);
  await assert.rejects(removeDomain(b.id, mine.id), DomainNotFoundError);
  const r = await resolveHostname(mine.hostname);
  assert.equal(r.type === "tenant" ? r.tenant.id : null, a.id);
});

test("a fresh unverified claim blocks others for the claim window; an abandoned one can be taken over by the real owner", async () => {
  const squatter = await business("squatter");
  const owner = await business("real-owner");
  const host = `contested-${run}.co.za`;
  await addDomain(squatter.id, { hostname: host, includePartner: false });

  await assert.rejects(addDomain(owner.id, { hostname: host, includePartner: false }), /being connected by another account/);

  const later = new Date(Date.now() + CLAIM_TTL_MS + 60_000);
  const [mine] = await addDomain(owner.id, { hostname: host, includePartner: false }, { now: later });
  assert.equal(mine.businessId, owner.id);
  // B9: an unverified claim is never attached to the hosting project, so
  // there's nothing to release — and nothing of the squatter's ever served traffic.
  assert.equal(hosting.attachCalls.includes(host), false, "the squatter's claim never reached the hosting project");
  assert.equal(hosting.detached.includes(host), false);

  // The squatter's token can never verify the real owner's row.
  publishTxt(host, mine.verificationToken!);
  hosting.pointAtUs(host);
  assert.equal((await checkDomain(owner.id, mine.id)).status, "ACTIVE");
});

test("apex and www both resolve to the same business; the non-primary one redirects to the main address", async () => {
  const b = await business("pair");
  const rows = await addDomain(b.id, { hostname: `pair-${run}.co.za` });
  const apex = rows.find((r) => !r.hostname.startsWith("www."))!;
  const www = rows.find((r) => r.hostname.startsWith("www."))!;
  publishTxt(apex.hostname, apex.verificationToken!);
  hosting.pointAtUs(apex.hostname);
  hosting.pointAtUs(www.hostname);
  await checkDomain(b.id, www.id); // www goes live first → becomes primary
  await checkDomain(b.id, apex.id);

  const atWww = await resolveHostname(www.hostname);
  assert.equal(atWww.type === "tenant" ? atWww.tenant.id : null, b.id);
  assert.deepEqual(await resolveHostname(apex.hostname), { type: "redirect", reason: "canonical_domain", host: www.hostname });

  await setPrimaryDomain(b.id, apex.id);
  const atApex = await resolveHostname(apex.hostname);
  assert.equal(atApex.type === "tenant" ? atApex.tenant.id : null, b.id);
  assert.deepEqual(await resolveHostname(www.hostname), { type: "redirect", reason: "canonical_domain", host: apex.hostname });
  assert.equal(await getPrimaryStorefrontHost(b.id), apex.hostname);
});

test("the free subdomain keeps resolving to the same business alongside the custom domain", async () => {
  const previous = process.env.STOREFRONT_DOMAIN;
  process.env.STOREFRONT_DOMAIN = "skhokholabs.app";
  try {
    const b = await business("both", `both-${run}`);
    const [row] = await addDomain(b.id, { hostname: `both-${run}.co.za`, includePartner: false });
    publishTxt(row.hostname, row.verificationToken!);
    hosting.pointAtUs(row.hostname);
    await checkDomain(b.id, row.id);
    clearHostnameCache();
    const custom = await resolveHostname(row.hostname);
    const free = await resolveHostname(`both-${run}.skhokholabs.app`);
    assert.equal(custom.type === "tenant" ? custom.tenant.id : null, b.id);
    assert.equal(free.type === "tenant" ? free.tenant.id : null, b.id);
    // ...and the canonical address is the custom domain.
    assert.equal(canonicalStorefrontUrl(b.slug, "", await getPrimaryStorefrontHost(b.id)), `https://${row.hostname}`);
  } finally {
    if (previous === undefined) delete process.env.STOREFRONT_DOMAIN;
    else process.env.STOREFRONT_DOMAIN = previous;
  }
});

test("re-check: a live domain whose ownership proof disappears stops routing after repeated failures", async () => {
  const b = await business("lapse");
  const [row] = await addDomain(b.id, { hostname: `lapse-${run}.co.za`, includePartner: false });
  publishTxt(row.hostname, row.verificationToken!);
  hosting.pointAtUs(row.hostname);
  assert.equal((await checkDomain(b.id, row.id)).status, "ACTIVE");

  // The domain changes hands: the TXT record is gone.
  txt.delete(challengeName(row.hostname));
  for (let i = 1; i < MAX_FAILED_CHECKS; i++) {
    const r = await checkDomain(b.id, row.id);
    assert.equal(r.status, "ACTIVE", `still routing after ${i} failed check(s) — DNS blips don't take a store down`);
    assert.equal(r.failedChecks, i);
  }
  const stopped = await checkDomain(b.id, row.id);
  assert.equal(stopped.status, "FAILED");
  assert.equal(stopped.ownershipStatus, "FAILED");
  assert.notEqual((await resolveHostname(row.hostname)).type, "tenant");

  // Proof restored → live again.
  publishTxt(row.hostname, row.verificationToken!);
  assert.equal((await checkDomain(b.id, row.id)).status, "ACTIVE");
});

test("recheckDomains re-verifies what's due, and reports what stopped routing", async () => {
  const b = await business("cron");
  const [row] = await addDomain(b.id, { hostname: `cron-${run}.co.za`, includePartner: false });
  publishTxt(row.hostname, row.verificationToken!);
  hosting.pointAtUs(row.hostname);
  await checkDomain(b.id, row.id);
  await prisma.businessDomain.update({ where: { id: row.id }, data: { failedChecks: MAX_FAILED_CHECKS - 1 } });
  txt.delete(challengeName(row.hostname));

  const result = await recheckDomains(new Date(Date.now() + 13 * 60 * 60 * 1000));
  assert.ok(result.checked >= 1);
  assert.ok(result.stoppedRouting >= 1);
  assert.equal((await prisma.businessDomain.findUniqueOrThrow({ where: { id: row.id } })).status, "FAILED");
});

test("disconnecting is always possible and releases the hostname", async () => {
  const b = await business("remove");
  const [row] = await addDomain(b.id, { hostname: `remove-${run}.co.za`, includePartner: false });
  await removeDomain(b.id, row.id);
  // Tab 5: the row stays as REVOKED (so re-adding can't renew a claim window) but is gone from the merchant's list and holds nothing.
  assert.equal(await prisma.businessDomain.count({ where: { hostname: row.hostname, status: { not: "REVOKED" } } }), 0);
  assert.equal((await listDomains(b.id)).some((d) => d.hostname === row.hostname), false);
  // B9: an unverified domain was never attached to the hosting project, so
  // there is nothing to detach (a verified one is detached — see
  // domain-security.db.test.ts).
  assert.equal(hosting.detached.includes(row.hostname), false);
});

// ---------------------------------------------------------------------------
// Buying a domain (sandbox registrar)
// ---------------------------------------------------------------------------

test("search: availability and price come from the registrar; names already on Skhokho show as taken", async () => {
  const b = await business("search");
  const result = await searchDomains(b.id, `Kota ${run}`);
  assert.equal(result.offered, true);
  const names = result.results.map((r) => r.domain);
  assert.ok(names.includes(`kota${run}.co.za`));
  assert.ok(names.includes(`kota-${run}.co.za`));
  assert.ok(result.results.every((r) => !r.available || r.registerPriceCents === SANDBOX_PRICE_CENTS));
  const taken = await searchDomains(b.id, `taken ${run}`);
  assert.ok(taken.results.every((r) => !r.available));
});

test("with no registrar configured, buying isn't offered — merchants connect a domain they own", async () => {
  setRegistrarForTests(new UnconfiguredRegistrar());
  try {
    const b = await business("noreg");
    assert.deepEqual(await searchDomains(b.id, "kota"), { offered: false, registrarName: "Not configured", results: [] });
    await assert.rejects(startPurchase(b.id, { domain: "kota.co.za", registrant: { name: "Thandi M", email: "t@example.co.za" } }), RegistrationError);
  } finally {
    setRegistrarForTests(registrar);
  }
});

test("purchase: nothing is registered before payment; then it's registered TO THE MERCHANT and connected", async () => {
  const b = await business("buy");
  const domain = `buy-${run}.co.za`;
  const quote = await startPurchase(b.id, { domain, years: 2, registrant: { name: "Thandi Mokoena", email: "Thandi@Example.co.za" } });
  assert.equal(quote.status, "AWAITING_PAYMENT");
  assert.equal(quote.priceCents, SANDBOX_PRICE_CENTS * 2);
  assert.equal(quote.registrantEmail, "thandi@example.co.za");
  assert.equal(registrar.domains.size === 0 || ![...registrar.domains.values()].some((d) => d.domain === domain), true, "not registered yet");
  // Someone else can't start buying the same domain meanwhile.
  const other = await business("buy-other");
  await assert.rejects(startPurchase(other.id, { domain, registrant: { name: "Someone Else", email: "x@example.co.za" } }), /already being bought/);

  const done = await completePurchase(quote.id, "billing_ref_1");
  assert.equal(done.status, "REGISTERED");
  assert.ok(done.expiresAt && done.expiresAt > new Date());
  const held = [...registrar.domains.values()].find((d) => d.domain === domain)!;
  assert.deepEqual(held.registrant, { name: "Thandi Mokoena", email: "thandi@example.co.za" }, "the merchant is the registrant");

  // Connected automatically, ownership proven by the registration (no TXT needed).
  const rows = await prisma.businessDomain.findMany({ where: { businessId: b.id }, orderBy: { hostname: "asc" } });
  assert.deepEqual(rows.map((r) => r.hostname), [domain, `www.${domain}`]);
  assert.ok(rows.every((r) => r.verificationMethod === "REGISTRAR" && r.ownershipStatus === "VERIFIED"));
  hosting.pointAtUs(domain);
  assert.equal((await checkDomain(b.id, rows[0].id)).status, "ACTIVE");

  // A repeated payment confirmation changes nothing.
  assert.equal((await completePurchase(quote.id, "billing_ref_1")).status, "REGISTERED");
});

test("a registration overrides another business's fresh, unverified claim on the same hostname", async () => {
  const squatter = await business("reg-squat");
  const buyer = await business("reg-buyer");
  const domain = `regsquat-${run}.co.za`;
  await addDomain(squatter.id, { hostname: domain, includePartner: false });
  const quote = await startPurchase(buyer.id, { domain, registrant: { name: "Real Owner", email: "owner@example.co.za" } });
  const done = await completePurchase(quote.id, "billing_ref_2");
  assert.equal(done.status, "REGISTERED");
  assert.equal(done.lastError, null);
  const row = await prisma.businessDomain.findUniqueOrThrow({ where: { hostname: domain } });
  assert.equal(row.businessId, buyer.id);
});

test("renewals, auto-renew, and the merchant's way out (transfer code)", async () => {
  const b = await business("renew");
  const other = await business("renew-other");
  const quote = await startPurchase(b.id, { domain: `renew-${run}.co.za`, registrant: { name: "Sipho N", email: "sipho@example.co.za" } });
  await completePurchase(quote.id, "billing_ref_3");

  const off = await setAutoRenew(b.id, quote.id, false);
  assert.equal(off.autoRenew, false);
  const soon = new Date(off.expiresAt!.getTime() - 10 * 24 * 60 * 60 * 1000);
  assert.equal((await syncRegistration(b.id, quote.id, soon)).status, "RENEWAL_DUE");
  const after = new Date(off.expiresAt!.getTime() + 1000);
  assert.equal((await syncRegistration(b.id, quote.id, after)).status, "EXPIRED");

  const code = await getTransferCode(b.id, quote.id);
  assert.match(code, /^SBX-/);
  // Only ever for the registrant's own business.
  await assert.rejects(getTransferCode(other.id, quote.id), RegistrationError);
  assert.equal(JSON.stringify(await prisma.domainRegistration.findUniqueOrThrow({ where: { id: quote.id } })).includes(code), false, "the code is never stored");
});

test("cancelling an unpaid purchase frees the name", async () => {
  const b = await business("cancel");
  const domain = `cancel-${run}.co.za`;
  const quote = await startPurchase(b.id, { domain, registrant: { name: "Lerato K", email: "lerato@example.co.za" } });
  await cancelPurchase(b.id, quote.id);
  const again = await startPurchase(b.id, { domain, registrant: { name: "Lerato K", email: "lerato@example.co.za" } });
  assert.equal(again.status, "AWAITING_PAYMENT");
});

test("the sandbox registrar refuses to run in production", () => {
  const env = process.env as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    assert.throws(() => new SandboxRegistrar(), /never run in production/);
  } finally {
    env.NODE_ENV = previous;
  }
});

// ---------------------------------------------------------------------------
// Vercel hosting adapter — the documented endpoints, with fetch stubbed
// ---------------------------------------------------------------------------

test("the Vercel adapter calls the documented endpoints and only reports SSL-ready when DNS is right", async () => {
  const calls: string[] = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(`${init?.method ?? "GET"} ${u.replace("https://api.vercel.com", "")}`);
    if (u.includes("/v6/domains/")) return new Response(JSON.stringify({ misconfigured: false, recommendedIPv4: [{ rank: 1, value: ["76.76.21.21"] }] }));
    if (u.includes("/v9/projects/") && (init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ name: "kota.co.za", verified: true }));
    return new Response(JSON.stringify({ name: "kota.co.za", verified: true }));
  }) as typeof fetch;
  const vercel = new VercelHostingProvider("tok", "prj_1", "team_1", fakeFetch);

  await vercel.attach("kota.co.za");
  const status = await vercel.status("kota.co.za");
  assert.deepEqual(
    { attached: status.attached, dnsConfigured: status.dnsConfigured, sslReady: status.sslReady },
    { attached: true, dnsConfigured: true, sslReady: true },
  );
  assert.deepEqual(status.records, [{ type: "A", name: "kota.co.za", value: "76.76.21.21" }]);
  await vercel.detach("kota.co.za");

  assert.ok(calls.includes("POST /v10/projects/prj_1/domains?teamId=team_1"));
  assert.ok(calls.some((c) => c.startsWith("GET /v9/projects/prj_1/domains/kota.co.za")));
  assert.ok(calls.some((c) => c.startsWith("GET /v6/domains/kota.co.za/config")));
  assert.ok(calls.includes("DELETE /v9/projects/prj_1/domains/kota.co.za?teamId=team_1"), "removes from the project, never deletes the merchant's domain");
});
