import test from "node:test";
import assert from "node:assert/strict";
import type { BusinessCategory } from "@prisma/client";
import { getBusinessCapabilities, type BusinessCapability } from "@/modules/tenant/capabilities";
import type { StorefrontFacts } from "./facts";
import { applyTemplate, buildRulesSpec, planStorefront, templateFitInput } from "./planner";
import { generateSpec } from "./copywriter";
import { validateSpec } from "./validate";
import { withSpecApplied } from "./project";
import { resolveHomeLayout } from "./layout";
import { parseSpec, SPEC_LIMITS, type StorefrontSpec } from "./spec";
import { STOREFRONT_TEMPLATE_LIBRARY, TEMPLATE_IDS, chooseTemplateId, getTemplate, templateMisfits, type TemplateId } from "./templates";

// ---------------------------------------------------------------------------
// One business per template, plus the stress variants every template must survive
// ---------------------------------------------------------------------------

type Scenario = "realistic" | "long-names" | "no-images" | "empty";

function facts(category: BusinessCategory, over: Partial<StorefrontFacts> = {}): StorefrontFacts {
  return {
    name: "Kota Tainment",
    slug: "kota-tainment",
    category,
    description: "Kotas, chips and cold drinks.",
    location: { suburb: "Soweto", city: "Johannesburg", province: "Gauteng" },
    capabilities: [...getBusinessCapabilities({ category, settings: null })],
    contact: { phone: true, whatsapp: true, email: false, address: true },
    brand: { primaryColor: "#9A5A0A", accentColor: "#1F6F5C", hasLogo: true, hasBanner: true },
    products: { count: 0, withImages: 0, sampleNames: [] },
    services: { count: 0, withImages: 0, sampleNames: [] },
    hoursConfigured: true,
    deliveryEnabled: false,
    reviewCount: 2,
    profile: {},
    brief: null,
    current: { template: "PRODUCT", templateId: null, content: { version: 1, hero: {}, about: {}, highlights: { items: [] }, process: [] }, site: null },
    imageCount: 0,
    workflows: [],
    ...over,
  };
}

const LONG_NAME = "Mama Thandeka's Famous Soweto Kota, Chips, Russians and Cold Drinks Kitchen & Takeaway";
const LONG_ITEM = "Quadruple-decker Russian, Vienna, polony, cheese, egg and atchar kota with extra-large chips";

/** The template each fixture is designed to land on, with its stress variants. */
const TEMPLATE_FIXTURES: Record<TemplateId, (scenario: Scenario) => StorefrontFacts> = {
  FOOD_MENU: (scenario) =>
    facts("FOOD_VENDOR", {
      name: scenario === "long-names" ? LONG_NAME : "Kota Tainment",
      products:
        scenario === "empty"
          ? { count: 0, withImages: 0, sampleNames: [] }
          : { count: 14, withImages: scenario === "realistic" ? 14 : 0, sampleNames: [scenario === "long-names" ? LONG_ITEM : "Russian kota", "Chips"] },
      brand: { primaryColor: "#9A5A0A", accentColor: "#1F6F5C", hasLogo: scenario === "realistic", hasBanner: scenario === "realistic" },
    }),
  SALON_BOOKING: (scenario) =>
    facts("SALON", {
      name: scenario === "long-names" ? LONG_NAME.replace("Kota", "Braids") : "Beauty by Nomsa",
      description: "Braids, relaxers and nails.",
      services:
        scenario === "empty"
          ? { count: 0, withImages: 0, sampleNames: [] }
          : { count: 6, withImages: scenario === "realistic" ? 6 : 0, sampleNames: [scenario === "long-names" ? LONG_ITEM : "Box braids"] },
      brand: { primaryColor: "#5B2A86", accentColor: "#C9A227", hasLogo: scenario === "realistic", hasBanner: scenario === "realistic" },
      current: { template: "BOOKING", templateId: null, content: { version: 1, hero: {}, about: {}, highlights: { items: [] }, process: [] }, site: null },
    imageCount: 0,
    workflows: [],
    }),
  SERVICES_LEAD: (scenario) =>
    facts("MECHANIC", {
      name: scenario === "long-names" ? `${LONG_NAME} Auto` : "Sipho's Auto",
      description: "Services and repairs — quotes on WhatsApp.",
      // Takes enquiries, not online bookings.
      capabilities: ["SERVICES", "PRODUCTS", "LOYALTY"],
      services:
        scenario === "empty"
          ? { count: 0, withImages: 0, sampleNames: [] }
          : { count: 5, withImages: scenario === "realistic" ? 5 : 0, sampleNames: [scenario === "long-names" ? LONG_ITEM : "Minor service"] },
      brand: { primaryColor: "#1D4ED8", accentColor: "#F59E0B", hasLogo: scenario === "realistic", hasBanner: scenario === "realistic" },
    }),
  RETAIL_GRID: (scenario) =>
    facts("RETAIL_STORE", {
      name: scenario === "long-names" ? LONG_NAME.replace("Kota", "Threads") : "Thandi's Threads",
      description: "Dresses, sneakers and caps.",
      products:
        scenario === "empty"
          ? { count: 0, withImages: 0, sampleNames: [] }
          : { count: 24, withImages: scenario === "realistic" ? 24 : 0, sampleNames: [scenario === "long-names" ? LONG_ITEM : "Summer dress", "Cap"] },
      brand: { primaryColor: "#0F766E", accentColor: "#F59E0B", hasLogo: scenario === "realistic", hasBanner: scenario === "realistic" },
    }),
  SERVICE_PORTFOLIO: (scenario) =>
    facts("MECHANIC", {
      name: scenario === "long-names" ? `${LONG_NAME} Motors` : "Fix-It Motors",
      description: "Brakes, clutches and services — quotes first.",
      services:
        scenario === "empty"
          ? { count: 0, withImages: 0, sampleNames: [] }
          : { count: 5, withImages: scenario === "realistic" ? 5 : 0, sampleNames: [scenario === "long-names" ? LONG_ITEM : "Brake service"] },
      brand: { primaryColor: "#1D4ED8", accentColor: "#F59E0B", hasLogo: scenario === "realistic", hasBanner: scenario === "realistic" },
      current: { template: "BOOKING", templateId: null, content: { version: 1, hero: {}, about: {}, highlights: { items: [] }, process: [] }, site: null },
      // Quotes are live (capability and plan): the portfolio leads with the request form.
      workflows: ["QUOTE_REQUEST", "CALLBACK_REQUEST"],
    }),
};

const SCENARIOS: Scenario[] = ["realistic", "long-names", "no-images", "empty"];

// ---------------------------------------------------------------------------
// The library itself
// ---------------------------------------------------------------------------

test("the library is exactly five controlled templates, each fully defined", () => {
  assert.deepEqual([...TEMPLATE_IDS], ["FOOD_MENU", "SALON_BOOKING", "SERVICES_LEAD", "RETAIL_GRID", "SERVICE_PORTFOLIO"]);
  for (const id of TEMPLATE_IDS) {
    const t = STOREFRONT_TEMPLATE_LIBRARY[id];
    assert.ok(t.pages.required.includes("HOME"), `${id} page architecture includes HOME`);
    assert.ok(t.sections.defaultOrder.length === 4 && new Set(t.sections.defaultOrder).size === 4, `${id} section hierarchy covers every section once`);
    assert.ok(t.sections.required.every((s) => t.sections.defaultOrder.includes(s)), `${id} required sections exist`);
    assert.ok(t.cta.primary.length > 0, `${id} CTA hierarchy`);
    assert.ok(t.content.mobileHeadlineMax > 0 && t.content.mobileHeadlineMax <= SPEC_LIMITS.headline, `${id} content requirements`);
    assert.ok(t.responsive.mobile && t.responsive.desktop, `${id} responsive behaviour`);
    assert.ok(t.imagery.hero && t.imagery.items, `${id} recommended imagery`);
    assert.ok(t.composition.catalogue && t.composition.hero, `${id} visual composition`);
    // Nothing in a template is free-form markup or style.
    assert.doesNotMatch(JSON.stringify(t), /<|style=|class=|\{\{/);
  }
});

test("each vertical lands on its template; retail gets the collections grid", () => {
  const pick = (f: StorefrontFacts) => planStorefront(f, "GENERATE").templateId;
  assert.equal(pick(TEMPLATE_FIXTURES.FOOD_MENU("realistic")), "FOOD_MENU");
  assert.equal(pick(TEMPLATE_FIXTURES.SALON_BOOKING("realistic")), "SALON_BOOKING");
  assert.equal(pick(TEMPLATE_FIXTURES.SERVICES_LEAD("realistic")), "SERVICES_LEAD");
  assert.equal(pick(TEMPLATE_FIXTURES.RETAIL_GRID("realistic")), "RETAIL_GRID");
  assert.equal(pick(TEMPLATE_FIXTURES.SERVICE_PORTFOLIO("realistic")), "SERVICE_PORTFOLIO");
  // A retail business that switched products off has nothing for the grid: the classic shopfront.
  assert.equal(pick(facts("RETAIL_STORE", { capabilities: ["LOYALTY"] })), null);
});

test("MIXED is adaptive: services-led goes to services, products-led to the collections grid", () => {
  const caps = new Set<BusinessCapability>(["PRODUCTS", "ORDERS", "SERVICES", "BOOKINGS"]);
  const contact = { whatsapp: true, phone: true };
  assert.equal(chooseTemplateId("MIXED", { capabilities: caps, contact, productCount: 2, serviceCount: 8 }), "SALON_BOOKING");
  assert.equal(chooseTemplateId("MIXED", { capabilities: new Set<BusinessCapability>(["SERVICES"]), contact, productCount: 0, serviceCount: 3 }), "SERVICES_LEAD");
  assert.equal(chooseTemplateId("MIXED", { capabilities: caps, contact, productCount: 8, serviceCount: 2 }), "RETAIL_GRID");
  assert.equal(chooseTemplateId("MIXED", { capabilities: new Set<BusinessCapability>(["SERVICES", "BOOKINGS"]), contact, productCount: 8, serviceCount: 2 }), null);
});

// ---------------------------------------------------------------------------
// Every template × every stress scenario
// ---------------------------------------------------------------------------

for (const id of TEMPLATE_IDS) {
  for (const scenario of SCENARIOS) {
    test(`${id} · ${scenario}: a valid spec on the template, never broken`, () => {
      const f = TEMPLATE_FIXTURES[id](scenario);
      const spec = buildRulesSpec(f, "GENERATE");
      assert.equal(spec.templateId, id);
      assert.equal(spec.template, getTemplate(id).base);
      assert.ok(parseSpec(spec).ok, "parses");

      const report = validateSpec(spec, f);
      assert.deepEqual(report.errors, [], "no blocking errors");
      assert.ok(getTemplate(id).cta.primary.includes(spec.cta.action), "main button is in the template's hierarchy");
      assert.ok(spec.content.heroHeadline.length <= SPEC_LIMITS.headline);
      assert.ok(spec.seo.title.length <= SPEC_LIMITS.seoTitle);

      const codes = [...report.warnings, ...report.missing].map((i) => i.code);
      if (scenario === "empty") assert.ok(codes.includes("TEMPLATE_EMPTY"), "empty catalogue is flagged");
      if (scenario === "no-images" || scenario === "long-names") {
        assert.ok(codes.includes("NO_COVER_IMAGE"), "missing cover photo is listed");
        if (getTemplate(id).imagery.itemImagesMatter) assert.ok(codes.includes("TEMPLATE_IMAGES"), "item photos matter here");
      }
      if (scenario === "long-names") {
        // A long name is clipped, never overflowing the spec's limits.
        assert.ok(spec.content.heroHeadline.length <= SPEC_LIMITS.headline);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Capability mismatch
// ---------------------------------------------------------------------------

test("capability mismatch: a template the business can't serve is refused, with the reason", () => {
  const food = TEMPLATE_FIXTURES.FOOD_MENU("realistic");
  const onSalonTemplate = applyTemplate(buildRulesSpec(food, "GENERATE"), food, "SALON_BOOKING");
  const errors = validateSpec(onSalonTemplate, food).errors.map((e) => e.code);
  assert.ok(errors.includes("TEMPLATE_UNSUPPORTED"));
  assert.deepEqual(templateMisfits("SALON_BOOKING", templateFitInput(food)), [
    "Services and booking needs services switched on.",
    "Services and booking needs bookings switched on.",
  ]);
});

test("SERVICES_LEAD needs a WhatsApp or phone number", () => {
  const f = { ...TEMPLATE_FIXTURES.SERVICES_LEAD("realistic"), contact: { phone: false, whatsapp: false, email: true, address: true } };
  assert.deepEqual(templateMisfits("SERVICES_LEAD", templateFitInput(f)), ["Services and enquiries needs a WhatsApp or phone number for enquiries."]);
  assert.notEqual(planStorefront(f, "GENERATE").templateId, "SERVICES_LEAD");
});

test("a button outside the template's hierarchy, or a hidden required section, blocks publishing", () => {
  const f = TEMPLATE_FIXTURES.SERVICES_LEAD("realistic");
  const spec = buildRulesSpec(f, "GENERATE");
  const visit = { ...structuredClone(spec), cta: { action: "VISIT" as const, label: "Find us" } };
  assert.ok(validateSpec(visit, f).errors.some((e) => e.code === "CTA_NOT_IN_TEMPLATE"));
  const hidden = structuredClone(spec);
  hidden.home.sections = hidden.home.sections.map((s) => (s.id === "CATALOGUE" ? { ...s, visible: false } : s));
  assert.ok(validateSpec(hidden, f).errors.some((e) => e.code === "SECTION_REQUIRED"));
});

test("a lead template never offers online booking, even when the business could book", () => {
  const f = facts("MECHANIC", { services: { count: 3, withImages: 0, sampleNames: ["Service"] } }); // has BOOKINGS
  const spec = applyTemplate(buildRulesSpec(f, "GENERATE"), f, "SERVICES_LEAD");
  assert.notEqual(spec.cta.action, "BOOK");
  assert.ok(["WHATSAPP", "CALL"].includes(spec.cta.action));
});

test("live renderer: a published template that no longer fits falls back to the classic composition", () => {
  const f = TEMPLATE_FIXTURES.FOOD_MENU("realistic");
  const spec = buildRulesSpec(f, "GENERATE");
  const state = {
    category: "FOOD_VENDOR" as BusinessCategory,
    slug: "kota",
    whatsapp: "+27821234567",
    phone: null,
    address: null,
    suburb: "Soweto",
    city: null,
    primaryColor: null,
    accentColor: null,
    settings: {},
  };
  const live = withSpecApplied(state, spec, "rev");
  assert.equal(resolveHomeLayout(live, getBusinessCapabilities(live), "PRODUCT", "/s").template?.id, "FOOD_MENU");

  // Products switched off since publishing → no menu template.
  const noProducts = { ...live, settings: { ...(live.settings as object), capabilities: ["SERVICES", "BOOKINGS"] } };
  assert.equal(resolveHomeLayout(noProducts, getBusinessCapabilities(noProducts), "PRODUCT", "/s").template, null);
});

test("live renderer: a template's required section can't be hidden by a stored layout", () => {
  const f = TEMPLATE_FIXTURES.FOOD_MENU("realistic");
  const spec: StorefrontSpec = structuredClone(buildRulesSpec(f, "GENERATE"));
  spec.home.sections = spec.home.sections.map((s) => (s.id === "CATALOGUE" ? { ...s, visible: false } : s));
  const state = { category: "FOOD_VENDOR" as BusinessCategory, slug: "k", whatsapp: "+27821234567", phone: null, address: null, suburb: null, city: null, primaryColor: null, accentColor: null, settings: {} };
  const live = withSpecApplied(state, spec, "rev");
  assert.ok(resolveHomeLayout(live, getBusinessCapabilities(live), "PRODUCT", "/s").sections.includes("CATALOGUE"));
});

// ---------------------------------------------------------------------------
// Accessibility (spec-level; rendered checks run in the browser smoke test)
// ---------------------------------------------------------------------------

test("every template's realistic spec has readable colours or says how they'll be adjusted", () => {
  for (const id of TEMPLATE_IDS) {
    const f = TEMPLATE_FIXTURES[id]("realistic");
    const report = validateSpec(buildRulesSpec(f, "GENERATE"), f);
    // Any colour the renderer would have to darken/lighten is disclosed, never silent.
    for (const w of report.warnings.filter((w) => w.code === "COLOUR_ADJUSTED")) assert.match(w.message, /readable/);
  }
});

test("the compact menu hero has a tighter phone headline limit", () => {
  const f = TEMPLATE_FIXTURES.FOOD_MENU("realistic");
  const spec = structuredClone(buildRulesSpec(f, "GENERATE"));
  spec.content.heroHeadline = "Proper Soweto kotas, made fresh every single day"; // 48 chars, over the 40 the compact hero fits
  assert.ok(validateSpec(spec, f).warnings.some((w) => w.code === "MOBILE_HEADLINE_LONG"));
});

// ---------------------------------------------------------------------------
// AI: chooses and composes templates — within the library
// ---------------------------------------------------------------------------

const proposal = (over: Record<string, unknown>) => async () =>
  JSON.stringify({
    rationale: "Built around what customers do here.",
    heroHeadline: "Proper kotas",
    ctaLabel: "Order now",
    seoTitle: "Kota Tainment — kotas in Soweto",
    seoDescription: "Order kotas, chips and cold drinks online from Kota Tainment in Soweto and collect them hot.",
    ...over,
  });

test("the AI may switch to another template the business fits, and everything it governs follows", async () => {
  const f = facts("OTHER", {
    capabilities: ["PRODUCTS", "ORDERS", "SERVICES", "BOOKINGS"],
    products: { count: 2, withImages: 2, sampleNames: ["Airtime"] },
    services: { count: 6, withImages: 0, sampleNames: ["Phone repair"] },
  });
  const result = await generateSpec(f, "GENERATE", proposal({ templateId: "SERVICES_LEAD", ctaLabel: "Ask us" }));
  assert.equal(result.spec.templateId, "SERVICES_LEAD");
  assert.equal(result.spec.template, "BOOKING");
  assert.ok(["WHATSAPP", "CALL"].includes(result.spec.cta.action), "the button follows the template");
  assert.deepEqual(validateSpec(result.spec, f).errors, []);
});

test("the AI can't pick a template the business doesn't fit — the planner's choice stands", async () => {
  const f = TEMPLATE_FIXTURES.FOOD_MENU("realistic");
  const result = await generateSpec(f, "GENERATE", proposal({ templateId: "SALON_BOOKING" }));
  assert.equal(result.source, "AI_GENERATED");
  assert.equal(result.spec.templateId, "FOOD_MENU");
});

test("the AI can't invent a template", async () => {
  const result = await generateSpec(TEMPLATE_FIXTURES.FOOD_MENU("realistic"), "GENERATE", proposal({ templateId: "NEON_LANDING_PAGE" }));
  assert.equal(result.source, "RULES", "an unknown template rejects the whole answer");
});

test("the AI may choose the classic shopfront instead of a template", async () => {
  const result = await generateSpec(TEMPLATE_FIXTURES.FOOD_MENU("realistic"), "GENERATE", proposal({ templateId: "CLASSIC" }));
  assert.equal(result.spec.templateId, null);
  assert.equal(result.spec.template, "PRODUCT");
});

test("the AI's suggestions are kept for the merchant, never applied", async () => {
  const result = await generateSpec(TEMPLATE_FIXTURES.FOOD_MENU("no-images"), "GENERATE", proposal({ suggestions: ["Add photos of your best-selling kotas."] }));
  assert.deepEqual(result.spec.strategy.suggestions, ["Add photos of your best-selling kotas."]);
});

test("Level A (improve my words) never changes the template", async () => {
  const f = { ...TEMPLATE_FIXTURES.SALON_BOOKING("realistic"), current: { template: "BOOKING" as const, templateId: "SALON_BOOKING" as const, content: { version: 1 as const, hero: {}, about: {}, highlights: { items: [] }, process: [] }, site: null } };
  const result = await generateSpec(f, "ASSIST", proposal({ templateId: "CLASSIC", ctaLabel: "Book a slot" }));
  assert.equal(result.spec.templateId, "SALON_BOOKING");
});
