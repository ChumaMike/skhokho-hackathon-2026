import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { hashPassword } from "@/modules/auth/auth.service";
import { createProduct, getActiveCatalog, updateProduct } from "./catalog.service";
import { createCategory, listCategoriesForOwner, moveCategory, setCategoryActive } from "./menu-options.service";
import { getBusinessExperience } from "@/modules/tenant/business-experience";

/**
 * Categories are for ANY business that sells products, not only Food. The
 * pilot merchant (a retail shop) could create categories but not assign an
 * item to one, because the catalogue page only fetched categories for the
 * Food experience. This proves the service path end to end for a non-Food
 * business so the page can rely on it.
 */

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

test.after(async () => {
  const businesses = await prisma.business.findMany({ where: { name: { startsWith: "Categories Any Business " } }, select: { id: true } });
  for (const { id } of businesses) {
    await prisma.businessStaff.deleteMany({ where: { businessId: id } });
    await prisma.businessRole.deleteMany({ where: { businessId: id } });
    await prisma.businessSubscription.deleteMany({ where: { businessId: id } });
    await prisma.business.delete({ where: { id } });
  }
});

test("a retail shop can group its items and the storefront shows the groups in the owner's order", async () => {
  const { business } = await createBusiness({
    name: `Categories Any Business ${suffix}`,
    category: "RETAIL_STORE" as never,
    owner: { firstName: "Owner", lastName: "Retail", email: `categories-any-${suffix}@example.test`, passwordHash: await hashPassword("SomePassword123") },
  });
  assert.equal(getBusinessExperience(business.category).supportsMenuOptions, false, "retail is not the Food experience");

  const drinks = await createCategory(business.id, { name: "Drinks" });
  const snacks = await createCategory(business.id, { name: "Snacks" });
  const soap = await createProduct(business.id, { name: "Soap", price: 12, categoryId: snacks.id } as never);
  const cola = await createProduct(business.id, { name: "Cola", price: 15 } as never);
  await updateProduct(business.id, cola.id, { categoryId: drinks.id } as never);

  // Reorder and hide, as the Categories page does.
  await moveCategory(business.id, snacks.id, "UP");
  const ordered = await listCategoriesForOwner(business.id);
  assert.deepEqual(ordered.map((c) => c.name), ["Snacks", "Drinks"]);

  const catalog = await getActiveCatalog(business.id);
  const byName = Object.fromEntries(catalog.products.map((p) => [p.name, p.categoryName]));
  assert.equal(byName.Soap, "Snacks");
  assert.equal(byName.Cola, "Drinks");

  await setCategoryActive(business.id, drinks.id, false);
  const hidden = await listCategoriesForOwner(business.id);
  assert.equal(hidden.find((c) => c.id === drinks.id)?.isActive, false, "hidden, not deleted");
  assert.ok(await prisma.product.findFirst({ where: { id: cola.id, categoryId: drinks.id } }), "the item keeps its category while hidden");
  void soap;
});
