import test from "node:test";
import assert from "node:assert/strict";
import { getStorefrontConfig } from "@/modules/tenant/storefront-theme";
import { getStorefrontRecommendations } from "@/modules/tenant/storefront-recommendations";
import { getBusinessExperience } from "@/modules/tenant/business-experience";

const NO_DELIVERY = { enabled: false, pricingMode: "FLAT" as const, feeCents: 0, perKmFeeCents: 0, baseFeeCents: 0, minFeeCents: 0, maxDistanceKm: 0 };
const BASE_STOREFRONT = getStorefrontConfig({ settings: null });

function baseInput(overrides: Partial<Parameters<typeof getStorefrontRecommendations>[0]> = {}) {
  return {
    business: {},
    capabilities: new Set(["PRODUCTS", "ORDERS"] as const),
    storefront: BASE_STOREFRONT,
    delivery: NO_DELIVERY,
    products: [],
    services: [],
    ...overrides,
  };
}

test("missing logo is unresolved, and resolves once logoUrl is set", () => {
  const withoutLogo = getStorefrontRecommendations(baseInput());
  const missingLogo = withoutLogo.find((r) => r.type === "MISSING_LOGO");
  assert.ok(missingLogo);
  assert.equal(missingLogo!.resolved, false);

  const withLogo = getStorefrontRecommendations(baseInput({ business: { logoUrl: "https://example.test/logo.png" } }));
  assert.equal(withLogo.find((r) => r.type === "MISSING_LOGO")!.resolved, true);
});

test("WHATSAPP_ACTION_NO_NUMBER is entirely absent (not just resolved) when WhatsApp isn't the primary action", () => {
  const orderPrimary = getStorefrontRecommendations(
    baseInput({ storefront: { ...BASE_STOREFRONT, theme: { ...BASE_STOREFRONT.theme, primaryAction: "ORDER" } } }),
  );
  assert.ok(!orderPrimary.some((r) => r.type === "WHATSAPP_ACTION_NO_NUMBER"));
});

test("WHATSAPP_ACTION_NO_NUMBER appears and is unresolved when WhatsApp is primary but no number is set, resolves once set", () => {
  const withWhatsappPrimary = (whatsapp?: string) =>
    getStorefrontRecommendations(
      baseInput({
        business: { whatsapp },
        storefront: { ...BASE_STOREFRONT, theme: { ...BASE_STOREFRONT.theme, primaryAction: "WHATSAPP" } },
      }),
    );
  assert.equal(withWhatsappPrimary(undefined).find((r) => r.type === "WHATSAPP_ACTION_NO_NUMBER")!.resolved, false);
  assert.equal(withWhatsappPrimary("+27821234567").find((r) => r.type === "WHATSAPP_ACTION_NO_NUMBER")!.resolved, true);
});

test("DELIVERY_NO_AREA_INFO is absent without the DELIVERY capability, and resolves once areaInfo is set", () => {
  const noDeliveryCapability = getStorefrontRecommendations(baseInput({ capabilities: new Set(["PRODUCTS", "ORDERS"]) }));
  assert.ok(!noDeliveryCapability.some((r) => r.type === "DELIVERY_NO_AREA_INFO"));

  const withDeliveryNoArea = getStorefrontRecommendations(
    baseInput({
      capabilities: new Set(["PRODUCTS", "ORDERS", "DELIVERY"]),
      delivery: { enabled: true, pricingMode: "FLAT", feeCents: 2000, perKmFeeCents: 0, baseFeeCents: 0, minFeeCents: 0, maxDistanceKm: 0 },
    }),
  );
  assert.equal(withDeliveryNoArea.find((r) => r.type === "DELIVERY_NO_AREA_INFO")!.resolved, false);

  const withDeliveryAndArea = getStorefrontRecommendations(
    baseInput({
      capabilities: new Set(["PRODUCTS", "ORDERS", "DELIVERY"]),
      delivery: { enabled: true, pricingMode: "FLAT", feeCents: 2000, perKmFeeCents: 0, baseFeeCents: 0, minFeeCents: 0, maxDistanceKm: 0, areaInfo: "Soweto only" },
    }),
  );
  assert.equal(withDeliveryAndArea.find((r) => r.type === "DELIVERY_NO_AREA_INFO")!.resolved, true);
});

test("no recommendation's type or message ever references reviews", () => {
  const all = getStorefrontRecommendations(
    baseInput({ capabilities: new Set(["PRODUCTS", "ORDERS", "SERVICES", "BOOKINGS", "DELIVERY"]) }),
  );
  for (const rec of all) {
    assert.ok(!rec.type.toLowerCase().includes("review"));
    assert.ok(!rec.message.toLowerCase().includes("review"));
  }
});

test("EMPTY_CATALOGUE resolves as soon as either a product or a service exists", () => {
  const empty = getStorefrontRecommendations(baseInput());
  assert.equal(empty.find((r) => r.type === "EMPTY_CATALOGUE")!.resolved, false);

  const withProduct = getStorefrontRecommendations(baseInput({ products: [{ imageUrl: null }] }));
  assert.equal(withProduct.find((r) => r.type === "EMPTY_CATALOGUE")!.resolved, true);

  const withService = getStorefrontRecommendations(
    baseInput({ capabilities: new Set(["SERVICES", "BOOKINGS"]), services: [{ imageUrl: null }] }),
  );
  assert.equal(withService.find((r) => r.type === "EMPTY_CATALOGUE")!.resolved, true);
});

test("PRODUCT_IMAGES_MISSING is absent for a business with no PRODUCTS capability or an empty catalogue, present and correctly resolved otherwise", () => {
  const noCapability = getStorefrontRecommendations(baseInput({ capabilities: new Set(["SERVICES", "BOOKINGS"]) }));
  assert.ok(!noCapability.some((r) => r.type === "PRODUCT_IMAGES_MISSING"));

  const emptyCatalogue = getStorefrontRecommendations(baseInput({ products: [] }));
  assert.ok(!emptyCatalogue.some((r) => r.type === "PRODUCT_IMAGES_MISSING"));

  const missingImage = getStorefrontRecommendations(baseInput({ products: [{ imageUrl: null }, { imageUrl: "x.jpg" }] }));
  assert.equal(missingImage.find((r) => r.type === "PRODUCT_IMAGES_MISSING")!.resolved, false);

  const allImaged = getStorefrontRecommendations(baseInput({ products: [{ imageUrl: "a.jpg" }, { imageUrl: "b.jpg" }] }));
  assert.equal(allImaged.find((r) => r.type === "PRODUCT_IMAGES_MISSING")!.resolved, true);
});

test("PRODUCT_IMAGES_MISSING message adapts to business terminology and includes a real count, not a generic 'Some products' string", () => {
  const foodExperience = getBusinessExperience("FOOD_VENDOR");
  const missingTwo = getStorefrontRecommendations(
    baseInput({
      products: [{ imageUrl: null }, { imageUrl: null }, { imageUrl: "x.jpg" }],
      experience: foodExperience,
    }),
  );
  const message = missingTwo.find((r) => r.type === "PRODUCT_IMAGES_MISSING")!.message;
  assert.equal(message, "2 menu items have no photo yet.");
});

test("PRODUCT_IMAGES_MISSING singular count reads naturally ('1 menu item has', not '1 menu items have')", () => {
  const foodExperience = getBusinessExperience("FOOD_VENDOR");
  const missingOne = getStorefrontRecommendations(
    baseInput({ products: [{ imageUrl: null }, { imageUrl: "x.jpg" }], experience: foodExperience }),
  );
  const message = missingOne.find((r) => r.type === "PRODUCT_IMAGES_MISSING")!.message;
  assert.equal(message, "1 menu item has no photo yet.");
});

test("EMPTY_CATALOGUE adapts to terminology and to which of PRODUCTS/SERVICES is actually available — never mentions a domain the business doesn't have", () => {
  const salonExperience = getBusinessExperience("SALON");
  const servicesOnly = getStorefrontRecommendations(
    baseInput({ capabilities: new Set(["SERVICES", "BOOKINGS"]), experience: salonExperience }),
  );
  const message = servicesOnly.find((r) => r.type === "EMPTY_CATALOGUE")!.message;
  assert.ok(message.includes("service"));
  assert.ok(!message.includes("product"), "a Services-only business must never be told to add a 'product'");

  const foodExperience = getBusinessExperience("FOOD_VENDOR");
  const productsOnly = getStorefrontRecommendations(
    baseInput({ capabilities: new Set(["PRODUCTS", "ORDERS"]), experience: foodExperience }),
  );
  assert.ok(productsOnly.find((r) => r.type === "EMPTY_CATALOGUE")!.message.includes("menu item"));
});

test("omitting experience entirely keeps the pre-Storefront-Console generic wording (backward compatible)", () => {
  const missing = getStorefrontRecommendations(baseInput({ products: [{ imageUrl: null }] }));
  assert.equal(missing.find((r) => r.type === "PRODUCT_IMAGES_MISSING")!.message, "1 product has no photo yet.");
});

test("VISIT_ACTION_NO_LOCATION is absent unless VISIT is the primary action", () => {
  const orderPrimary = getStorefrontRecommendations(
    baseInput({ storefront: { ...BASE_STOREFRONT, theme: { ...BASE_STOREFRONT.theme, primaryAction: "ORDER" } } }),
  );
  assert.ok(!orderPrimary.some((r) => r.type === "VISIT_ACTION_NO_LOCATION"));

  const visitPrimaryNoAddress = getStorefrontRecommendations(
    baseInput({ storefront: { ...BASE_STOREFRONT, theme: { ...BASE_STOREFRONT.theme, primaryAction: "VISIT" } } }),
  );
  assert.equal(visitPrimaryNoAddress.find((r) => r.type === "VISIT_ACTION_NO_LOCATION")!.resolved, false);

  const visitPrimaryWithAddress = getStorefrontRecommendations(
    baseInput({
      business: { city: "Johannesburg" },
      storefront: { ...BASE_STOREFRONT, theme: { ...BASE_STOREFRONT.theme, primaryAction: "VISIT" } },
    }),
  );
  assert.equal(visitPrimaryWithAddress.find((r) => r.type === "VISIT_ACTION_NO_LOCATION")!.resolved, true);
});

test("TRY_NEW_STOREFRONT_DESIGN is omitted entirely when templateSelection isn't passed — existing callers unaffected", () => {
  const withoutSelection = getStorefrontRecommendations(baseInput());
  assert.ok(!withoutSelection.some((r) => r.type === "TRY_NEW_STOREFRONT_DESIGN"));
});

test("TRY_NEW_STOREFRONT_DESIGN is unresolved for CLASSIC or no profile row, resolved for any other template", () => {
  const onClassic = getStorefrontRecommendations(baseInput({ templateSelection: { activeTemplateId: "CLASSIC" } }));
  assert.equal(onClassic.find((r) => r.type === "TRY_NEW_STOREFRONT_DESIGN")!.resolved, false);

  const noProfileRow = getStorefrontRecommendations(baseInput({ templateSelection: { activeTemplateId: null } }));
  assert.equal(noProfileRow.find((r) => r.type === "TRY_NEW_STOREFRONT_DESIGN")!.resolved, false);

  const onFoodMenu = getStorefrontRecommendations(baseInput({ templateSelection: { activeTemplateId: "FOOD_MENU" } }));
  assert.equal(onFoodMenu.find((r) => r.type === "TRY_NEW_STOREFRONT_DESIGN")!.resolved, true);

  const generated = getStorefrontRecommendations(baseInput({ templateSelection: { activeTemplateId: "GENERATED" } }));
  assert.equal(generated.find((r) => r.type === "TRY_NEW_STOREFRONT_DESIGN")!.resolved, true);
});
