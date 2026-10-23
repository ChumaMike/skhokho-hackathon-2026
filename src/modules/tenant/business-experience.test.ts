import test from "node:test";
import assert from "node:assert/strict";
import { getBusinessExperience, resolveCatalogLabel } from "./business-experience";
import type { BusinessCategory } from "@prisma/client";

const ALL_CATEGORIES: BusinessCategory[] = [
  "SALON", "FOOD_VENDOR", "CAR_WASH", "RETAIL_STORE", "TUCK_SHOP",
  "MECHANIC", "HAIR_BRAIDER", "NAIL_TECHNICIAN", "EVENTS", "CHILDCARE",
  "LAUNDRY", "OTHER",
];

test("every real BusinessCategory enum value has a registry entry with non-empty labels", () => {
  for (const category of ALL_CATEGORIES) {
    const exp = getBusinessExperience(category);
    assert.ok(exp.catalogLabel.length > 0, `${category} catalogLabel`);
    assert.ok(exp.itemSingular.length > 0, `${category} itemSingular`);
    assert.ok(exp.itemPlural.length > 0, `${category} itemPlural`);
    assert.ok(exp.addItemLabel.length > 0, `${category} addItemLabel`);
    assert.ok(exp.serviceCatalogLabel.length > 0, `${category} serviceCatalogLabel`);
    assert.ok(exp.addServiceLabel.length > 0, `${category} addServiceLabel`);
  }
});

test("FOOD_VENDOR gets Menu terminology", () => {
  const exp = getBusinessExperience("FOOD_VENDOR");
  assert.equal(exp.catalogLabel, "Menu");
  assert.equal(exp.itemSingular, "Menu item");
  assert.equal(exp.itemPlural, "Menu items");
  assert.equal(exp.addItemLabel, "Add menu item");
});

test("RETAIL_STORE gets Products terminology", () => {
  const exp = getBusinessExperience("RETAIL_STORE");
  assert.equal(exp.catalogLabel, "Products");
  assert.equal(exp.itemSingular, "Product");
  assert.equal(exp.addItemLabel, "Add product");
});

test("SALON gets the general Products fallback for its (unused, no PRODUCTS capability) product wording, and universal Services wording", () => {
  const exp = getBusinessExperience("SALON");
  assert.equal(exp.serviceCatalogLabel, "Services");
  assert.equal(exp.addServiceLabel, "Add service");
});

test("OTHER (the GENERAL fallback) matches an unclassified legacy business's safe, generic wording", () => {
  const exp = getBusinessExperience("OTHER");
  assert.equal(exp.catalogLabel, "Products");
  assert.equal(exp.addItemLabel, "Add product");
});

test("resolveCatalogLabel: PRODUCTS only -> the category's product label", () => {
  const exp = getBusinessExperience("FOOD_VENDOR");
  assert.equal(resolveCatalogLabel(exp, true, false), "Menu");
});

test("resolveCatalogLabel: SERVICES only -> the service label, even for a category with distinct product wording", () => {
  const exp = getBusinessExperience("MECHANIC");
  assert.equal(resolveCatalogLabel(exp, false, true), "Services");
});

test("resolveCatalogLabel: both -> a combined label, never silently picking just one", () => {
  const exp = getBusinessExperience("MECHANIC");
  assert.equal(resolveCatalogLabel(exp, true, true), "Parts & Services");
});

// ---------------------------------------------------------------------------
// Food Menu Domain Foundation (Phase 4) §20/§21 — Menu categories/option
// groups are a Food-only experience, gated here (not a new capability).
// ---------------------------------------------------------------------------

test("supportsMenuOptions is true ONLY for FOOD_VENDOR — every other category (including Retail, Salon, Mechanic, and the OTHER/GENERAL fallback) must never surface Menu categories or option groups", () => {
  assert.equal(getBusinessExperience("FOOD_VENDOR").supportsMenuOptions, true);
  for (const category of ALL_CATEGORIES) {
    if (category === "FOOD_VENDOR") continue;
    assert.equal(
      getBusinessExperience(category).supportsMenuOptions,
      false,
      `${category} must not support Menu options`,
    );
  }
});
