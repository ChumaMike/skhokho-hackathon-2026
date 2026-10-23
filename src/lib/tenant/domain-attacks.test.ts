import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { clearHostnameCache, normalizeHostname, resolveHostname } from "./context";

/**
 * Phase 8 adversarial hostname suite. These fixtures use the development
 * database because resolveHostname is intentionally wired to the application's
 * Prisma singleton. Every row created here is removed in the file-level hook.
 */

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const apex = `domain-attack-${suffix}.co.za`;

let businessA: { id: string };
let businessB: { id: string };

test.before(async () => {
  businessA = await prisma.business.create({
    data: { name: "Domain Attack A", slug: `domain-attack-a-${suffix}`, status: "ACTIVE" },
    select: { id: true },
  });
  businessB = await prisma.business.create({
    data: { name: "Domain Attack B", slug: `domain-attack-b-${suffix}`, status: "ACTIVE" },
    select: { id: true },
  });
});

test.after(async () => {
  clearHostnameCache();
  await prisma.businessDomain.deleteMany({
    where: { businessId: { in: [businessA.id, businessB.id] } },
  });
  await prisma.business.deleteMany({ where: { id: { in: [businessA.id, businessB.id] } } });
});

test.beforeEach(clearHostnameCache);

test("unknown custom host never resolves to a tenant", async () => {
  const result = await resolveHostname(`unknown-${suffix}.co.za`);
  assert.notEqual(result.type, "tenant");
});

for (const status of ["PENDING", "VERIFYING", "FAILED", "REVOKED"] as const) {
  test(`${status} custom domain never routes to its business`, async () => {
    const hostname = `${status.toLowerCase()}-${apex}`;
    await prisma.businessDomain.create({
      data: { businessId: businessA.id, hostname, surface: "STOREFRONT", status },
    });

    const result = await resolveHostname(hostname);
    assert.notEqual(result.type, "tenant");
  });
}

test("ACTIVE domain normalizes uppercase and a DNS trailing dot", async () => {
  const hostname = `normalization-${apex}`;
  await prisma.businessDomain.create({
    data: { businessId: businessA.id, hostname, surface: "BOOKINGS", status: "ACTIVE" },
  });

  assert.equal(normalizeHostname(`${hostname.toUpperCase()}.`), hostname);
  const result = await resolveHostname(`${hostname.toUpperCase()}.`);
  assert.equal(result.type, "tenant");
  if (result.type === "tenant") {
    assert.equal(result.tenant.id, businessA.id);
    assert.equal(result.surface, "BOOKINGS");
  }
});

test("apex and www mappings remain exact and cannot cross tenant boundaries", async () => {
  const exactApex = `exact-${apex}`;
  const exactWww = `www.${exactApex}`;
  await prisma.businessDomain.createMany({
    data: [
      { businessId: businessA.id, hostname: exactApex, surface: "STOREFRONT", status: "ACTIVE" },
      { businessId: businessB.id, hostname: exactWww, surface: "ADMIN", status: "ACTIVE" },
    ],
  });

  const apexResult = await resolveHostname(exactApex);
  const wwwResult = await resolveHostname(exactWww);
  assert.equal(apexResult.type, "tenant");
  assert.equal(wwwResult.type, "tenant");
  if (apexResult.type === "tenant") assert.equal(apexResult.tenant.id, businessA.id);
  if (wwwResult.type === "tenant") {
    assert.equal(wwwResult.tenant.id, businessB.id);
    assert.equal(wwwResult.surface, "ADMIN");
  }
});

test("database global uniqueness rejects duplicate hostname ownership", async () => {
  const hostname = `duplicate-${apex}`;
  await prisma.businessDomain.create({
    data: { businessId: businessA.id, hostname, surface: "STOREFRONT", status: "ACTIVE" },
  });

  await assert.rejects(
    prisma.businessDomain.create({
      data: { businessId: businessB.id, hostname, surface: "BOOKINGS", status: "ACTIVE" },
    }),
  );
});

test("inactive business never routes even through an ACTIVE domain", async () => {
  const hostname = `inactive-business-${apex}`;
  await prisma.business.update({ where: { id: businessA.id }, data: { status: "SUSPENDED" } });
  await prisma.businessDomain.create({
    data: { businessId: businessA.id, hostname, surface: "STOREFRONT", status: "ACTIVE" },
  });

  const result = await resolveHostname(hostname);
  assert.equal(result.type, "not_found");
  await prisma.business.update({ where: { id: businessA.id }, data: { status: "ACTIVE" } });
});
