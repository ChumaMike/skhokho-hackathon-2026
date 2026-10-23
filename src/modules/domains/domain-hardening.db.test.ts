import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { clearHostnameCache, resolveHostname } from "@/lib/tenant/context";
import { addDomain, checkDomain, listDomains, recheckDomains, removeDomain, CLAIM_TTL_MS, MAX_FAILED_CHECKS, RECHECK_INTERVAL_MS, DomainUnavailableError } from "./domain.service";
import { TestHostingProvider, setHostingProviderForTests } from "./domain-provider";
import { setTxtResolverForTests } from "./ownership";
import { challengeName, challengeValue } from "./domain-names";

/**
 * Tab 5 domain hardening: VERIFYING rows are re-checked, removing and
 * re-adding never renews a claim window, stale unproven claims are released,
 * and a DNS resolver failure is not a failed proof.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const created: string[] = [];
const txt = new Map<string, string[]>();
const failing = new Set<string>(); // names whose lookup SERVFAILs
let hosting: TestHostingProvider;

async function business(label: string) {
  const b = await prisma.business.create({ data: { name: `Domain Hardening ${label}`, slug: `dh-${label}-${run}`, status: "ACTIVE" }, select: { id: true } });
  created.push(b.id);
  return b;
}
const publish = (hostname: string, token: string) => txt.set(challengeName(hostname), [challengeValue(token)]);

test.before(() => {
  hosting = new TestHostingProvider();
  setHostingProviderForTests(hosting);
  setTxtResolverForTests(async (name) => {
    if (failing.has(name)) throw Object.assign(new Error("SERVFAIL"), { code: "ESERVFAIL" });
    const values = txt.get(name);
    if (!values) throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    return values.map((v) => [v]);
  });
});

test.after(async () => {
  setHostingProviderForTests(null);
  setTxtResolverForTests(null);
  clearHostnameCache();
  await prisma.businessDomain.deleteMany({ where: { businessId: { in: created } } });
  await prisma.business.deleteMany({ where: { id: { in: created } } });
});

test.beforeEach(clearHostnameCache);

test("a VERIFYING domain is re-checked by the sweep: it goes live when DNS/SSL arrive, and loses its hold if the proof disappears", async () => {
  const b = await business("verifying");
  const [row] = await addDomain(b.id, { hostname: `verifying-${run}.co.za`, includePartner: false });
  publish(row.hostname, row.verificationToken!);
  assert.equal((await checkDomain(b.id, row.id)).status, "VERIFYING", "proven, but DNS not pointed yet");

  // The sweep now picks VERIFYING rows up; DNS/SSL arrive meanwhile.
  hosting.pointAtUs(row.hostname);
  const later = new Date(Date.now() + RECHECK_INTERVAL_MS + 1000);
  await recheckDomains(later);
  assert.equal((await prisma.businessDomain.findUniqueOrThrow({ where: { id: row.id } })).status, "ACTIVE");

  // Another, whose proof vanishes while VERIFYING: back to PENDING, so the hostname isn't held for ever.
  const other = await business("verifying-lost");
  const [r2] = await addDomain(other.id, { hostname: `verifying-lost-${run}.co.za`, includePartner: false });
  publish(r2.hostname, r2.verificationToken!);
  assert.equal((await checkDomain(other.id, r2.id)).status, "VERIFYING");
  txt.delete(challengeName(r2.hostname));
  await recheckDomains(new Date(Date.now() + RECHECK_INTERVAL_MS + 1000));
  const dropped = await prisma.businessDomain.findUniqueOrThrow({ where: { id: r2.id } });
  assert.equal(dropped.status, "PENDING");
  assert.equal(dropped.ownershipStatus, "PENDING");
});

test("removing and re-adding keeps the original claim; the real owner can take an abandoned claim; the sweep releases stale ones", async () => {
  const squatter = await business("squatter");
  const owner = await business("owner");
  const hostname = `contested-${run}.co.za`;

  const [claim] = await addDomain(squatter.id, { hostname, includePartner: false });
  await assert.rejects(addDomain(owner.id, { hostname, includePartner: false }), DomainUnavailableError, "inside the window the claim holds");

  // The squatter removes and re-adds: the row is revived, createdAt unchanged — no fresh 72h.
  await removeDomain(squatter.id, claim.id);
  assert.equal((await listDomains(squatter.id)).some((d) => d.hostname === hostname), false, "removed from the merchant's list");
  const [revived] = await addDomain(squatter.id, { hostname, includePartner: false });
  assert.equal(revived.id, claim.id, "same row");
  assert.equal(revived.createdAt.getTime(), claim.createdAt.getTime(), "original claim time kept");
  assert.equal(revived.status, "PENDING");

  // Once the window is past, the real owner takes it — with or without the sweep.
  const past = new Date(Date.now() + CLAIM_TTL_MS + 1000);
  const [taken] = await addDomain(owner.id, { hostname, includePartner: false }, { now: past });
  assert.equal(taken.businessId, owner.id);
  assert.equal(await prisma.businessDomain.count({ where: { hostname } }), 1, "the stale claim row is gone");

  // The sweep releases an unproven claim past the window on its own.
  const third = await business("stale");
  const [stale] = await addDomain(third.id, { hostname: `stale-${run}.co.za`, includePartner: false });
  await prisma.businessDomain.update({ where: { id: stale.id }, data: { createdAt: new Date(Date.now() - CLAIM_TTL_MS - 1000) } });
  const result = await recheckDomains(new Date(Date.now() + RECHECK_INTERVAL_MS + 1000));
  assert.ok(result.released >= 1);
  assert.equal((await prisma.businessDomain.findUniqueOrThrow({ where: { id: stale.id } })).status, "REVOKED");
  // ...and a REVOKED row is claimable by anyone at once.
  const [fresh] = await addDomain(owner.id, { hostname: `stale-${run}.co.za`, includePartner: false });
  assert.equal(fresh.businessId, owner.id);
});

test("a removed domain stops routing, and re-adding by its owner must prove ownership again", async () => {
  const b = await business("remove-live");
  const [row] = await addDomain(b.id, { hostname: `remove-live-${run}.co.za`, includePartner: false });
  publish(row.hostname, row.verificationToken!);
  hosting.pointAtUs(row.hostname);
  assert.equal((await checkDomain(b.id, row.id)).status, "ACTIVE");
  await removeDomain(b.id, row.id);
  clearHostnameCache();
  assert.notEqual((await resolveHostname(row.hostname)).type, "tenant");
  assert.ok(hosting.detached.includes(row.hostname), "detached from hosting");
  const [again] = await addDomain(b.id, { hostname: row.hostname, includePartner: false });
  assert.equal(again.status, "PENDING");
  assert.equal(again.ownershipStatus, "PENDING");
  // The TXT record is still published, so the next check proves it again.
  assert.equal((await checkDomain(b.id, again.id)).ownershipStatus, "VERIFIED");
});

test("a DNS resolver failure records the problem but neither counts a failed check nor moves the domain", async () => {
  const b = await business("servfail");
  const [row] = await addDomain(b.id, { hostname: `servfail-${run}.co.za`, includePartner: false });
  publish(row.hostname, row.verificationToken!);
  hosting.pointAtUs(row.hostname);
  assert.equal((await checkDomain(b.id, row.id)).status, "ACTIVE");

  failing.add(challengeName(row.hostname));
  for (let i = 0; i < MAX_FAILED_CHECKS + 2; i++) {
    const r = await checkDomain(b.id, row.id);
    assert.equal(r.status, "ACTIVE");
    assert.equal(r.failedChecks, 0, "a resolver outage is not a lost proof");
    assert.match(r.lastError ?? "", /Couldn't look up/);
  }
  // A PENDING row under a resolver outage stays PENDING with the message, no state change.
  const [pending] = await addDomain(b.id, { hostname: `servfail-pending-${run}.co.za`, includePartner: false });
  failing.add(challengeName(pending.hostname));
  const p = await checkDomain(b.id, pending.id);
  assert.equal(p.status, "PENDING");
  assert.match(p.lastError ?? "", /Couldn't look up/);
  failing.clear();
  assert.equal((await checkDomain(b.id, row.id)).status, "ACTIVE");
});
