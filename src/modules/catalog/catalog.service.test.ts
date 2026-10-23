import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { hashPassword } from "@/modules/auth/auth.service";
import {
  createProduct,
  createService,
  updateProduct,
  updateService,
  deleteProduct,
  deleteService,
  setProductActive,
  setServiceActive,
  getActiveProduct,
  getActiveService,
} from "./catalog.service";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function makeBusiness(label: string) {
  const { business } = await createBusiness({
    name: `Catalog Service Test ${label}`,
    category: "FOOD_VENDOR" as never,
    owner: {
      firstName: "Owner",
      lastName: label,
      email: `catalog-owner-${label}-${suffix}@example.test`,
      passwordHash: await hashPassword("SomePassword123"),
    },
  });
  return business;
}

test.after(async () => {
  const businesses = await prisma.business.findMany({
    where: { name: { startsWith: "Catalog Service Test " } },
    select: { id: true },
  });
  for (const { id } of businesses) {
    await prisma.businessStaff.deleteMany({ where: { businessId: id } });
    await prisma.businessRole.deleteMany({ where: { businessId: id } });
    await prisma.businessSubscription.deleteMany({ where: { businessId: id } });
    await prisma.business.delete({ where: { id } });
  }
});

// ---------------------------------------------------------------------------
// Creation defaults (§15) — the historical trackStock:true bug must stay fixed
// ---------------------------------------------------------------------------

test("createProduct always creates with trackStock:false — no inventory setup exists to make trackStock:true honest yet", async () => {
  const business = await makeBusiness("defaults");
  const product = await createProduct(business.id, { name: "Kota", price: 45 });
  assert.equal(product.trackStock, false);
});

test("createProduct defaults isActive:true and createService defaults isActive:true — a new item is visible immediately, matching the editor's own 'visible as soon as you add it' copy", async () => {
  const business = await makeBusiness("defaults-active");
  const product = await createProduct(business.id, { name: "Kota", price: 45 });
  const service = await createService(business.id, { name: "Haircut", price: 150 });
  assert.equal(product.isActive, true);
  assert.equal(service.isActive, true);
});

// ---------------------------------------------------------------------------
// Tenancy (§22) — cannot edit/delete/toggle another business's Product/Service
// ---------------------------------------------------------------------------

test("updateProduct rejects a productId that belongs to a different business", async () => {
  const businessA = await makeBusiness("tenancy-update-a");
  const businessB = await makeBusiness("tenancy-update-b");
  const product = await createProduct(businessA.id, { name: "A's Kota", price: 45 });

  await assert.rejects(() => updateProduct(businessB.id, product.id, { name: "Hijacked" }), /not found/i);

  const unchanged = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(unchanged.name, "A's Kota", "business B's failed update must not have touched business A's product");
});

test("updateService rejects a serviceId that belongs to a different business", async () => {
  const businessA = await makeBusiness("tenancy-update-service-a");
  const businessB = await makeBusiness("tenancy-update-service-b");
  const service = await createService(businessA.id, { name: "A's Haircut", price: 150 });

  await assert.rejects(() => updateService(businessB.id, service.id, { name: "Hijacked" }), /not found/i);
});

test("deleteProduct/deleteService reject an id belonging to a different business — the row survives", async () => {
  const businessA = await makeBusiness("tenancy-delete-a");
  const businessB = await makeBusiness("tenancy-delete-b");
  const product = await createProduct(businessA.id, { name: "A's Kota", price: 45 });
  const service = await createService(businessA.id, { name: "A's Haircut", price: 150 });

  await assert.rejects(() => deleteProduct(businessB.id, product.id), /not found/i);
  await assert.rejects(() => deleteService(businessB.id, service.id), /not found/i);

  assert.ok(await prisma.product.findUnique({ where: { id: product.id } }), "product must survive the cross-tenant delete attempt");
  assert.ok(await prisma.service.findUnique({ where: { id: service.id } }), "service must survive the cross-tenant delete attempt");
});

test("setProductActive/setServiceActive reject cross-business ids — a competitor cannot hide another business's items", async () => {
  const businessA = await makeBusiness("tenancy-toggle-a");
  const businessB = await makeBusiness("tenancy-toggle-b");
  const product = await createProduct(businessA.id, { name: "A's Kota", price: 45 });
  const service = await createService(businessA.id, { name: "A's Haircut", price: 150 });

  await assert.rejects(() => setProductActive(businessB.id, product.id, false), /not found/i);
  await assert.rejects(() => setServiceActive(businessB.id, service.id, false), /not found/i);

  const stillActive = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(stillActive.isActive, true);
});

test("getActiveProduct/getActiveService (the storefront's own tenant-scoped read) never resolve a product/service from another business", async () => {
  const businessA = await makeBusiness("tenancy-read-a");
  const businessB = await makeBusiness("tenancy-read-b");
  await prisma.business.update({ where: { id: businessA.id }, data: { status: "ACTIVE" } });
  await prisma.business.update({ where: { id: businessB.id }, data: { status: "ACTIVE" } });
  const product = await createProduct(businessA.id, { name: "A's Kota", price: 45 });
  const service = await createService(businessA.id, { name: "A's Haircut", price: 150 });

  assert.equal(await getActiveProduct(businessB.id, product.id), null);
  assert.equal(await getActiveService(businessB.id, service.id), null);
  assert.ok(await getActiveProduct(businessA.id, product.id));
  assert.ok(await getActiveService(businessA.id, service.id));
});

// ---------------------------------------------------------------------------
// Destructive/history semantics (§17) — hard delete, but historical order
// snapshots must survive (OrderItem.productId is onDelete: SetNull).
// ---------------------------------------------------------------------------

test("deleteProduct hard-deletes the row (no soft-delete/archive state exists today)", async () => {
  const business = await makeBusiness("hard-delete");
  const product = await createProduct(business.id, { name: "Kota", price: 45 });
  await deleteProduct(business.id, product.id);
  assert.equal(await prisma.product.findUnique({ where: { id: product.id } }), null);
});
