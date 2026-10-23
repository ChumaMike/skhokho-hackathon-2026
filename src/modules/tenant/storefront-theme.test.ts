import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { hashPassword } from "@/modules/auth/auth.service";
import { setBusinessCapabilities } from "@/modules/tenant/capabilities";
import { setDeliverySettings } from "@/modules/tenant/capabilities";
import {
  getStorefrontConfig,
  setStorefrontConfig,
  getAvailablePrimaryActions,
  deriveDefaultPrimaryAction,
  resolvePrimaryAction,
  resolveActionEmphasis,
  resolveHeroMode,
  resolveSectionOrder,
  resolveStorefrontTokens,
  DEFAULT_STOREFRONT_THEME,
} from "@/modules/tenant/storefront-theme";
import { contrastRatio, parseHexColor } from "@/lib/storefront-colors";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function makeBusiness(label: string) {
  const { business } = await createBusiness({
    name: `Storefront Theme Test ${label}`,
    category: "FOOD_VENDOR" as never,
    owner: {
      firstName: "Owner",
      lastName: label,
      email: `storefront-theme-owner-${label}-${suffix}@example.test`,
      passwordHash: await hashPassword("SomePassword123"),
    },
  });
  return business;
}

test.after(async () => {
  const businesses = await prisma.business.findMany({
    where: { name: { startsWith: "Storefront Theme Test " } },
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
// Settings safety
// ---------------------------------------------------------------------------

test("a business with no settings resolves to the exact WARM/MINIMAL default with an empty profile", () => {
  const config = getStorefrontConfig({ settings: null });
  assert.equal(config.theme.presetId, "WARM");
  assert.equal(config.theme.heroMode, "MINIMAL");
  assert.deepEqual(config.profile, {});
});

test("setStorefrontConfig merges into settings without disturbing unrelated keys, capabilities, or delivery", async () => {
  const business = await makeBusiness("merge-safety");
  await prisma.business.update({ where: { id: business.id }, data: { settings: { unrelatedKey: "keep-me" } } });
  await setBusinessCapabilities(business.id, ["PRODUCTS", "ORDERS", "LOYALTY"]);
  await setDeliverySettings(business.id, { enabled: true, feeCents: 1500, areaInfo: "Test area" });

  await setStorefrontConfig(business.id, { theme: { presetId: "BOLD" } });

  const updated = await prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { settings: true } });
  const settings = updated.settings as Record<string, unknown>;
  assert.equal(settings.unrelatedKey, "keep-me");
  assert.deepEqual(settings.capabilities, ["PRODUCTS", "ORDERS", "LOYALTY"]);
  // Delivery survives untouched — in its current stored shape (pricingMode + perKmFeeCents always written).
  assert.deepEqual(settings.delivery, { enabled: true, pricingMode: "FLAT", feeCents: 1500, perKmFeeCents: 0, baseFeeCents: 0, minFeeCents: 0, maxDistanceKm: 0, areaInfo: "Test area" });
  assert.equal((settings.storefront as { theme: { presetId: string } }).theme.presetId, "BOLD");
});

test("a theme-only update preserves the existing profile, and a profile-only update preserves the existing theme", async () => {
  const business = await makeBusiness("partial-update");
  await setStorefrontConfig(business.id, { profile: { goal: "ORDERS", differentiator: "We are the best" } });
  await setStorefrontConfig(business.id, { theme: { presetId: "PLAYFUL" } });

  const afterThemeUpdate = await prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { settings: true } });
  const config1 = getStorefrontConfig({ settings: afterThemeUpdate.settings });
  assert.equal(config1.theme.presetId, "PLAYFUL");
  assert.equal(config1.profile.goal, "ORDERS");
  assert.equal(config1.profile.differentiator, "We are the best");

  await setStorefrontConfig(business.id, { profile: { goal: "BOOKINGS" } });
  const afterProfileUpdate = await prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { settings: true } });
  const config2 = getStorefrontConfig({ settings: afterProfileUpdate.settings });
  assert.equal(config2.theme.presetId, "PLAYFUL", "theme must survive a profile-only update");
  assert.equal(config2.profile.goal, "BOOKINGS");
});

test("setStorefrontConfig throws on an unknown presetId, heroMode, or primaryAction", async () => {
  const business = await makeBusiness("invalid-enum");
  await assert.rejects(() => setStorefrontConfig(business.id, { theme: { presetId: "GARBAGE" as never } }));
  await assert.rejects(() => setStorefrontConfig(business.id, { theme: { heroMode: "GARBAGE" as never } }));
  await assert.rejects(() => setStorefrontConfig(business.id, { theme: { primaryAction: "GARBAGE" as never } }));
});

test("selecting a preset (the merged wizard step) persists profile.feeling as the same presetId — desiredFeeling is derived, never a second question", async () => {
  const business = await makeBusiness("feeling-derived-from-preset");
  await setStorefrontConfig(business.id, { theme: { presetId: "PLAYFUL" }, profile: { feeling: "PLAYFUL" } });
  const saved = await prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { settings: true } });
  const config = getStorefrontConfig({ settings: saved.settings });
  assert.equal(config.theme.presetId, "PLAYFUL");
  assert.equal(config.profile.feeling, "PLAYFUL");
  assert.equal(config.profile.feeling, config.theme.presetId);
});

test("getStorefrontConfig never throws on a malformed or legacy settings.storefront blob", () => {
  assert.doesNotThrow(() => getStorefrontConfig({ settings: { storefront: "not-an-object" } }));
  assert.doesNotThrow(() => getStorefrontConfig({ settings: { storefront: { theme: { presetId: 12345 } } } }));
  assert.doesNotThrow(() => getStorefrontConfig({ settings: { storefront: { theme: { presetId: "NOT_REAL" } } } }));
  const config = getStorefrontConfig({ settings: { storefront: { theme: { presetId: "NOT_REAL" } } } });
  assert.equal(config.theme.presetId, "WARM");
});

// ---------------------------------------------------------------------------
// Capabilities / primary action
// ---------------------------------------------------------------------------

test("getAvailablePrimaryActions never includes ORDER without PRODUCTS+ORDERS, or BOOK without SERVICES+BOOKINGS", () => {
  const noOrders = getAvailablePrimaryActions(new Set(["SERVICES", "BOOKINGS"]), {});
  assert.ok(!noOrders.includes("ORDER"));
  assert.ok(noOrders.includes("BOOK"));

  const noBookings = getAvailablePrimaryActions(new Set(["PRODUCTS", "ORDERS"]), {});
  assert.ok(!noBookings.includes("BOOK"));
  assert.ok(noBookings.includes("ORDER"));
});

test("getAvailablePrimaryActions never includes WHATSAPP without a whatsapp number, or CALL without a phone", () => {
  const noContact = getAvailablePrimaryActions(new Set(), {});
  assert.ok(!noContact.includes("WHATSAPP"));
  assert.ok(!noContact.includes("CALL"));

  const withContact = getAvailablePrimaryActions(new Set(), { whatsapp: "+27821234567", phone: "0821234567" });
  assert.ok(withContact.includes("WHATSAPP"));
  assert.ok(withContact.includes("CALL"));
});

test("getAvailablePrimaryActions always includes BROWSE as a fallback", () => {
  assert.ok(getAvailablePrimaryActions(new Set(), {}).includes("BROWSE"));
});

test("deriveDefaultPrimaryAction never returns an action the business can't fulfil", () => {
  assert.equal(deriveDefaultPrimaryAction(new Set(["PRODUCTS", "ORDERS"]), {}), "ORDER");
  assert.equal(deriveDefaultPrimaryAction(new Set(["SERVICES", "BOOKINGS"]), {}), "BOOK");
  assert.equal(deriveDefaultPrimaryAction(new Set(), { whatsapp: "+27821234567" }), "WHATSAPP");
  assert.equal(deriveDefaultPrimaryAction(new Set(), { phone: "0821234567" }), "CALL");
  assert.equal(deriveDefaultPrimaryAction(new Set(), { address: "1 Main Street" }), "VISIT");
  assert.equal(deriveDefaultPrimaryAction(new Set(), {}), "BROWSE");
});

// ---------------------------------------------------------------------------
// Hero / section order / tokens
// ---------------------------------------------------------------------------

test("resolveHeroMode falls back IMAGE -> COLOUR when there is no bannerUrl", () => {
  assert.equal(resolveHeroMode({ version: 1, presetId: "WARM", heroMode: "IMAGE" }, { bannerUrl: null }), "COLOUR");
  assert.equal(resolveHeroMode({ version: 1, presetId: "WARM", heroMode: "IMAGE" }, { bannerUrl: "https://example.test/banner.jpg" }), "IMAGE");
  assert.equal(resolveHeroMode({ version: 1, presetId: "WARM", heroMode: "MINIMAL" }, { bannerUrl: null }), "MINIMAL");
});

test("resolveSectionOrder never places REVIEWS before PRODUCTS or SERVICES", () => {
  const commerceFirst = resolveSectionOrder({});
  const storyFirst = resolveSectionOrder({ sectionEmphasis: "ABOUT" });
  for (const order of [commerceFirst, storyFirst]) {
    const reviewsIndex = order.indexOf("REVIEWS");
    const productsIndex = order.indexOf("PRODUCTS");
    const servicesIndex = order.indexOf("SERVICES");
    assert.ok(reviewsIndex > productsIndex);
    assert.ok(reviewsIndex > servicesIndex);
  }
});

test("resolveStorefrontTokens for a no-config business produces the exact WARM/MINIMAL token set (backward-compat lock)", () => {
  const tokens = resolveStorefrontTokens(
    { primaryColor: null, accentColor: null },
    getStorefrontConfig({ settings: null }),
  );
  assert.equal(tokens["--store-radius-card"], "14px");
  assert.equal(tokens["--store-radius-button"], "10px");
  assert.equal(tokens["--store-space-unit"], "16px");
  assert.equal(tokens["--store-card-border-width"], "1px");
  assert.equal(tokens["--store-primary"], "#E8A020");
});

// ---------------------------------------------------------------------------
// System-theme independence (visual-acceptance-fix item 6)
// ---------------------------------------------------------------------------

test("resolveStorefrontTokens always emits fixed --store-page-* neutrals, identical regardless of merchant colour input", () => {
  const configA = resolveStorefrontTokens({ primaryColor: "#000000", accentColor: "#FFFFFF" }, getStorefrontConfig({ settings: null }))
  const configB = resolveStorefrontTokens({ primaryColor: "#FF00FF", accentColor: "#00FFFF" }, getStorefrontConfig({ settings: null }))
  for (const key of ["--store-page-bg", "--store-page-fg", "--store-page-muted", "--store-page-border", "--store-page-accent"]) {
    assert.ok(configA[key], `${key} must be present`)
    assert.equal(configA[key], configB[key], `${key} must not vary with merchant colour`)
  }
})

test("--store-page-bg/-fg exactly match STOREFRONT_LIGHT/STOREFRONT_DARK as hex — never the dashboard's --ink/--chalk, which flip under prefers-color-scheme", () => {
  const tokens = resolveStorefrontTokens({ primaryColor: null, accentColor: null }, getStorefrontConfig({ settings: null }))
  assert.equal(tokens["--store-page-bg"], "#F8F5EE")
  assert.equal(tokens["--store-page-fg"], "#23201B")
})

test("the fixed --store-page-muted and --store-page-accent both clear 4.5:1 against --store-page-bg", () => {
  const tokens = resolveStorefrontTokens({ primaryColor: null, accentColor: null }, getStorefrontConfig({ settings: null }))
  const bg = parseHexColor(tokens["--store-page-bg"])!
  for (const key of ["--store-page-muted", "--store-page-accent"]) {
    const ratio = contrastRatio(parseHexColor(tokens[key])!, bg)
    assert.ok(ratio >= 4.5, `${key} contrast against --store-page-bg was ${ratio}, expected >= 4.5`)
  }
})

test("a no-config business's action tokens default to the same primary-coloured Order CTA as today, and ORDER resolves as the primary action", () => {
  const config = getStorefrontConfig({ settings: null });
  const tokens = resolveStorefrontTokens({ primaryColor: null, accentColor: null }, config);
  assert.equal(tokens["--store-action-primary"], tokens["--store-primary-safe"]);
  assert.equal(tokens["--store-action-primary-foreground"], tokens["--store-on-primary"]);
  assert.equal(tokens["--store-action-secondary"], tokens["--store-accent-safe"]);

  const resolved = resolvePrimaryAction(config.theme, new Set(["PRODUCTS", "ORDERS"]), {});
  assert.equal(resolved, "ORDER");
  assert.deepEqual(resolveActionEmphasis(resolved), { order: "primary", book: "secondary" });
});

// ---------------------------------------------------------------------------
// Semantic action colours / CTA hierarchy
// ---------------------------------------------------------------------------

test("resolveActionEmphasis: ORDER makes the product CTA primary and the service CTA secondary", () => {
  assert.deepEqual(resolveActionEmphasis("ORDER"), { order: "primary", book: "secondary" });
});

test("resolveActionEmphasis: BOOK makes the service CTA primary and the product CTA secondary — a Salon can make Booking the strongest action", () => {
  assert.deepEqual(resolveActionEmphasis("BOOK"), { order: "secondary", book: "primary" });
});

test("resolveActionEmphasis: neither Order nor Book is promoted to primary when the resolved action is unrelated to either domain (e.g. WHATSAPP) — both stay secondary, useful alternatives", () => {
  for (const action of ["WHATSAPP", "CALL", "VISIT", "LOYALTY", "BROWSE"] as const) {
    assert.deepEqual(resolveActionEmphasis(action), { order: "secondary", book: "secondary" });
  }
});

test("resolvePrimaryAction: a saved WHATSAPP choice falls back deterministically when there is no usable WhatsApp number", () => {
  const capabilities = new Set(["PRODUCTS", "ORDERS"] as const);
  const resolved = resolvePrimaryAction(
    { ...DEFAULT_STOREFRONT_THEME, primaryAction: "WHATSAPP" },
    capabilities,
    { whatsapp: null },
  );
  assert.notEqual(resolved, "WHATSAPP");
  assert.equal(resolved, "ORDER", "falls back to the same deterministic priority deriveDefaultPrimaryAction already uses");
});

test("resolvePrimaryAction: an invalid/unrecognised saved primary action falls back safely instead of throwing or resolving to garbage", () => {
  const capabilities = new Set(["PRODUCTS", "ORDERS"] as const);
  const resolved = resolvePrimaryAction(
    { ...DEFAULT_STOREFRONT_THEME, primaryAction: "NOT_A_REAL_ACTION" as never },
    capabilities,
    {},
  );
  assert.equal(resolved, "ORDER");
});

test("resolvePrimaryAction: capability removal cannot leave a dead primary CTA — a saved BOOK falls back once BOOKINGS is removed", () => {
  const capabilitiesWithoutBookings = new Set(["PRODUCTS", "ORDERS"] as const);
  const resolved = resolvePrimaryAction(
    { ...DEFAULT_STOREFRONT_THEME, primaryAction: "BOOK" },
    capabilitiesWithoutBookings,
    {},
  );
  assert.notEqual(resolved, "BOOK");
  assert.equal(resolved, "ORDER");
});

test("resolvePrimaryAction: a saved action that is STILL available is honoured, not overridden", () => {
  const capabilities = new Set(["SERVICES", "BOOKINGS"] as const);
  const resolved = resolvePrimaryAction({ ...DEFAULT_STOREFRONT_THEME, primaryAction: "BOOK" }, capabilities, {});
  assert.equal(resolved, "BOOK");
});

test("primary and secondary action foreground/background pairs meet WCAG AA 4.5:1, for both a normal colour and the mid-gray boundary case", () => {
  for (const primaryColor of ["#E8A020", "#808080", "#050505", "#FEFEFE"]) {
    const tokens = resolveStorefrontTokens({ primaryColor, accentColor: "#808080" }, getStorefrontConfig({ settings: null }));
    const primaryBg = parseHexColor(tokens["--store-action-primary"])!;
    const primaryFg = parseHexColor(tokens["--store-action-primary-foreground"])!;
    const secondaryBg = parseHexColor(tokens["--store-action-secondary"])!;
    const secondaryFg = parseHexColor(tokens["--store-action-secondary-foreground"])!;
    assert.ok(contrastRatio(primaryBg, primaryFg) >= 4.5, `primary pair failed contrast for primaryColor ${primaryColor}`);
    assert.ok(contrastRatio(secondaryBg, secondaryFg) >= 4.5, "secondary pair failed contrast");
  }
});

test("the theme engine never emits operational/state colour tokens — errors, warnings, success, and order status stay independent of merchant branding", () => {
  const tokens = resolveStorefrontTokens({ primaryColor: "#E8A020", accentColor: "#F59E0B" }, getStorefrontConfig({ settings: null }));
  const keys = Object.keys(tokens).map((k) => k.toLowerCase());
  for (const forbidden of ["error", "warning", "success", "status", "danger"]) {
    assert.ok(!keys.some((k) => k.includes(forbidden)), `token set must never include a "${forbidden}" key`);
  }
});

// ---------------------------------------------------------------------------
// Interview-answer classification (documents which answers currently affect
// rendered output vs. are stored as future context only — see the
// hardening-pass report's classification table)
// ---------------------------------------------------------------------------

test("Category C answers (voiceTone, differentiator, goal) never change resolveStorefrontTokens/resolveHeroMode/resolveSectionOrder output", () => {
  const baseConfig = getStorefrontConfig({ settings: null });
  const withCategoryC = {
    ...baseConfig,
    profile: { ...baseConfig.profile, voiceTone: "PLAYFUL" as const, differentiator: "We are unique", goal: "ORDERS" as const },
  };
  const business = { primaryColor: "#123456", accentColor: "#654321", bannerUrl: "https://example.test/b.jpg" };

  assert.deepEqual(resolveStorefrontTokens(business, baseConfig), resolveStorefrontTokens(business, withCategoryC));
  assert.equal(resolveHeroMode(baseConfig.theme, business), resolveHeroMode(withCategoryC.theme, business));
  assert.deepEqual(resolveSectionOrder(baseConfig.profile), resolveSectionOrder(withCategoryC.profile));
});

test("Category A answer (sectionEmphasis) DOES change resolveSectionOrder output, unlike the Category C answers above", () => {
  const baseConfig = getStorefrontConfig({ settings: null });
  const withEmphasis = { ...baseConfig.profile, sectionEmphasis: "ABOUT" as const };
  assert.notDeepEqual(resolveSectionOrder(baseConfig.profile), resolveSectionOrder(withEmphasis));
});
