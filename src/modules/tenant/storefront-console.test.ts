import test from "node:test";
import assert from "node:assert/strict";
import { getStorefrontManageSections } from "./storefront-console";
import { getBusinessExperience } from "./business-experience";
import type { BusinessCapability } from "./capabilities";

function ids(sections: ReturnType<typeof getStorefrontManageSections>) {
  return sections.map((s) => s.id);
}

function base(capabilities: BusinessCapability[], experienceCategory: Parameters<typeof getBusinessExperience>[0] = "OTHER") {
  return {
    capabilities: new Set(capabilities),
    experience: getBusinessExperience(experienceCategory),
    designSummary: "WARM · colour hero",
    primaryActionLabel: "ORDER",
    hasStorefrontContent: false,
  };
}

test("Design, Storefront words, Business information and Customer actions are always present", () => {
  const sections = getStorefrontManageSections(base([]));
  const sectionIds = ids(sections);
  assert.ok(sectionIds.includes("design"));
  assert.ok(sectionIds.includes("content"));
  assert.ok(sectionIds.includes("business-information"));
  assert.ok(sectionIds.includes("customer-actions"));
});

test("the content card deep-links to the wizard's content step, and its summary reflects whether anything has actually been written", () => {
  const unwritten = getStorefrontManageSections(base([]));
  const contentCard = unwritten.find((s) => s.id === "content")!;
  assert.equal(contentCard.href, "/dashboard/storefront/design?focus=content");
  assert.equal(contentCard.sub, "Not written yet");

  const written = getStorefrontManageSections({ ...base([]), hasStorefrontContent: true });
  assert.notEqual(written.find((s) => s.id === "content")!.sub, "Not written yet");
});

test("FOOD (PRODUCTS + ORDERS): catalogue says Menu, Ordering visible", () => {
  const sections = getStorefrontManageSections(base(["PRODUCTS", "ORDERS"], "FOOD_VENDOR"));
  const catalogue = sections.find((s) => s.id === "catalogue")!;
  assert.equal(catalogue.label, "Menu");
  assert.ok(ids(sections).includes("ordering"));
});

test("FOOD without DELIVERY: Ordering card says Collection only; with DELIVERY: Collection and delivery", () => {
  const withoutDelivery = getStorefrontManageSections(base(["PRODUCTS", "ORDERS"], "FOOD_VENDOR"));
  assert.equal(withoutDelivery.find((s) => s.id === "ordering")!.sub, "Collection only");

  const withDelivery = getStorefrontManageSections(base(["PRODUCTS", "ORDERS", "DELIVERY"], "FOOD_VENDOR"));
  assert.equal(withDelivery.find((s) => s.id === "ordering")!.sub, "Collection and delivery");
});

test("a business without ORDERS gets no Ordering card at all, regardless of DELIVERY", () => {
  const sections = getStorefrontManageSections(base(["SERVICES", "BOOKINGS", "DELIVERY"], "SALON"));
  assert.ok(!ids(sections).includes("ordering"));
});

test("SALON (SERVICES + BOOKINGS): catalogue says Services, no Ordering card, no Menu/Product wording anywhere", () => {
  const sections = getStorefrontManageSections(base(["SERVICES", "BOOKINGS"], "SALON"));
  const catalogue = sections.find((s) => s.id === "catalogue")!;
  assert.equal(catalogue.label, "Services");
  assert.ok(!ids(sections).includes("ordering"));
  for (const s of sections) {
    assert.ok(!s.label.toLowerCase().includes("menu"));
    assert.ok(!s.label.toLowerCase().includes("product"));
  }
});

test("RETAIL (PRODUCTS + ORDERS): Products wording, Ordering visible, no fake Inventory card", () => {
  const sections = getStorefrontManageSections(base(["PRODUCTS", "ORDERS", "INVENTORY"], "RETAIL_STORE"));
  assert.equal(sections.find((s) => s.id === "catalogue")!.label, "Products");
  assert.ok(ids(sections).includes("ordering"));
  assert.ok(!(ids(sections) as string[]).includes("inventory"));
});

test("MIXED (PRODUCTS + SERVICES, Mechanic): one combined catalogue card with both terminologies, neither domain hidden", () => {
  const sections = getStorefrontManageSections(base(["PRODUCTS", "SERVICES", "ORDERS", "BOOKINGS"], "MECHANIC"));
  const catalogueCards = sections.filter((s) => s.id === "catalogue");
  assert.equal(catalogueCards.length, 1, "never two separate catalogue cards");
  assert.equal(catalogueCards[0].label, "Parts & Services");
});

test("a business with neither PRODUCTS nor SERVICES gets no catalogue card", () => {
  const sections = getStorefrontManageSections(base(["ORDERS"]));
  assert.ok(!ids(sections).includes("catalogue"));
});

test("Customer actions sub-label reflects the real primary action, including 'not set'", () => {
  const withAction = getStorefrontManageSections({ ...base([]), primaryActionLabel: "BOOK" });
  assert.ok(withAction.find((s) => s.id === "customer-actions")!.sub.includes("BOOK"));

  const withoutAction = getStorefrontManageSections({ ...base([]), primaryActionLabel: null });
  assert.ok(withoutAction.find((s) => s.id === "customer-actions")!.sub.includes("not set"));
});

test("no duplicate section ids are ever produced", () => {
  const sections = getStorefrontManageSections(base(["PRODUCTS", "SERVICES", "ORDERS", "BOOKINGS", "DELIVERY"], "MECHANIC"));
  const sectionIds = ids(sections);
  assert.equal(sectionIds.length, new Set(sectionIds).size);
});
