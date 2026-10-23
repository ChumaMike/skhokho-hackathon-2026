import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { hashPassword } from "@/modules/auth/auth.service";
import { getActiveProduct, getActiveService } from "@/modules/catalog/catalog.service";
import {
  createBusiness,
  getBusinessBySlug,
  searchActiveBusinesses,
  getPublishReadiness,
  publishBusiness,
  PublishValidationError,
  canBusinessBePublic,
  canBusinessAcceptOrders,
  canBusinessAcceptBookings,
} from "./tenant.service";

/**
 * Phase (post-8) fix for a real V1 blocker found live in production: a
 * business registered PENDING_VERIFICATION, and nothing anywhere in the
 * codebase ever moved it to ACTIVE — every business was permanently
 * invisible to customers. This covers the merchant-controlled publish flow
 * that replaces that dead end, and the write-path gate (getActiveProduct/
 * getActiveService) that closes the matching security gap: businessId in
 * /api/store/order and /api/store/book comes straight from client form
 * data, so "not public" has to be enforced at the write layer, not just on
 * the storefront page.
 */

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function makeBusiness(label: string, overrides: { status?: "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED" } = {}) {
  return prisma.business.create({
    data: {
      name: `Publication Test ${label}`,
      slug: `publication-test-${label}-${suffix}`,
      status: overrides.status ?? "PENDING_VERIFICATION",
    },
  });
}

test.after(async () => {
  await prisma.product.deleteMany({ where: { business: { slug: { startsWith: `publication-test-` } } } });
  await prisma.service.deleteMany({ where: { business: { slug: { startsWith: `publication-test-` } } } });
  await prisma.businessSubscription.deleteMany({ where: { business: { slug: { startsWith: `publication-test-` } } } });
  await prisma.businessStaff.deleteMany({ where: { business: { slug: { startsWith: `publication-test-` } } } });
  await prisma.businessRole.deleteMany({ where: { business: { slug: { startsWith: `publication-test-` } } } });
  await prisma.business.deleteMany({ where: { slug: { startsWith: `publication-test-` } } });
});

// ---------------------------------------------------------------------------
// TEST A — registration defaults to PENDING_VERIFICATION
// ---------------------------------------------------------------------------

test("a newly registered business starts PENDING_VERIFICATION, not visible", async () => {
  const { business } = await createBusiness({
    name: "New Registration Salon",
    category: "SALON",
    owner: {
      firstName: "Reg",
      lastName: "Owner",
      email: `reg-owner-${suffix}@example.test`,
      passwordHash: await hashPassword("SomePassword123"),
    },
  });

  assert.equal(business.status, "PENDING_VERIFICATION");

  // cleanup (createBusiness isn't under the publication-test- slug prefix used above)
  await prisma.businessStaff.deleteMany({ where: { businessId: business.id } });
  await prisma.businessRole.deleteMany({ where: { businessId: business.id } });
  await prisma.businessSubscription.deleteMany({ where: { businessId: business.id } });
  await prisma.business.delete({ where: { id: business.id } });
});

// ---------------------------------------------------------------------------
// TEST B / C — PENDING invisibility (discover + storefront + write paths)
// ---------------------------------------------------------------------------

test("PENDING_VERIFICATION business does not appear in discover", async () => {
  const biz = await makeBusiness("pending-discover");
  const results = await searchActiveBusinesses({});
  assert.ok(!results.some((b) => b.id === biz.id));
});

test("PENDING_VERIFICATION business has no live storefront lookup", async () => {
  const biz = await makeBusiness("pending-storefront");
  assert.equal(await getBusinessBySlug(biz.slug), null);
});

test("PENDING_VERIFICATION business rejects order/booking writes even with a real product/service", async () => {
  const biz = await makeBusiness("pending-write");
  const product = await prisma.product.create({ data: { businessId: biz.id, name: "Test Product", price: 50 } });
  const service = await prisma.service.create({ data: { businessId: biz.id, name: "Test Service", price: 100, duration: 30 } });

  assert.equal(await getActiveProduct(biz.id, product.id), null);
  assert.equal(await getActiveService(biz.id, service.id), null);
});

// ---------------------------------------------------------------------------
// TEST E — publish validation
// ---------------------------------------------------------------------------

test("an empty business is not ready to publish, and publishBusiness rejects it", async () => {
  const biz = await makeBusiness("empty-readiness");
  const readiness = await getPublishReadiness(biz.id);
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missing, ["Add at least one product or service"]);

  await assert.rejects(publishBusiness(biz.id), PublishValidationError);
  const after = await prisma.business.findUniqueOrThrow({ where: { id: biz.id } });
  assert.equal(after.status, "PENDING_VERIFICATION");
});

test("a business with only a product (no service) is ready — salon/spaza flexibility", async () => {
  const biz = await makeBusiness("product-only-readiness");
  await prisma.product.create({ data: { businessId: biz.id, name: "Only Product", price: 50 } });
  const readiness = await getPublishReadiness(biz.id);
  assert.equal(readiness.ready, true);
  assert.deepEqual(readiness.missing, []);
});

test("an inactive (hidden) product does not count toward readiness", async () => {
  const biz = await makeBusiness("inactive-product-readiness");
  await prisma.product.create({ data: { businessId: biz.id, name: "Hidden Product", price: 50, isActive: false } });
  const readiness = await getPublishReadiness(biz.id);
  assert.equal(readiness.ready, false);
});

// ---------------------------------------------------------------------------
// TEST H / I / J / K — successful publication and the resulting visibility
// ---------------------------------------------------------------------------

test("publishing a ready business transitions PENDING_VERIFICATION -> ACTIVE, then it's fully visible", async () => {
  const biz = await makeBusiness("full-publish");
  const service = await prisma.service.create({ data: { businessId: biz.id, name: "Publishable Service", price: 200, duration: 45 } });

  const published = await publishBusiness(biz.id);
  assert.equal(published.status, "ACTIVE");

  // I — discoverable
  const results = await searchActiveBusinesses({});
  assert.ok(results.some((b) => b.id === biz.id));

  // J — storefront lookup succeeds
  const storefront = await getBusinessBySlug(biz.slug);
  assert.equal(storefront?.id, biz.id);

  // K — the public transaction write-path gate now passes
  const activeService = await getActiveService(biz.id, service.id);
  assert.equal(activeService?.id, service.id);
});

test("publishing an already-ACTIVE business is an idempotent no-op success", async () => {
  const biz = await makeBusiness("idempotent-publish", { status: "ACTIVE" });
  await prisma.product.create({ data: { businessId: biz.id, name: "Whatever", price: 10 } });
  const result = await publishBusiness(biz.id);
  assert.equal(result.status, "ACTIVE");
});

test("publishBusiness refuses to publish a SUSPENDED business", async () => {
  const biz = await makeBusiness("suspended-publish", { status: "SUSPENDED" });
  await assert.rejects(publishBusiness(biz.id), /suspended business can't be published/);
});

// ---------------------------------------------------------------------------
// TEST L — SUSPENDED behavior
// ---------------------------------------------------------------------------

test("SUSPENDED business disappears from discover, storefront, and order/booking writes", async () => {
  const biz = await makeBusiness("suspended-visibility", { status: "SUSPENDED" });
  const product = await prisma.product.create({ data: { businessId: biz.id, name: "Ghost Product", price: 30 } });

  const results = await searchActiveBusinesses({});
  assert.ok(!results.some((b) => b.id === biz.id));
  assert.equal(await getBusinessBySlug(biz.slug), null);
  assert.equal(await getActiveProduct(biz.id, product.id), null);
});

// ---------------------------------------------------------------------------
// Centralized policy helpers
// ---------------------------------------------------------------------------

test("status policy helpers agree: only ACTIVE is public/transactable", () => {
  for (const status of ["PENDING_VERIFICATION", "SUSPENDED", "DEACTIVATED"] as const) {
    assert.equal(canBusinessBePublic(status), false);
    assert.equal(canBusinessAcceptOrders(status), false);
    assert.equal(canBusinessAcceptBookings(status), false);
  }
  assert.equal(canBusinessBePublic("ACTIVE"), true);
  assert.equal(canBusinessAcceptOrders("ACTIVE"), true);
  assert.equal(canBusinessAcceptBookings("ACTIVE"), true);
});
