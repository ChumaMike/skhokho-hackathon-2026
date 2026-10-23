import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { hashPassword } from "@/modules/auth/auth.service";
import { setBusinessCapabilities } from "@/modules/tenant/capabilities";
import { setDeliverySettings } from "@/modules/tenant/capabilities";
import {
  getStorefrontContent,
  setStorefrontContent,
  computeTrustBarFacts,
  validateGeneratedContent,
  MAX_HEADLINE_LENGTH,
  MAX_SUBHEADLINE_LENGTH,
  MAX_ABOUT_BODY_LENGTH,
  MAX_HIGHLIGHT_ITEM_LENGTH,
  MAX_HIGHLIGHT_ITEMS,
} from "@/modules/tenant/storefront-content";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function makeBusiness(label: string) {
  const { business } = await createBusiness({
    name: `Storefront Content Test ${label}`,
    category: "FOOD_VENDOR" as never,
    owner: {
      firstName: "Owner",
      lastName: label,
      email: `storefront-content-owner-${label}-${suffix}@example.test`,
      passwordHash: await hashPassword("SomePassword123"),
    },
  });
  return business;
}

test.after(async () => {
  const businesses = await prisma.business.findMany({
    where: { name: { startsWith: "Storefront Content Test " } },
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
// Settings safety — a business with no settings must render exactly as it
// did before this module existed.
// ---------------------------------------------------------------------------

test("a business with no settings resolves to the empty default — hero/about/highlights all absent", () => {
  const content = getStorefrontContent({ settings: null });
  assert.deepEqual(content, { version: 1, hero: {}, about: {}, highlights: { items: [] }, process: [] });
});

test("malformed settings.storefrontContent (wrong shape, garbage) resolves to the empty default rather than throwing", () => {
  assert.deepEqual(getStorefrontContent({ settings: { storefrontContent: "not an object" } }).hero, {});
  assert.deepEqual(getStorefrontContent({ settings: { storefrontContent: 42 } }).about, {});
  assert.deepEqual(getStorefrontContent({ settings: { storefrontContent: { highlights: "not an array wrapper" } } }).highlights, { items: [] });
});

test("getStorefrontContent sanitizes on read: strips fields over the length cap, drops non-string items", () => {
  const content = getStorefrontContent({
    settings: {
      storefrontContent: {
        hero: { headline: "x".repeat(200), subheadline: "y".repeat(200) },
        about: { body: "z".repeat(1000) },
        highlights: { items: ["real one", 42, null, "real two", "real three", "real four", "real five (over cap)"] },
      },
    },
  });
  assert.equal(content.hero.headline!.length, MAX_HEADLINE_LENGTH);
  assert.equal(content.hero.subheadline!.length, MAX_SUBHEADLINE_LENGTH);
  assert.equal(content.about.body!.length, MAX_ABOUT_BODY_LENGTH);
  assert.deepEqual(content.highlights.items, ["real one", "real two", "real three", "real four"]);
  assert.equal(content.highlights.items.length, MAX_HIGHLIGHT_ITEMS);
});

test("an empty/whitespace-only string resolves the same as an absent field — never an empty-but-present string", () => {
  const content = getStorefrontContent({ settings: { storefrontContent: { hero: { headline: "   " }, about: { body: "" } } } });
  assert.equal(content.hero.headline, undefined);
  assert.equal(content.about.body, undefined);
});

// ---------------------------------------------------------------------------
// setStorefrontContent — merge-only, sanitizes on write too, real DB round trip
// ---------------------------------------------------------------------------

test("setStorefrontContent merges into settings without disturbing unrelated keys, capabilities, or delivery", async () => {
  const business = await makeBusiness("merge-safety");
  await prisma.business.update({ where: { id: business.id }, data: { settings: { unrelatedKey: "keep-me" } } });
  await setBusinessCapabilities(business.id, ["PRODUCTS", "ORDERS", "LOYALTY"]);
  await setDeliverySettings(business.id, { enabled: true, feeCents: 1500, areaInfo: "Test area" });

  await setStorefrontContent(business.id, { hero: { headline: "Real headline" } });

  const updated = await prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { settings: true } });
  const settings = updated.settings as Record<string, unknown>;
  assert.equal(settings.unrelatedKey, "keep-me");
  assert.deepEqual(settings.capabilities, ["PRODUCTS", "ORDERS", "LOYALTY"]);
  // Delivery survives untouched — in its current stored shape (pricingMode + perKmFeeCents always written).
  assert.deepEqual(settings.delivery, { enabled: true, pricingMode: "FLAT", feeCents: 1500, perKmFeeCents: 0, baseFeeCents: 0, minFeeCents: 0, maxDistanceKm: 0, areaInfo: "Test area" });
  assert.equal((settings.storefrontContent as { hero: { headline: string } }).hero.headline, "Real headline");
});

test("setStorefrontContent merges hero/about/highlights independently — updating one never wipes the others", async () => {
  const business = await makeBusiness("independent-merge");

  await setStorefrontContent(business.id, { hero: { headline: "Headline one" }, about: { body: "About body" } });
  await setStorefrontContent(business.id, { highlights: { items: ["Reason one"] } });

  const content = getStorefrontContent(await prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { settings: true } }));
  assert.equal(content.hero.headline, "Headline one");
  assert.equal(content.about.body, "About body");
  assert.deepEqual(content.highlights.items, ["Reason one"]);
});

test("setStorefrontContent sanitizes on write too — oversized/garbage input is never trusted to already be clean", async () => {
  const business = await makeBusiness("write-sanitize");

  await setStorefrontContent(business.id, {
    hero: { headline: "h".repeat(500) },
    highlights: { items: Array.from({ length: 10 }, (_, i) => `item ${i}`) },
  });

  const content = getStorefrontContent(await prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { settings: true } }));
  assert.equal(content.hero.headline!.length, MAX_HEADLINE_LENGTH);
  assert.equal(content.highlights.items.length, MAX_HIGHLIGHT_ITEMS);
});

test("a highlight item over the per-item length cap is truncated, never dropped entirely", async () => {
  const business = await makeBusiness("item-length-cap");
  await setStorefrontContent(business.id, { highlights: { items: ["x".repeat(500)] } });

  const content = getStorefrontContent(await prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { settings: true } }));
  assert.equal(content.highlights.items.length, 1);
  assert.equal(content.highlights.items[0].length, MAX_HIGHLIGHT_ITEM_LENGTH);
});

// ---------------------------------------------------------------------------
// computeTrustBarFacts — the ONLY source of trust-bar content; every fact
// must be derived from real, structurally-verifiable data, never a number.
// ---------------------------------------------------------------------------

test("computeTrustBarFacts returns [] for a business with no relevant capabilities or contact info", () => {
  assert.deepEqual(computeTrustBarFacts(new Set(["PRODUCTS", "ORDERS"]), {}), []);
});

test("computeTrustBarFacts reflects exactly the real capabilities/contact info present, nothing invented", () => {
  const facts = computeTrustBarFacts(new Set(["PRODUCTS", "ORDERS", "DELIVERY", "PICKUP", "BOOKINGS", "LOYALTY"]), {
    whatsapp: "+27821234567",
  });
  const labels = facts.map((f) => f.label);
  assert.deepEqual(labels, ["Delivery available", "Collection available", "Book online", "Order via WhatsApp", "Loyalty rewards"]);
});

test("computeTrustBarFacts never mentions WhatsApp when no number is set, even if other capabilities are present", () => {
  const facts = computeTrustBarFacts(new Set(["DELIVERY"]), { whatsapp: null });
  assert.deepEqual(facts, [{ label: "Delivery available" }]);
});

// ---------------------------------------------------------------------------
// validateGeneratedContent — the gate between an AI response and an owner's
// review screen. Reuses the same sanitizers as real stored data, so a
// generated blob is never trusted more than hand-typed input.
// ---------------------------------------------------------------------------

test("validateGeneratedContent returns null for a non-object (genuinely broken model response)", () => {
  assert.equal(validateGeneratedContent("not an object"), null);
  assert.equal(validateGeneratedContent(null), null);
  assert.equal(validateGeneratedContent(42), null);
});

test("validateGeneratedContent returns null when every field sanitizes away to nothing — an empty generation isn't useful", () => {
  assert.equal(validateGeneratedContent({}), null);
  assert.equal(validateGeneratedContent({ hero: {}, about: {}, highlights: { items: [] } }), null);
  assert.equal(validateGeneratedContent({ hero: { headline: "   " } }), null);
});

test("validateGeneratedContent accepts a genuinely partial result — a real headline alone is still useful", () => {
  const result = validateGeneratedContent({ hero: { headline: "Real headline" } });
  assert.equal(result!.hero.headline, "Real headline");
  assert.equal(result!.hero.subheadline, undefined);
  assert.deepEqual(result!.about, {});
  assert.deepEqual(result!.highlights, { items: [] });
});

test("validateGeneratedContent applies the exact same length/count caps as real stored data — a model can't bypass them", () => {
  const result = validateGeneratedContent({
    hero: { headline: "h".repeat(500) },
    highlights: { items: Array.from({ length: 10 }, (_, i) => `item ${i}`) },
  });
  assert.equal(result!.hero.headline!.length, MAX_HEADLINE_LENGTH);
  assert.equal(result!.highlights.items.length, MAX_HIGHLIGHT_ITEMS);
});
