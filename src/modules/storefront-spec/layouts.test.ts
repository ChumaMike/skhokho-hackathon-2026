import test from "node:test";
import assert from "node:assert/strict";
import type { BusinessCategory } from "@prisma/client";
import { getBusinessCapabilities } from "@/modules/tenant/capabilities";
import { activeWorkflows } from "@/modules/storefront-workflows/workflows";
import { CATALOGUE_LAYOUTS, GALLERY_LAYOUTS, LAYOUT_LABELS, SECTION_LAYOUTS, allowedLayouts, catalogueLayoutFor, isLayoutAllowed } from "./layouts";
import { getStorefrontLayout, resolveHomeLayout } from "./layout";
import { parseSpec, type StorefrontSpec } from "./spec";
import { buildRulesSpec, planStorefront } from "./planner";
import { projectSpec } from "./project";
import { chooseTemplateId, getTemplate, STOREFRONT_TEMPLATE_LIBRARY, TEMPLATE_IDS } from "./templates";
import { validateSpec } from "./validate";
import { SiteSchema, defaultSitePages } from "./pages";
import { sectionFromInput } from "./pages-edit";
import type { StorefrontFacts } from "./facts";

const contact = { whatsapp: "+27821234567", phone: "+27111234567", address: "1 Main Rd", suburb: "Soweto", city: "Johannesburg", slug: "x" };

function facts(category: BusinessCategory, over: Partial<StorefrontFacts> = {}): StorefrontFacts {
  const caps = getBusinessCapabilities({ category, settings: null });
  return {
    name: "Thandi's Threads",
    slug: "thandis-threads",
    category,
    description: "Dresses, sneakers and caps.",
    location: { suburb: "Soweto", city: "Johannesburg", province: "Gauteng" },
    capabilities: [...caps],
    contact: { phone: true, whatsapp: true, email: false, address: true },
    brand: { primaryColor: "#9A5A0A", accentColor: "#1F6F5C", hasLogo: true, hasBanner: true },
    products: { count: 9, withImages: 9, sampleNames: ["Dress", "Cap"] },
    services: { count: 0, withImages: 0, sampleNames: [] },
    hoursConfigured: true,
    deliveryEnabled: false,
    reviewCount: 2,
    profile: {},
    brief: null,
    current: { template: "PRODUCT", templateId: null, content: { version: 1, hero: {}, about: {}, highlights: { items: [] }, process: [] }, site: null },
    imageCount: 9,
    workflows: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The two new compositions
// ---------------------------------------------------------------------------

test("the library has five compositions; retail now lands on RETAIL_GRID and a quoting mechanic on SERVICE_PORTFOLIO", () => {
  assert.deepEqual([...TEMPLATE_IDS], ["FOOD_MENU", "SALON_BOOKING", "SERVICES_LEAD", "RETAIL_GRID", "SERVICE_PORTFOLIO"]);
  for (const id of TEMPLATE_IDS) {
    const t = STOREFRONT_TEMPLATE_LIBRARY[id];
    assert.equal(t.id, id);
    assert.ok(t.sections.defaultOrder.length === 4, `${id} covers every home section`);
    assert.doesNotMatch(JSON.stringify(t), /<|style=|class=|\{\{/);
  }
  assert.equal(planStorefront(facts("RETAIL_STORE"), "GENERATE").templateId, "RETAIL_GRID");

  const mechanicCaps = getBusinessCapabilities({ category: "MECHANIC", settings: null });
  const quoting = { capabilities: mechanicCaps, contact: { whatsapp: true, phone: true }, productCount: 2, serviceCount: 5, workflows: activeWorkflows(mechanicCaps, true) };
  assert.equal(chooseTemplateId("SERVICES", quoting), "SERVICE_PORTFOLIO");
  assert.equal(chooseTemplateId("SERVICES", { ...quoting, workflows: [] }), "SALON_BOOKING", "without the plan the mechanic keeps the booking template");
  const salonCaps = getBusinessCapabilities({ category: "SALON", settings: null });
  assert.equal(chooseTemplateId("SALON", { capabilities: salonCaps, contact: { whatsapp: true, phone: true }, productCount: 0, serviceCount: 6, workflows: activeWorkflows(salonCaps, true) }), "SALON_BOOKING");
  // MIXED, products-led: the collections grid; services-led without booking: the portfolio is the fallback.
  assert.equal(chooseTemplateId("MIXED", { capabilities: new Set(["PRODUCTS", "ORDERS", "SERVICES"]), contact: { whatsapp: true, phone: true }, productCount: 8, serviceCount: 2 }), "RETAIL_GRID");
  assert.equal(chooseTemplateId("MIXED", { capabilities: new Set(["SERVICES"]), contact: { whatsapp: false, phone: false }, productCount: 0, serviceCount: 3 }), null);

  // The portfolio leads with the request form when one is live, else WhatsApp/call; it never requires booking.
  assert.deepEqual(getTemplate("SERVICE_PORTFOLIO").cta.primary, ["ENQUIRE", "WHATSAPP", "CALL", "BOOK"]);
  assert.deepEqual(getTemplate("SERVICE_PORTFOLIO").requires.capabilities, ["SERVICES"]);
});

test("a retail rules spec on RETAIL_GRID validates, and a mechanic's portfolio spec carries its request button", () => {
  const retail = buildRulesSpec(facts("RETAIL_STORE"), "GENERATE");
  assert.equal(retail.templateId, "RETAIL_GRID");
  assert.equal(retail.cta.action, "ORDER");
  assert.equal(validateSpec(retail, facts("RETAIL_STORE")).ok, true);

  const mechanicCaps = getBusinessCapabilities({ category: "MECHANIC", settings: null });
  const mechanic = facts("MECHANIC", {
    name: "Fix-It Motors",
    capabilities: [...mechanicCaps],
    products: { count: 2, withImages: 1, sampleNames: ["Brake pads"] },
    services: { count: 4, withImages: 4, sampleNames: ["Brake service"] },
    current: { template: "BOOKING", templateId: null, content: { version: 1, hero: {}, about: {}, highlights: { items: [] }, process: [] }, site: null },
    workflows: activeWorkflows(mechanicCaps, true),
  });
  const spec = buildRulesSpec(mechanic, "GENERATE");
  assert.equal(spec.templateId, "SERVICE_PORTFOLIO");
  assert.equal(spec.cta.action, "ENQUIRE");
  assert.equal(validateSpec(spec, mechanic).ok, true, JSON.stringify(validateSpec(spec, mechanic).errors));
});

// ---------------------------------------------------------------------------
// Per-section layouts
// ---------------------------------------------------------------------------

test("every layout option has a label and is only allowed on the base it exists for", () => {
  for (const layout of [...CATALOGUE_LAYOUTS.PRODUCT, ...CATALOGUE_LAYOUTS.BOOKING, ...SECTION_LAYOUTS.TRUST_BAR, ...SECTION_LAYOUTS.ABOUT, ...SECTION_LAYOUTS.REVIEWS]) {
    assert.ok(LAYOUT_LABELS[layout], `${layout} needs a label`);
  }
  assert.deepEqual([...allowedLayouts("CATALOGUE", "PRODUCT")], ["GRID", "LIST", "MENU", "COLLECTIONS"]);
  assert.deepEqual([...allowedLayouts("CATALOGUE", "BOOKING")], ["CARDS", "LIST", "PORTFOLIO"]);
  assert.equal(isLayoutAllowed("CATALOGUE", "PRODUCT", "PORTFOLIO"), false);
  assert.equal(isLayoutAllowed("ABOUT", "BOOKING", "STACKED"), true);
  assert.equal(isLayoutAllowed("REVIEWS", "BOOKING", "GRID"), false);
  assert.equal(catalogueLayoutFor("RETAIL_GRID", "PRODUCT"), "COLLECTIONS");
  assert.equal(catalogueLayoutFor("SERVICE_PORTFOLIO", "BOOKING"), "PORTFOLIO");
  assert.equal(catalogueLayoutFor("MENU_LIST", "PRODUCT"), "MENU");
  assert.equal(catalogueLayoutFor(null, "BOOKING"), "CARDS");
  assert.equal(catalogueLayoutFor(null, "PRODUCT"), "GRID");
});

test("the spec validates layouts per section and base; the published layout drops any it can't render", () => {
  const spec = buildRulesSpec(facts("RETAIL_STORE"), "GENERATE");
  const withLayouts: StorefrontSpec = {
    ...spec,
    home: { sections: spec.home.sections.map((s) => (s.id === "ABOUT" ? { ...s, layout: "STACKED" } : s.id === "REVIEWS" ? { ...s, layout: "LIST" } : s)) },
  };
  assert.ok(parseSpec(withLayouts).ok);
  const wrong = { ...spec, home: { sections: spec.home.sections.map((s) => (s.id === "CATALOGUE" ? { ...s, layout: "PORTFOLIO" } : s)) } };
  const parsed = parseSpec(wrong);
  assert.equal(parsed.ok, false);
  assert.match(parsed.ok ? "" : parsed.errors[0], /CATALOGUE can be GRID, LIST, MENU, COLLECTIONS/);

  // Published and read back: the owner's choices survive, the composition fills the rest.
  const projection = projectSpec({}, withLayouts, "rev_1");
  const stored = getStorefrontLayout({ settings: projection.settings });
  assert.equal(stored?.sections.find((s) => s.id === "ABOUT")?.layout, "STACKED");
  const home = resolveHomeLayout({ ...contact, settings: projection.settings }, new Set(["PRODUCTS", "ORDERS"]), "PRODUCT", "/store/x");
  assert.deepEqual(home.layouts, { TRUST_BAR: "BAR", CATALOGUE: "COLLECTIONS", ABOUT: "STACKED", REVIEWS: "LIST" });

  // A layout smuggled into settings for the wrong base is ignored, not rendered.
  const tampered = { ...projection.settings, storefrontLayout: { ...(projection.settings.storefrontLayout as object), sections: [{ id: "CATALOGUE", visible: true, layout: "PORTFOLIO" }] } };
  assert.equal(getStorefrontLayout({ settings: tampered })?.sections[0].layout, undefined);

  // Process steps travel with the spec and into the content the renderer reads.
  const withProcess: StorefrontSpec = { ...spec, content: { ...spec.content, process: [{ title: "Tell us", body: "Send a photo." }] } };
  assert.ok(parseSpec(withProcess).ok);
  assert.deepEqual((projectSpec({}, withProcess, "rev_2").settings.storefrontContent as { process: unknown }).process, [{ title: "Tell us", body: "Send a photo." }]);
});

test("owner pages: gallery, reviews and catalogue sections take a layout; others don't", () => {
  const pages = defaultSitePages({ category: "SALON", capabilities: getBusinessCapabilities({ category: "SALON", settings: null }), variant: "BOOKING", catalogLabel: "Products", workflows: [] });
  const withPairs = pages.map((p) => (p.kind === "GALLERY" ? { ...p, sections: [{ type: "GALLERY" as const, layout: "PAIRS" as const }] } : p));
  assert.ok(SiteSchema.safeParse({ pages: withPairs }).success);
  assert.equal(SiteSchema.safeParse({ pages: pages.map((p) => (p.kind === "GALLERY" ? { ...p, sections: [{ type: "GALLERY", layout: "MOSAIC" }] } : p)) }).success, false);
  assert.equal(SiteSchema.safeParse({ pages: pages.map((p) => (p.kind === "ABOUT" ? { ...p, sections: [{ type: "ABOUT", layout: "SPLIT" }] } : p)) }).success, false, "about has no page-section layout");
  assert.deepEqual(sectionFromInput({ type: "GALLERY", layout: "STRIP" }), { type: "GALLERY", layout: "STRIP" });
  assert.deepEqual(sectionFromInput({ type: "REVIEWS", layout: "" }), { type: "REVIEWS" });
  assert.deepEqual([...GALLERY_LAYOUTS], ["GRID", "PAIRS", "STRIP"]);
});
