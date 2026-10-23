import test from "node:test";
import assert from "node:assert/strict";
import type { BusinessCategory } from "@prisma/client";
import {
  STOREFRONT_TEMPLATES,
  resolveStorefrontTemplate,
  suggestTemplateForCategory,
  isValidTemplateId,
  isValidActiveTemplateId,
  validateGeneratedPages,
  GENERATED_TEMPLATE_ID,
  type StorefrontTemplateId,
} from "@/modules/tenant/storefront-templates";

const ALL_CATEGORIES: BusinessCategory[] = [
  "SALON",
  "FOOD_VENDOR",
  "CAR_WASH",
  "RETAIL_STORE",
  "TUCK_SHOP",
  "MECHANIC",
  "HAIR_BRAIDER",
  "NAIL_TECHNICIAN",
  "EVENTS",
  "CHILDCARE",
  "LAUNDRY",
  "OTHER",
];

test("resolveStorefrontTemplate defaults to CLASSIC when activeTemplateId is missing", () => {
  const template = resolveStorefrontTemplate({});
  assert.equal(template.id, "CLASSIC");
});

test("resolveStorefrontTemplate defaults to CLASSIC for a stale/unknown id rather than throwing", () => {
  const template = resolveStorefrontTemplate({ activeTemplateId: "SOME_RETIRED_TEMPLATE" });
  assert.equal(template.id, "CLASSIC");
});

test("resolveStorefrontTemplate returns the matching template for a known id", () => {
  const template = resolveStorefrontTemplate({ activeTemplateId: "CLASSIC" });
  assert.equal(template, STOREFRONT_TEMPLATES.CLASSIC);
});

test("CLASSIC exposes only the HOME page, matching today's single-page storefront", () => {
  assert.deepEqual(STOREFRONT_TEMPLATES.CLASSIC.pages, ["HOME"]);
});

test("every non-CLASSIC template includes HOME and at least one other page", () => {
  for (const template of Object.values(STOREFRONT_TEMPLATES)) {
    if (template.id === "CLASSIC") continue;
    assert.ok(template.pages.includes("HOME"), `${template.id} must include HOME`);
    assert.ok(template.pages.length > 1, `${template.id} must include at least one page beyond HOME`);
  }
});

test("every category is claimed by at most one template's categoryFit (no ambiguous suggestion)", () => {
  const claimedBy = new Map<BusinessCategory, string>();
  for (const template of Object.values(STOREFRONT_TEMPLATES)) {
    for (const category of template.categoryFit) {
      const existing = claimedBy.get(category);
      assert.equal(existing, undefined, `${category} claimed by both ${existing} and ${template.id}`);
      claimedBy.set(category, template.id);
    }
  }
});

test("suggestTemplateForCategory returns CLASSIC for OTHER and any category with no matching template", () => {
  assert.equal(suggestTemplateForCategory("OTHER"), "CLASSIC");
});

test("suggestTemplateForCategory matches every known category to a real, resolvable template", () => {
  for (const category of ALL_CATEGORIES) {
    const suggested = suggestTemplateForCategory(category);
    assert.ok(isValidTemplateId(suggested), `${suggested} for ${category} must be a valid template id`);
    assert.ok(STOREFRONT_TEMPLATES[suggested], `${suggested} for ${category} must exist in the registry`);
  }
});

test("suggestTemplateForCategory: category groupings match the plan's 4-way vertical split", () => {
  assert.equal(suggestTemplateForCategory("FOOD_VENDOR"), "FOOD_MENU");
  assert.equal(suggestTemplateForCategory("SALON"), "SALON_BOOKING");
  assert.equal(suggestTemplateForCategory("HAIR_BRAIDER"), "SALON_BOOKING");
  assert.equal(suggestTemplateForCategory("NAIL_TECHNICIAN"), "SALON_BOOKING");
  assert.equal(suggestTemplateForCategory("RETAIL_STORE"), "RETAIL_CATALOGUE");
  assert.equal(suggestTemplateForCategory("TUCK_SHOP"), "RETAIL_CATALOGUE");
  assert.equal(suggestTemplateForCategory("CAR_WASH"), "SERVICES_TRUST");
  assert.equal(suggestTemplateForCategory("MECHANIC"), "SERVICES_TRUST");
  assert.equal(suggestTemplateForCategory("EVENTS"), "SERVICES_TRUST");
  assert.equal(suggestTemplateForCategory("CHILDCARE"), "SERVICES_TRUST");
  assert.equal(suggestTemplateForCategory("LAUNDRY"), "SERVICES_TRUST");
});

test("isValidTemplateId rejects an unknown id", () => {
  assert.equal(isValidTemplateId("SOME_RETIRED_TEMPLATE"), false);
});

test("isValidTemplateId rejects GENERATED — it is not one of the 5 static, pickable templates", () => {
  assert.equal(isValidTemplateId(GENERATED_TEMPLATE_ID), false);
});

test("isValidActiveTemplateId accepts both the 5 static ids and GENERATED", () => {
  assert.equal(isValidActiveTemplateId("CLASSIC"), true);
  assert.equal(isValidActiveTemplateId(GENERATED_TEMPLATE_ID), true);
  assert.equal(isValidActiveTemplateId("SOME_RETIRED_TEMPLATE"), false);
});

test("validateGeneratedPages returns null for missing/malformed input rather than throwing", () => {
  assert.equal(validateGeneratedPages(undefined), null);
  assert.equal(validateGeneratedPages(null), null);
  assert.equal(validateGeneratedPages("not an object"), null);
  assert.equal(validateGeneratedPages({}), null);
  assert.equal(validateGeneratedPages({ pages: "not an array" }), null);
});

test("validateGeneratedPages drops any value outside the known StorefrontPageId enum, never trusting it", () => {
  const pages = validateGeneratedPages({ pages: ["HOME", "GALLERY", "INVENTED_PAGE_TYPE", 42, null] });
  assert.deepEqual(pages, ["HOME", "GALLERY"]);
});

test("validateGeneratedPages always includes HOME even if the source data omitted it", () => {
  const pages = validateGeneratedPages({ pages: ["ABOUT"] });
  assert.deepEqual(pages, ["HOME", "ABOUT"]);
});

test("validateGeneratedPages dedupes repeated page ids", () => {
  const pages = validateGeneratedPages({ pages: ["HOME", "GALLERY", "GALLERY"] });
  assert.deepEqual(pages, ["HOME", "GALLERY"]);
});

test("resolveStorefrontTemplate with activeTemplateId=GENERATED and a valid generatedTemplate renders the generated page set", () => {
  const template = resolveStorefrontTemplate({
    activeTemplateId: GENERATED_TEMPLATE_ID,
    generatedTemplate: { pages: ["HOME", "ABOUT"] },
  });
  assert.equal(template.id, GENERATED_TEMPLATE_ID);
  assert.deepEqual(template.pages, ["HOME", "ABOUT"]);
});

test("resolveStorefrontTemplate with activeTemplateId=GENERATED but no valid generatedTemplate falls back to CLASSIC, never breaking the storefront", () => {
  const template = resolveStorefrontTemplate({ activeTemplateId: GENERATED_TEMPLATE_ID, generatedTemplate: null });
  assert.equal(template.id, "CLASSIC");
});
