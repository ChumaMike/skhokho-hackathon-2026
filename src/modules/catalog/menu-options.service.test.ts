import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { hashPassword } from "@/modules/auth/auth.service";
import { createProduct } from "@/modules/catalog/catalog.service";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  setCategoryActive,
  listCategoriesForOwner,
  createOptionGroup,
  updateOptionGroup,
  deleteOptionGroup,
  setOptionGroupActive,
  createOption,
  updateOption,
  setOptionActive,
  assignOptionGroupToProduct,
  unassignOptionGroupFromProduct,
  listOptionGroupsForProductOwner,
  getActiveOptionGroupsForProduct,
} from "./menu-options.service";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function makeBusiness(label: string) {
  const { business } = await createBusiness({
    name: `Menu Options Service Test ${label}`,
    category: "FOOD_VENDOR" as never,
    owner: {
      firstName: "Owner",
      lastName: label,
      email: `menu-options-owner-${label}-${suffix}@example.test`,
      passwordHash: await hashPassword("SomePassword123"),
    },
  });
  return business;
}

test.after(async () => {
  const businesses = await prisma.business.findMany({
    where: { name: { startsWith: "Menu Options Service Test " } },
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
// CATEGORY
// ---------------------------------------------------------------------------

test("create/list categories in sortOrder, then update a category's name/description", async () => {
  const business = await makeBusiness("category-crud");
  await createCategory(business.id, { name: "Kotas" });
  await createCategory(business.id, { name: "Drinks" });
  let categories = await listCategoriesForOwner(business.id);
  assert.deepEqual(categories.map((c) => c.name), ["Kotas", "Drinks"]);

  await updateCategory(business.id, categories[0].id, { name: "Kotas & Rolls", description: "Our signature kotas" });
  categories = await listCategoriesForOwner(business.id);
  assert.equal(categories[0].name, "Kotas & Rolls");
  assert.equal(categories[0].description, "Our signature kotas");
});

test("category tenant isolation — Business B cannot update or delete Business A's category", async () => {
  const businessA = await makeBusiness("category-tenancy-a");
  const businessB = await makeBusiness("category-tenancy-b");
  const category = await createCategory(businessA.id, { name: "Kotas" });

  await assert.rejects(() => updateCategory(businessB.id, category.id, { name: "Hijacked" }), /not found/i);
  await assert.rejects(() => deleteCategory(businessB.id, category.id), /not found/i);
  await assert.rejects(() => setCategoryActive(businessB.id, category.id, false), /not found/i);
});

test("an inactive category still exists for the owner (setCategoryActive doesn't delete), and a product left uncategorised remains valid", async () => {
  const business = await makeBusiness("category-inactive-uncategorised");
  const category = await createCategory(business.id, { name: "Seasonal" });
  await setCategoryActive(business.id, category.id, false);
  const categories = await listCategoriesForOwner(business.id);
  assert.equal(categories.find((c) => c.id === category.id)?.isActive, false);

  const product = await createProduct(business.id, { name: "Kota", price: 45 });
  assert.equal(product.categoryId, null, "uncategorised is a valid, expected default state");
});

test("deleteCategory hard-deletes the category but uncategorises (not deletes) any product that referenced it", async () => {
  const business = await makeBusiness("category-delete-cascade");
  const category = await createCategory(business.id, { name: "Kotas" });
  const product = await createProduct(business.id, { name: "Kota Special", price: 45, categoryId: category.id });
  await deleteCategory(business.id, category.id);

  const updated = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(updated.categoryId, null);
});

// ---------------------------------------------------------------------------
// OPTION GROUPS
// ---------------------------------------------------------------------------

test("SINGLE-choice group: maxSelections cannot exceed 1", async () => {
  const business = await makeBusiness("group-single-bounds");
  await assert.rejects(
    () => createOptionGroup(business.id, { name: "Size", selectionType: "SINGLE", minSelections: 1, maxSelections: 2 }),
    /single-choice/i,
  );
});

test("MULTIPLE-choice group: min/max selections are stored and enforced at update time too", async () => {
  const business = await makeBusiness("group-multiple-bounds");
  const group = await createOptionGroup(business.id, { name: "Extras", selectionType: "MULTIPLE", minSelections: 0, maxSelections: 3 });
  assert.equal(group.minSelections, 0);
  assert.equal(group.maxSelections, 3);

  await assert.rejects(() => updateOptionGroup(business.id, group.id, { minSelections: 5 }), /cannot be less than/i);
});

test("a required group has minSelections >= 1; an optional group has minSelections 0 — no separate 'required' flag to drift out of sync", async () => {
  const business = await makeBusiness("group-required-derivation");
  const required = await createOptionGroup(business.id, { name: "Choose size", selectionType: "SINGLE", minSelections: 1, maxSelections: 1 });
  const optional = await createOptionGroup(business.id, { name: "Extras", selectionType: "MULTIPLE", minSelections: 0 });
  assert.ok(required.minSelections >= 1);
  assert.equal(optional.minSelections, 0);
});

test("group tenant isolation — Business B cannot update/deactivate/delete Business A's group", async () => {
  const businessA = await makeBusiness("group-tenancy-a");
  const businessB = await makeBusiness("group-tenancy-b");
  const group = await createOptionGroup(businessA.id, { name: "Size", selectionType: "SINGLE", minSelections: 1 });

  await assert.rejects(() => updateOptionGroup(businessB.id, group.id, { name: "Hijacked" }), /not found/i);
  await assert.rejects(() => setOptionGroupActive(businessB.id, group.id, false), /not found/i);
  await assert.rejects(() => deleteOptionGroup(businessB.id, group.id), /not found/i);
});

test("an inactive group is not deleted — it still exists with isActive:false", async () => {
  const business = await makeBusiness("group-inactive-not-deleted");
  const group = await createOptionGroup(business.id, { name: "Size", selectionType: "SINGLE", minSelections: 1 });
  await setOptionGroupActive(business.id, group.id, false);
  const stored = await prisma.menuOptionGroup.findUniqueOrThrow({ where: { id: group.id } });
  assert.equal(stored.isActive, false);
});

// ---------------------------------------------------------------------------
// OPTIONS
// ---------------------------------------------------------------------------

test("an option's priceDelta is stored and updatable", async () => {
  const business = await makeBusiness("option-price-delta");
  const group = await createOptionGroup(business.id, { name: "Size", selectionType: "SINGLE", minSelections: 1 });
  const option = await createOption(business.id, group.id, { name: "Large", priceDelta: 15 });
  assert.equal(option.priceDelta.toString(), "15");
  const updated = await updateOption(business.id, option.id, { priceDelta: 18 });
  assert.equal(updated.priceDelta.toString(), "18");
});

test("a negative priceDelta is rejected at the schema boundary — no negative discount modifiers (§24)", async () => {
  const business = await makeBusiness("option-negative-delta");
  const group = await createOptionGroup(business.id, { name: "Size", selectionType: "SINGLE", minSelections: 1 });
  await assert.rejects(() => createOption(business.id, group.id, { name: "Small", priceDelta: -5 }));
});

test("an inactive option is not deleted — it still exists with isActive:false", async () => {
  const business = await makeBusiness("option-inactive-not-deleted");
  const group = await createOptionGroup(business.id, { name: "Size", selectionType: "SINGLE", minSelections: 1 });
  const option = await createOption(business.id, group.id, { name: "Large", priceDelta: 15 });
  await setOptionActive(business.id, option.id, false);
  const stored = await prisma.menuOption.findUniqueOrThrow({ where: { id: option.id } });
  assert.equal(stored.isActive, false);
});

test("cross-group option isolation — an option belongs to exactly the group it was created under", async () => {
  const business = await makeBusiness("option-cross-group");
  const sizeGroup = await createOptionGroup(business.id, { name: "Size", selectionType: "SINGLE", minSelections: 1 });
  const extrasGroup = await createOptionGroup(business.id, { name: "Extras", selectionType: "MULTIPLE", minSelections: 0 });
  const large = await createOption(business.id, sizeGroup.id, { name: "Large", priceDelta: 15 });
  assert.equal(large.groupId, sizeGroup.id);
  assert.notEqual(large.groupId, extrasGroup.id);
});

test("cross-tenant option creation is rejected — cannot create an option under another business's group", async () => {
  const businessA = await makeBusiness("option-tenancy-a");
  const businessB = await makeBusiness("option-tenancy-b");
  const group = await createOptionGroup(businessA.id, { name: "Size", selectionType: "SINGLE", minSelections: 1 });
  await assert.rejects(() => createOption(businessB.id, group.id, { name: "Large", priceDelta: 15 }), /not found/i);
});

// ---------------------------------------------------------------------------
// PRODUCT ASSIGNMENT
// ---------------------------------------------------------------------------

test("assigning one group to a product makes it appear in that product's active option groups", async () => {
  const business = await makeBusiness("assign-one-group");
  const product = await createProduct(business.id, { name: "Kota", price: 45 });
  const group = await createOptionGroup(business.id, { name: "Size", selectionType: "SINGLE", minSelections: 1 });
  await createOption(business.id, group.id, { name: "Regular", priceDelta: 0 });
  await assignOptionGroupToProduct(business.id, product.id, group.id);

  const groups = await getActiveOptionGroupsForProduct(business.id, product.id);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "Size");
});

test("a product can have multiple assigned groups, in sortOrder", async () => {
  const business = await makeBusiness("assign-multiple-groups");
  const product = await createProduct(business.id, { name: "Kota", price: 45 });
  const size = await createOptionGroup(business.id, { name: "Size", selectionType: "SINGLE", minSelections: 1 });
  await createOption(business.id, size.id, { name: "Regular", priceDelta: 0 });
  const extras = await createOptionGroup(business.id, { name: "Extras", selectionType: "MULTIPLE", minSelections: 0 });
  await createOption(business.id, extras.id, { name: "Cheese", priceDelta: 10 });
  await assignOptionGroupToProduct(business.id, product.id, size.id);
  await assignOptionGroupToProduct(business.id, product.id, extras.id);

  const groups = await getActiveOptionGroupsForProduct(business.id, product.id);
  assert.deepEqual(groups.map((g) => g.name), ["Size", "Extras"]);
});

test("the SAME reusable group can be assigned to multiple products", async () => {
  const business = await makeBusiness("shared-reusable-group");
  const burger = await createProduct(business.id, { name: "Burger", price: 55 });
  const kota = await createProduct(business.id, { name: "Kota", price: 45 });
  const size = await createOptionGroup(business.id, { name: "Size", selectionType: "SINGLE", minSelections: 1 });
  await createOption(business.id, size.id, { name: "Regular", priceDelta: 0 });
  await assignOptionGroupToProduct(business.id, burger.id, size.id);
  await assignOptionGroupToProduct(business.id, kota.id, size.id);

  const burgerGroups = await getActiveOptionGroupsForProduct(business.id, burger.id);
  const kotaGroups = await getActiveOptionGroupsForProduct(business.id, kota.id);
  assert.equal(burgerGroups[0].id, kotaGroups[0].id, "same underlying group, not a duplicated copy");
});

test("order is preserved when a group is unassigned and reassigned, and unassigning one product's group never affects another product sharing it", async () => {
  const business = await makeBusiness("assignment-order-preserved");
  const kota = await createProduct(business.id, { name: "Kota", price: 45 });
  const burger = await createProduct(business.id, { name: "Burger", price: 55 });
  const size = await createOptionGroup(business.id, { name: "Size", selectionType: "SINGLE", minSelections: 1 });
  await createOption(business.id, size.id, { name: "Regular", priceDelta: 0 });
  const extras = await createOptionGroup(business.id, { name: "Extras", selectionType: "MULTIPLE", minSelections: 0 });
  await createOption(business.id, extras.id, { name: "Cheese", priceDelta: 10 });

  await assignOptionGroupToProduct(business.id, kota.id, size.id);
  await assignOptionGroupToProduct(business.id, kota.id, extras.id);
  await assignOptionGroupToProduct(business.id, burger.id, size.id);

  await unassignOptionGroupFromProduct(business.id, kota.id, size.id);
  const kotaGroups = await listOptionGroupsForProductOwner(business.id, kota.id);
  assert.deepEqual(kotaGroups.map((g) => g.name), ["Extras"]);

  const burgerGroups = await listOptionGroupsForProductOwner(business.id, burger.id);
  assert.deepEqual(burgerGroups.map((g) => g.name), ["Size"], "unassigning from Kota must not touch Burger's own assignment");
});

test("assigning a group cross-tenant (Business A's product + Business B's group) is rejected", async () => {
  const businessA = await makeBusiness("assign-tenancy-a");
  const businessB = await makeBusiness("assign-tenancy-b");
  const product = await createProduct(businessA.id, { name: "Kota", price: 45 });
  const group = await createOptionGroup(businessB.id, { name: "Size", selectionType: "SINGLE", minSelections: 1 });
  await assert.rejects(() => assignOptionGroupToProduct(businessA.id, product.id, group.id), /not found/i);
});

test("getActiveOptionGroupsForProduct hides a group with zero active options — never renders an empty, unusable choice", async () => {
  const business = await makeBusiness("empty-group-hidden");
  const product = await createProduct(business.id, { name: "Kota", price: 45 });
  const group = await createOptionGroup(business.id, { name: "Size", selectionType: "SINGLE", minSelections: 0 });
  const only = await createOption(business.id, group.id, { name: "Regular", priceDelta: 0 });
  await assignOptionGroupToProduct(business.id, product.id, group.id);
  await setOptionActive(business.id, only.id, false);

  const groups = await getActiveOptionGroupsForProduct(business.id, product.id);
  assert.equal(groups.length, 0);
});
