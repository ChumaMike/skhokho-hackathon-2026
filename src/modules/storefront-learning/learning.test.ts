import test from "node:test";
import assert from "node:assert/strict";
import type { BusinessCategory } from "@prisma/client";
import { getBusinessCapabilities } from "@/modules/tenant/capabilities";
import type { StorefrontFacts } from "@/modules/storefront-spec/facts";
import { buildRulesSpec, planStorefront } from "@/modules/storefront-spec/planner";
import { buildSystemPrompt, generateSpec } from "@/modules/storefront-spec/copywriter";
import { defaultCtaLabel, type StorefrontSpec } from "@/modules/storefront-spec/spec";
import { classifyStorefrontPath } from "@/components/storefront/StorefrontBeacon";
import {
  CLIENT_EVENT_TYPES,
  ClientEventSchema,
  EventBatchSchema,
  storefrontDay,
} from "./events";
import { INSIGHT_MIN_VISITS, buildInsights, type StatRow } from "./insights";
import { detectPatterns, editSignals, patternFromSpec, patternSignature, type RevisionPerformance } from "./patterns";
import { applyLearnedPattern, patternHint, type PatternShape } from "./learned-pattern";

/** Pure rules of storefront learning — no database. */

function facts(category: BusinessCategory, over: Partial<StorefrontFacts> = {}): StorefrontFacts {
  return {
    name: "Kota Tainment",
    slug: "kota-tainment",
    category,
    description: "Soweto kotas, chips and cold drinks.",
    location: { suburb: "Soweto", city: "Johannesburg", province: "Gauteng" },
    capabilities: [...getBusinessCapabilities({ category, settings: null })],
    contact: { phone: true, whatsapp: true, email: false, address: true },
    brand: { primaryColor: "#9A5A0A", accentColor: "#1F6F5C", hasLogo: true, hasBanner: true },
    products: { count: 6, withImages: 6, sampleNames: ["Russian kota", "Chips"] },
    services: { count: 0, withImages: 0, sampleNames: [] },
    hoursConfigured: true,
    deliveryEnabled: false,
    reviewCount: 3,
    profile: {},
    brief: null,
    current: { template: "PRODUCT", templateId: null, content: { version: 1, hero: {}, about: {}, highlights: { items: [] }, process: [] }, site: null },
    imageCount: 0,
    workflows: [],
    ...over,
  };
}

const UUID = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------------------
// Privacy: what a browser can send
// ---------------------------------------------------------------------------

test("privacy: a browser cannot report orders or bookings — those are counted server-side", () => {
  assert.equal((CLIENT_EVENT_TYPES as readonly string[]).includes("ORDER_PLACED"), false);
  assert.equal((CLIENT_EVENT_TYPES as readonly string[]).includes("BOOKING_SUBMITTED"), false);
  assert.equal(ClientEventSchema.safeParse({ type: "ORDER_PLACED", page: "CHECKOUT" }).success, false);
  assert.equal(ClientEventSchema.safeParse({ type: "BOOKING_SUBMITTED", page: "HOME" }).success, false);
});

test("privacy: free text, identifiers and unknown fields are rejected outright", () => {
  // Personal data smuggled in extra fields.
  for (const extra of [{ email: "a@b.co" }, { phone: "+27821234567" }, { name: "Thabo" }, { url: "https://x.co/?e=a@b.co" }, { visitorId: "v1" }]) {
    assert.equal(ClientEventSchema.safeParse({ type: "PAGE_VIEW", page: "HOME", ...extra }).success, false, JSON.stringify(extra));
  }
  assert.equal(EventBatchSchema.safeParse({ businessId: UUID, events: [{ type: "PAGE_VIEW", page: "HOME" }], sessionId: "s" }).success, false);
  // Pages/sections are enums, not paths.
  assert.equal(ClientEventSchema.safeParse({ type: "PAGE_VIEW", page: "/store/kota?phone=082" }).success, false);
  assert.equal(ClientEventSchema.safeParse({ type: "CTA_CLICK", page: "HOME", section: "Thabo's button" }).success, false);
  // Item ids are catalogue ids only — no spaces, @, +, etc.
  for (const itemId of ["thabo@mail.co", "+27 82 123 4567", "Thabo Mokoena", "x".repeat(65)]) {
    assert.equal(ClientEventSchema.safeParse({ type: "ADD_TO_BASKET", page: "SHOP", itemId }).success, false, itemId);
  }
  assert.equal(ClientEventSchema.safeParse({ type: "ADD_TO_BASKET", page: "SHOP", itemId: UUID }).success, true);
});

test("privacy: a batch is small and bound to one business", () => {
  const ev = { type: "PAGE_VIEW", page: "HOME" };
  assert.equal(EventBatchSchema.safeParse({ businessId: UUID, events: Array(10).fill(ev) }).success, true);
  assert.equal(EventBatchSchema.safeParse({ businessId: UUID, events: Array(11).fill(ev) }).success, false);
  assert.equal(EventBatchSchema.safeParse({ businessId: UUID, events: [] }).success, false);
  assert.equal(EventBatchSchema.safeParse({ businessId: "not-a-uuid", events: [ev] }).success, false);
  assert.equal(EventBatchSchema.safeParse({ businessId: UUID, device: "iPhone 15", events: [ev] }).success, false);
});


// ---------------------------------------------------------------------------
// Aggregation: day buckets
// ---------------------------------------------------------------------------

test("aggregation: counters bucket by the South African day, not UTC", () => {
  // 23:30 UTC on 4 Oct is 01:30 SAST on 5 Oct.
  assert.equal(storefrontDay(new Date("2026-10-04T23:30:00Z")).toISOString(), "2026-10-05T00:00:00.000Z");
  assert.equal(storefrontDay(new Date("2026-10-04T21:59:59Z")).toISOString(), "2026-10-04T00:00:00.000Z");
  assert.equal(storefrontDay(new Date("2026-10-04T22:00:00Z")).toISOString(), "2026-10-05T00:00:00.000Z");
});

// ---------------------------------------------------------------------------
// Beacon path classification
// ---------------------------------------------------------------------------

test("beacon: storefront paths map to fixed page names, on both URL styles", () => {
  for (const base of ["", "/store/kota"]) {
    assert.deepEqual(classifyStorefrontPath(`${base}/`, base), { page: "HOME" });
    assert.deepEqual(classifyStorefrontPath(`${base}/shop`, base), { page: "SHOP" });
    assert.deepEqual(classifyStorefrontPath(`${base}/product/p1`, base), { page: "PRODUCT", itemId: "p1" });
    assert.deepEqual(classifyStorefrontPath(`${base}/basket`, base), { page: "BASKET" });
    assert.deepEqual(classifyStorefrontPath(`${base}/tag/kota`, base), { page: "TAG" }, "hashtag pages count together; the tag is never sent");
    assert.equal(classifyStorefrontPath(`${base}/tag`, base), null);
    assert.deepEqual(classifyStorefrontPath(`${base}/something-else`, base), { page: "page:something-else" });
    assert.equal(classifyStorefrontPath(`${base}/Something_Else`, base), null);
  }
  assert.deepEqual(classifyStorefrontPath("/store/kota", "/store/kota"), { page: "HOME" });
});

// ---------------------------------------------------------------------------
// Merchant insights
// ---------------------------------------------------------------------------

const row = (event: string, count: number, over: Partial<StatRow> = {}): StatRow => ({ event, page: "HOME", itemId: "", device: "", count, ...over });
const ctx = {
  itemNames: new Map([
    ["p1", "Russian kota"],
    ["p2", "Chips"],
    ["p3", "Cold drink"],
  ]),
  catalogLabel: "Menu",
  mainButton: { label: "Order now", action: "ORDER" },
};

test("insights: nothing is claimed until there are enough visits", () => {
  const few = buildInsights([row("PAGE_VIEW", INSIGHT_MIN_VISITS - 1)], ctx);
  assert.equal(few.enoughData, false);
  assert.deepEqual(few.insights, []);
});

test("insights: plain sentences — top page, top items, main button, phones, checkout", () => {
  const rows = [
    row("PAGE_VIEW", 40, { device: "MOBILE" }),
    row("PAGE_VIEW", 60, { page: "SHOP", device: "MOBILE" }),
    row("PAGE_VIEW", 10, { page: "SHOP", device: "DESKTOP" }),
    row("ADD_TO_BASKET", 9, { page: "SHOP", itemId: "p2" }),
    row("ADD_TO_BASKET", 4, { page: "SHOP", itemId: "p1" }),
    row("ADD_TO_BASKET", 7, { page: "SHOP", itemId: "unknown-or-deleted" }),
    row("CTA_CLICK", 10),
    row("CHECKOUT_START", 5, { page: "BASKET" }),
    row("ORDER_PLACED", 3, { page: "CHECKOUT" }),
  ];
  const out = buildInsights(rows, ctx);
  const text = Object.fromEntries(out.insights.map((i) => [i.key, i.text]));
  assert.equal(out.enoughData, true);
  assert.match(text.TOP_PAGE, /^Your menu page receives the most visits — 70 visits/);
  assert.equal(text.TOP_ITEMS, "Customers interact most with Chips and Russian kota.", "deleted items are skipped, never shown as ids");
  assert.match(text.MAIN_BUTTON, /"Order now"\) was tapped 10 times — about 25% of home page visits/);
  assert.match(text.PHONES, /^91% of your visitors use their phones/);
  assert.equal(text.CHECKOUT, "5 customers started checkout and 3 orders were placed.");
});

test("insights: booking button vs WhatsApp, both ways", () => {
  const booking = { ...ctx, mainButton: { label: "Book now", action: "BOOK" } };
  const more = buildInsights([row("PAGE_VIEW", 50), row("CTA_CLICK", 8), row("ENQUIRY_CLICK", 2)], booking);
  assert.match(more.insights.find((i) => i.key === "BOOKING_VS_ENQUIRY")!.text, /^Your booking button is getting more engagement/);
  const less = buildInsights([row("PAGE_VIEW", 50), row("CTA_CLICK", 1), row("ENQUIRY_CLICK", 9)], booking);
  assert.match(less.insights.find((i) => i.key === "BOOKING_VS_ENQUIRY")!.text, /^More customers are asking on WhatsApp/);
});

test("insights: never mention other businesses or the internal learning system", () => {
  const out = buildInsights([row("PAGE_VIEW", 100, { device: "MOBILE" }), row("CTA_CLICK", 30), row("ADD_TO_BASKET", 5, { itemId: "p1" })], ctx);
  for (const i of out.insights) assert.doesNotMatch(i.text, /other businesses|similar businesses|pattern|template|model|machine/i);
});

// ---------------------------------------------------------------------------
// Pattern learning
// ---------------------------------------------------------------------------

const foodSpec = (): StorefrontSpec => buildRulesSpec(facts("FOOD_VENDOR"), "GENERATE");

test("patterns: a pattern is structure only — the merchant's words, colours and name don't change it", () => {
  const a = foodSpec();
  const b = structuredClone(a);
  b.content.heroHeadline = "Completely different words";
  b.theme.primaryColor = "#123456";
  b.seo.title = "Another business entirely";
  assert.equal(patternSignature(patternFromSpec(a)), patternSignature(patternFromSpec(b)));
  const shape = JSON.stringify(patternFromSpec(a));
  assert.doesNotMatch(shape, /Kota|Soweto|#9A5A0A|kota/i, "no merchant content in a pattern");

  const c = structuredClone(a);
  c.home.sections = [...c.home.sections].reverse();
  assert.notEqual(patternSignature(patternFromSpec(a)), patternSignature(patternFromSpec(c)));
});

function perf(businessId: string, pattern: PatternShape, visits: number, conversions: number): RevisionPerformance {
  return { businessId, pattern, visits, conversions };
}

test("patterns: one successful storefront NEVER becomes a candidate, however well it does", () => {
  const winner = patternFromSpec(foodSpec());
  const other = { ...winner, sections: [...winner.sections].reverse() };
  const rows = [perf("solo", winner, 10_000, 5_000), perf("b2", other, 1000, 10), perf("b3", other, 1000, 10), perf("b4", other, 1000, 10)];
  assert.equal(detectPatterns(rows).some((d) => d.signature === patternSignature(winner)), false);
  // Many revisions of the SAME business still count as one business.
  const sameBusiness = [perf("solo", winner, 500, 100), perf("solo", winner, 500, 100), perf("solo", winner, 500, 100), ...rows.slice(1)];
  assert.equal(detectPatterns(sameBusiness).some((d) => d.signature === patternSignature(winner)), false);
});

test("patterns: a structure that clearly beats its vertical across 3+ businesses becomes a candidate", () => {
  const winner = patternFromSpec(foodSpec());
  const other = { ...winner, sections: [...winner.sections].reverse() };
  const rows = [
    perf("a", winner, 200, 30),
    perf("b", winner, 200, 30),
    perf("c", winner, 200, 30),
    perf("d", other, 600, 30),
    perf("e", other, 600, 30),
  ];
  const detected = detectPatterns(rows);
  assert.equal(detected.length, 1);
  assert.equal(detected[0].signature, patternSignature(winner));
  assert.equal(detected[0].evidence.businesses, 3);
  assert.ok(detected[0].evidence.lift >= 0.15);
  assert.equal(Object.keys(detected[0].evidence).some((k) => /business(Id|es)?Ids?$/.test(k) && k !== "businesses"), false, "evidence names no business");
});

test("patterns: too few visits, or too little lift, is not a candidate", () => {
  const winner = patternFromSpec(foodSpec());
  const other = { ...winner, sections: [...winner.sections].reverse() };
  const tinyVisits = [perf("a", winner, 50, 20), perf("b", winner, 50, 20), perf("c", winner, 50, 20), perf("d", other, 1000, 10)];
  assert.equal(detectPatterns(tinyVisits).length, 0, "150 visits < 300 minimum");
  const noLift = [perf("a", winner, 200, 10), perf("b", winner, 200, 10), perf("c", winner, 200, 10), perf("d", other, 600, 30)];
  assert.equal(detectPatterns(noLift).length, 0, "same rate as the vertical");
});

test("patterns: verticals are compared only with themselves", () => {
  const food = patternFromSpec(foodSpec());
  const salon = { ...food, vertical: "SALON" };
  // Salon does great, but there's no other salon structure to beat: no lift within SALON.
  const rows = [perf("a", salon, 400, 200), perf("b", salon, 400, 200), perf("c", salon, 400, 200), perf("d", food, 1000, 10), perf("e", food, 1000, 10), perf("f", food, 1000, 10)];
  assert.equal(detectPatterns(rows).length, 0);
});

test("patterns: edit signals compare an AI draft with what the merchant published", () => {
  const original = foodSpec();
  const published = structuredClone(original);
  published.content.heroHeadline = "My own words";
  assert.deepEqual(editSignals(original, published), { templateChanged: false, sectionsChanged: false, ctaChanged: false, copyChanged: true });
});

// ---------------------------------------------------------------------------
// Applying an approved pattern to a new draft
// ---------------------------------------------------------------------------

test("approved pattern: reorders sections and switches the action only within what the business can do", () => {
  const f = facts("FOOD_VENDOR");
  const plan = planStorefront(f, "GENERATE");
  const spec = buildRulesSpec(f, "GENERATE");
  const reversed = [...spec.home.sections.map((s) => s.id)].reverse();
  const pattern: PatternShape = { ...patternFromSpec(spec), sections: reversed, ctaAction: "WHATSAPP" };

  const out = applyLearnedPattern(spec, pattern, plan.allowedActions, (a) => defaultCtaLabel(a, plan.template));
  assert.deepEqual(out.home.sections.map((s) => s.id), reversed);
  // Visibility stays the business's own.
  for (const s of out.home.sections) assert.equal(s.visible, spec.home.sections.find((x) => x.id === s.id)!.visible);
  if (plan.allowedActions.includes("WHATSAPP")) assert.equal(out.cta.action, "WHATSAPP");

  const notAllowed = applyLearnedPattern(spec, { ...pattern, ctaAction: "BOOK" }, ["ORDER"], (a) => a);
  assert.equal(notAllowed.cta.action, spec.cta.action, "an action the planner didn't allow is ignored");
});

test("approved pattern: a pattern for another vertical or template is ignored", () => {
  const spec = foodSpec();
  const shape = patternFromSpec(spec);
  const reversed = [...shape.sections].reverse();
  assert.deepEqual(applyLearnedPattern(spec, { ...shape, sections: reversed, vertical: "SALON" }, ["ORDER"], (a) => a), spec);
  assert.deepEqual(applyLearnedPattern(spec, { ...shape, sections: reversed, templateId: "SALON_BOOKING" }, ["ORDER"], (a) => a), spec);
  assert.deepEqual(applyLearnedPattern(spec, null, ["ORDER"], (a) => a), spec);
});

test("approved pattern: GENERATE uses it (rules path + AI prompt hint); ASSIST never does", async () => {
  const f = facts("FOOD_VENDOR");
  const base = buildRulesSpec(f, "GENERATE");
  const reversed = [...base.home.sections.map((s) => s.id)].reverse();
  const pattern: PatternShape = { ...patternFromSpec(base), sections: reversed };

  const generated = await generateSpec(f, "GENERATE", null, pattern);
  assert.deepEqual(generated.spec.home.sections.map((s) => s.id), reversed);
  const assisted = await generateSpec(f, "ASSIST", null, pattern);
  assert.notDeepEqual(assisted.spec.home.sections.map((s) => s.id), reversed);

  const plan = planStorefront(f, "GENERATE");
  assert.match(buildSystemPrompt(f, plan, "GENERATE", patternHint(pattern)), /approved for similar businesses/);
  assert.doesNotMatch(buildSystemPrompt(f, plan, "ASSIST", patternHint(pattern)), /approved for similar businesses/);
});
