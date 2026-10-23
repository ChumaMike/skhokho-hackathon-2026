import test from "node:test";
import assert from "node:assert/strict";
import type { BusinessCategory } from "@prisma/client";
import { BUSINESS_CATEGORIES } from "@/lib/business-categories";
import { getBusinessCapabilities } from "@/modules/tenant/capabilities";
import { deriveDefaultPrimaryAction, getAvailablePrimaryActions } from "@/modules/tenant/storefront-theme";
import { getBusinessExperience } from "@/modules/tenant/business-experience";
import { resolveStorefrontVariant } from "@/modules/tenant/shopfront-eligibility";
import { ctaHref, resolveHomeLayout } from "@/modules/storefront-spec/layout";
import { defaultSitePages, pageIsServable, RESERVED_PAGE_SLUGS, SiteSchema } from "@/modules/storefront-spec/pages";
import { buildRulesSpec } from "@/modules/storefront-spec/planner";
import { validateSpec } from "@/modules/storefront-spec/validate";
import type { StorefrontFacts } from "@/modules/storefront-spec/facts";
import {
  WORKFLOWS,
  WORKFLOW_IDS,
  WORKFLOW_SLUGS,
  activeWorkflows,
  describeLeadDetails,
  parseLead,
  primaryWorkflow,
  workflowBySlug,
} from "./workflows";

const contact = { whatsapp: "+27821234567", phone: "+27111234567", address: "1 Main Rd", suburb: "Soweto", city: "Johannesburg" };

function caps(category: BusinessCategory) {
  return getBusinessCapabilities({ category, settings: null });
}

// ---------------------------------------------------------------------------
// Which business gets which workflow
// ---------------------------------------------------------------------------

test("category defaults give each kind of business the requests the audit asked for, and the plan gate switches them all off", () => {
  const on = (category: BusinessCategory) => activeWorkflows(caps(category), true);
  assert.deepEqual(on("MECHANIC"), ["QUOTE_REQUEST", "CALLBACK_REQUEST"]);
  assert.deepEqual(on("EVENTS"), ["QUOTE_REQUEST", "EVENT_ENQUIRY"]);
  assert.deepEqual(on("CHILDCARE"), ["EVENT_ENQUIRY", "CALLBACK_REQUEST"]);
  assert.deepEqual(on("LAUNDRY"), ["QUOTE_REQUEST", "PICKUP_REQUEST"]);
  assert.deepEqual(on("CAR_WASH"), ["PICKUP_REQUEST", "CALLBACK_REQUEST"]);
  assert.deepEqual(on("SALON"), ["CALLBACK_REQUEST"]);
  assert.deepEqual(on("FOOD_VENDOR"), []);
  assert.deepEqual(on("RETAIL_STORE"), []);
  for (const [category] of BUSINESS_CATEGORIES) assert.deepEqual(activeWorkflows(caps(category), false), [], `${category} must have nothing without the plan`);
});

test("the main button: a quote or dated enquiry outranks booking; a pickup or callback sits below it", () => {
  const mechanic = activeWorkflows(caps("MECHANIC"), true);
  assert.equal(primaryWorkflow(mechanic), "QUOTE_REQUEST");
  assert.equal(deriveDefaultPrimaryAction(caps("MECHANIC"), contact, mechanic), "ENQUIRE");
  assert.equal(deriveDefaultPrimaryAction(caps("MECHANIC"), contact, []), "BOOK", "without the plan the mechanic still books");
  assert.equal(deriveDefaultPrimaryAction(caps("CHILDCARE"), contact, activeWorkflows(caps("CHILDCARE"), true)), "ENQUIRE");
  assert.equal(deriveDefaultPrimaryAction(caps("SALON"), contact, activeWorkflows(caps("SALON"), true)), "BOOK");
  assert.equal(deriveDefaultPrimaryAction(caps("CAR_WASH"), contact, activeWorkflows(caps("CAR_WASH"), true)), "BOOK");
  // ENQUIRE is only ever offered when a workflow is live.
  assert.ok(!getAvailablePrimaryActions(caps("MECHANIC"), contact).includes("ENQUIRE"));
  assert.ok(getAvailablePrimaryActions(caps("MECHANIC"), contact, mechanic).includes("ENQUIRE"));
  assert.equal(ctaHref("ENQUIRE", "BOOKING", { ...contact, slug: "x" }, "/store/x", "quote"), "/store/x/quote");
  assert.equal(ctaHref("ENQUIRE", "BOOKING", { ...contact, slug: "x" }, "/store/x"), null);
});

test("without a published layout the mechanic's hero button already leads to the quote page", () => {
  const business = { ...contact, slug: "fixit", settings: null };
  const workflows = activeWorkflows(caps("MECHANIC"), true);
  const layout = resolveHomeLayout(business, caps("MECHANIC"), "BOOKING", "/store/fixit", { label: "Book now", href: "/store/fixit#services" }, workflows);
  assert.deepEqual(layout.heroAction, { label: "Get a quote", href: "/store/fixit/quote" });
  const withoutPlan = resolveHomeLayout(business, caps("MECHANIC"), "BOOKING", "/store/fixit", { label: "Book now", href: "/store/fixit#services" }, []);
  assert.deepEqual(withoutPlan.heroAction, { label: "Book now", href: "/store/fixit#services" });
});

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

test("request pages appear right after the catalogue, only for live workflows, on reserved addresses", () => {
  const workflows = activeWorkflows(caps("MECHANIC"), true);
  const pages = defaultSitePages({ category: "MECHANIC", capabilities: caps("MECHANIC"), variant: "BOOKING", catalogLabel: "Parts", workflows });
  const ids = pages.map((p) => p.id);
  assert.deepEqual(ids.slice(0, 5), ["HOME", "CATALOGUE_SERVICES", "CATALOGUE_PRODUCTS", "ACTION_QUOTE_REQUEST", "ACTION_CALLBACK_REQUEST"]);
  assert.equal(pages.find((p) => p.id === "ACTION_QUOTE_REQUEST")?.slug, "quote");
  assert.ok(SiteSchema.safeParse({ pages }).success);
  for (const slug of WORKFLOW_SLUGS) assert.ok(RESERVED_PAGE_SLUGS.has(slug), `${slug} must be reserved`);

  // Plan lapses: the page is no longer servable, so it drops out — publishing is not blocked.
  const quotePage = pages.find((p) => p.id === "ACTION_QUOTE_REQUEST")!;
  assert.equal(pageIsServable(quotePage, { capabilities: caps("MECHANIC"), workflows }), true);
  assert.equal(pageIsServable(quotePage, { capabilities: caps("MECHANIC"), workflows: [] }), false);
  assert.equal(workflowBySlug("quote")?.id, "QUOTE_REQUEST");
  assert.equal(workflowBySlug("nope"), null);
});

function facts(category: BusinessCategory, workflows = activeWorkflows(caps(category), true)): StorefrontFacts {
  return {
    name: "Fix-It Motors",
    slug: "fix-it",
    category,
    description: "Brakes, clutches and services.",
    location: { suburb: "Soweto", city: "Johannesburg", province: "Gauteng" },
    capabilities: [...caps(category)],
    contact: { phone: true, whatsapp: true, email: false, address: true },
    brand: { primaryColor: "#9A5A0A", accentColor: "#1F6F5C", hasLogo: true, hasBanner: true },
    products: { count: 2, withImages: 1, sampleNames: ["Brake pads"] },
    services: { count: 3, withImages: 1, sampleNames: ["Brake service"] },
    hoursConfigured: true,
    deliveryEnabled: false,
    reviewCount: 0,
    profile: {},
    brief: null,
    current: { template: "BOOKING", templateId: null, content: { version: 1, hero: {}, about: {}, highlights: { items: [] }, process: [] }, site: null },
    imageCount: 2,
    workflows,
  };
}

test("the rules spec for a mechanic leads with the quote request and validates; without the plan it falls back to booking", () => {
  const withQuotes = buildRulesSpec(facts("MECHANIC"), "GENERATE");
  assert.equal(withQuotes.strategy.goal, "ENQUIRIES");
  assert.equal(withQuotes.cta.action, "ENQUIRE");
  assert.equal(withQuotes.cta.label, "Get a quote");
  assert.ok(withQuotes.site?.pages.some((p) => p.id === "ACTION_QUOTE_REQUEST"));
  const report = validateSpec(withQuotes, facts("MECHANIC"));
  assert.equal(report.ok, true, JSON.stringify(report.errors));

  // Same spec re-validated after the plan lapses: the main button is unavailable → blocked, with a reason.
  const lapsed = validateSpec(withQuotes, facts("MECHANIC", []));
  assert.equal(lapsed.ok, false);
  assert.ok(lapsed.errors.some((e) => e.code === "CTA_UNAVAILABLE"));
  assert.ok(lapsed.warnings.some((w) => w.code === "WORKFLOW_UNAVAILABLE"));

  const noPlan = buildRulesSpec(facts("MECHANIC", []), "GENERATE");
  assert.equal(noPlan.cta.action, "BOOK");
  // The salon keeps booking as its goal even with callbacks on.
  const salon = { ...facts("SALON"), name: "Nomsa Hair", products: { count: 0, withImages: 0, sampleNames: [] } };
  assert.equal(buildRulesSpec(salon, "GENERATE").cta.action, "BOOK");
});

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

test("each workflow validates its own fields, refuses markup and links, and keeps the shared fields", () => {
  const base = { name: "Thabo", phone: "082 123 4567", email: "", message: "" };

  const quote = parseLead("QUOTE_REQUEST", { ...base, message: "Brakes squealing, front left.", about: "2015 Polo", preferredDate: "2026-11-02" });
  assert.ok(quote.ok);
  assert.deepEqual(quote.lead.details, { about: "2015 Polo", preferredDate: "2026-11-02" });
  assert.equal(parseLead("QUOTE_REQUEST", { ...base }).ok, false, "a quote needs a message");
  assert.equal(parseLead("QUOTE_REQUEST", { ...base, message: "See <b>this</b>" }).ok, false);
  assert.equal(parseLead("QUOTE_REQUEST", { ...base, message: "ok", about: "https://evil.test" }).ok, false);
  assert.equal(parseLead("QUOTE_REQUEST", { ...base, message: "ok", extra: "field" }).ok, true, "unknown fields are ignored, not stored");

  const event = parseLead("EVENT_ENQUIRY", { ...base, eventDate: "2026-12-12", headcount: "60", about: "Wedding" });
  assert.ok(event.ok);
  assert.equal(event.lead.details.headcount, 60);
  assert.equal(parseLead("EVENT_ENQUIRY", { ...base, eventDate: "2026-12-12" }).ok, false, "headcount is required");
  assert.equal(parseLead("EVENT_ENQUIRY", { ...base, eventDate: "soon", headcount: "10" }).ok, false);
  assert.equal(parseLead("EVENT_ENQUIRY", { ...base, eventDate: "2026-12-12", headcount: "99999" }).ok, false);

  const pickup = parseLead("PICKUP_REQUEST", { ...base, address: "12 Vilakazi St", preferredDate: "2026-11-03", timeWindow: "MORNING" });
  assert.ok(pickup.ok);
  assert.equal(parseLead("PICKUP_REQUEST", { ...base, address: "12 Vilakazi St", preferredDate: "2026-11-03", timeWindow: "NIGHT" }).ok, false);

  const callback = parseLead("CALLBACK_REQUEST", { ...base, bestTime: "EVENING", about: "Braids on Saturday" });
  assert.ok(callback.ok);
  assert.equal(parseLead("CALLBACK_REQUEST", { ...base, phone: "12", bestTime: "ANY" }).ok, false);
  assert.equal(parseLead("CALLBACK_REQUEST", { ...base, email: "not-an-email", bestTime: "ANY" }).ok, false);
  assert.equal(parseLead("CALLBACK_REQUEST", { ...base, name: "", bestTime: "ANY" }).ok, false);
});

test("stored details read back as category-aware lines for the inbox", () => {
  const lines = describeLeadDetails("QUOTE_REQUEST", "MECHANIC", { about: "2015 Polo", preferredDate: "2026-11-02" });
  assert.deepEqual(lines, [
    { label: "Your vehicle", value: "2015 Polo" },
    { label: "When do you need it by?", value: "2026-11-02" },
  ]);
  assert.deepEqual(describeLeadDetails("PICKUP_REQUEST", "LAUNDRY", { address: "x", preferredDate: "2026-11-03", timeWindow: "MORNING" })[2], { label: "Best time", value: "Morning" });
  assert.deepEqual(describeLeadDetails("CALLBACK_REQUEST", "SALON", null), []);
  for (const id of WORKFLOW_IDS) assert.ok(WORKFLOWS[id].fields.length > 0 && WORKFLOWS[id].slug && WORKFLOWS[id].ctaLabel.length <= 18, `${id} CTA fits a phone button`);
  void getBusinessExperience;
  void resolveStorefrontVariant;
});
