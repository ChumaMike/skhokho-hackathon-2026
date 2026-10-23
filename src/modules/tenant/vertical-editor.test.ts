import test from "node:test";
import assert from "node:assert/strict";
import { getProductEditorProfile, getServiceEditorProfile } from "./vertical-editor";
import { getBusinessExperience, resolveCatalogLabel } from "./business-experience";
import { getAdminConsoleGroups } from "@/modules/dashboard/admin-modules";
import { getStorefrontManageSections } from "./storefront-console";
import { ALL_PERMISSIONS } from "@/types";

// ---------------------------------------------------------------------------
// FOOD
// ---------------------------------------------------------------------------

test("FOOD: product editor resolves Menu/Menu item terminology throughout", () => {
  const experience = getBusinessExperience("FOOD_VENDOR");
  const editor = getProductEditorProfile(experience, true);
  assert.equal(editor.itemNoun, "Menu item");
  assert.equal(editor.addLabel, "Add menu item");
  assert.equal(editor.basic.nameLabel, "Menu item name");
  assert.equal(editor.availability.onLabel, "Available for ordering");
});

test("FOOD: without ORDERS capability, availability copy never overpromises ordering", () => {
  const experience = getBusinessExperience("FOOD_VENDOR");
  const editor = getProductEditorProfile(experience, false);
  assert.equal(editor.availability.onLabel, "Visible on your storefront");
  assert.ok(!editor.availability.onLabel.toLowerCase().includes("order"));
});

test("FOOD: no inventory/stock field is exposed by the product editor profile (matches the historical trackStock:false-by-default fix)", () => {
  const experience = getBusinessExperience("FOOD_VENDOR");
  const editor = getProductEditorProfile(experience, true);
  // Structural guarantee, not just a string check — ProductEditorProfile's
  // TypeScript shape has no sku/trackStock/inventory field at all.
  assert.deepEqual(Object.keys(editor).sort(), ["addLabel", "availability", "basic", "itemNoun", "media", "pricing"].sort());
});

// ---------------------------------------------------------------------------
// RETAIL
// ---------------------------------------------------------------------------

test("RETAIL: product editor resolves Products/Product terminology", () => {
  const experience = getBusinessExperience("RETAIL_STORE");
  const editor = getProductEditorProfile(experience, true);
  assert.equal(editor.itemNoun, "Product");
  assert.equal(editor.addLabel, "Add product");
  assert.equal(editor.basic.nameLabel, "Product name");
});

test("RETAIL: editor profile exposes no variant/SKU/barcode/inventory controls — none of these are real merchant features yet", () => {
  const experience = getBusinessExperience("RETAIL_STORE");
  const editor = getProductEditorProfile(experience, true);
  const serialised = JSON.stringify(editor).toLowerCase();
  for (const unsupported of ["sku", "barcode", "variant", "inventory", "stock"]) {
    assert.ok(!serialised.includes(unsupported), `editor profile must not mention "${unsupported}"`);
  }
});

// ---------------------------------------------------------------------------
// SERVICE
// ---------------------------------------------------------------------------

test("SERVICE: editor stays a fully separate profile from Product — never leaks Product terminology", () => {
  const experience = getBusinessExperience("SALON");
  const service = getServiceEditorProfile(experience, true);
  assert.equal(service.itemNoun, "Service");
  assert.equal(service.addLabel, "Add service");
  assert.equal(service.basic.nameLabel, "Service name");
  const serialised = JSON.stringify(service).toLowerCase();
  assert.ok(!serialised.includes("product"));
});

test("SERVICE: duration and booking-capacity fields are retained in the booking section", () => {
  const experience = getBusinessExperience("SALON");
  const service = getServiceEditorProfile(experience, true);
  assert.equal(service.booking.durationLabel, "Duration (minutes)");
  assert.equal(service.booking.maxBookingsLabel, "Bookings allowed at once");
});

test("SERVICE: without BOOKINGS capability (e.g. LAUNDRY), availability copy never overpromises booking", () => {
  const experience = getBusinessExperience("LAUNDRY");
  const service = getServiceEditorProfile(experience, false);
  assert.equal(service.availability.onLabel, "Visible on your storefront");
  assert.ok(!service.availability.onLabel.toLowerCase().includes("book"));
});

// ---------------------------------------------------------------------------
// MIXED
// ---------------------------------------------------------------------------

test("MIXED (Mechanic): Parts and Services editors coexist with zero field/model crossover", () => {
  const experience = getBusinessExperience("MECHANIC");
  const product = getProductEditorProfile(experience, true);
  const service = getServiceEditorProfile(experience, true);
  assert.equal(product.itemNoun, "Part");
  assert.equal(service.itemNoun, "Service");
  assert.ok(!("booking" in product), "the Product editor must never gain Service-only fields");
  assert.ok(!("pricing" in service) || service.pricing.heading === "Pricing", "Pricing exists independently in each, not shared state");
  assert.notEqual(product.addLabel, service.addLabel);
});

// ---------------------------------------------------------------------------
// CONSISTENCY (§20) — nav / Storefront Manage card / catalog page / editor
// must all resolve the same terminology from the same BusinessExperience.
// ---------------------------------------------------------------------------

test("CONSISTENCY: a Food business's sidebar catalogue label, Storefront Manage card, and editor Add label all agree", () => {
  const experience = getBusinessExperience("FOOD_VENDOR");
  const capabilities = new Set(["PRODUCTS", "ORDERS"] as const);

  const navGroups = getAdminConsoleGroups({
    isOwner: true,
    permissions: ALL_PERMISSIONS,
    capabilities,
    experience,
    hasProducts: true,
    hasServices: false,
  });
  const navLabel = navGroups.flatMap((g) => g.modules).find((m) => m.key === "catalog")!.label;

  const manageSections = getStorefrontManageSections({
    capabilities,
    experience,
    designSummary: "x",
    primaryActionLabel: null,
    hasStorefrontContent: false,
  });
  const manageLabel = manageSections.find((s) => s.id === "catalogue")!.label;

  const pageHeading = resolveCatalogLabel(experience, true, false);
  const addLabel = getProductEditorProfile(experience, true).addLabel;

  assert.equal(navLabel, "Menu");
  assert.equal(manageLabel, "Menu");
  assert.equal(pageHeading, "Menu");
  assert.equal(addLabel, "Add menu item");
  assert.ok(!addLabel.toLowerCase().includes("product"), "a Food business must never see 'Add product' under a Menu heading");
});

test("CONSISTENCY: the same check holds for Retail (Products) and Salon (Services)", () => {
  const retail = getBusinessExperience("RETAIL_STORE");
  const retailNav = getAdminConsoleGroups({
    isOwner: true,
    permissions: ALL_PERMISSIONS,
    capabilities: new Set(["PRODUCTS", "ORDERS"]),
    experience: retail,
    hasProducts: true,
    hasServices: false,
  });
  assert.equal(retailNav.flatMap((g) => g.modules).find((m) => m.key === "catalog")!.label, "Products");
  assert.equal(getProductEditorProfile(retail, true).addLabel, "Add product");

  const salon = getBusinessExperience("SALON");
  const salonCapabilities = new Set(["SERVICES", "BOOKINGS"] as const);
  const salonNav = getAdminConsoleGroups({
    isOwner: true,
    permissions: ALL_PERMISSIONS,
    capabilities: salonCapabilities,
    experience: salon,
    hasProducts: false,
    hasServices: true,
  });
  assert.equal(salonNav.flatMap((g) => g.modules).find((m) => m.key === "catalog")!.label, "Services");
  assert.equal(getServiceEditorProfile(salon, true).addLabel, "Add service");
});
