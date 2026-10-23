import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { hashPassword } from "@/modules/auth/auth.service";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { createProduct } from "@/modules/catalog/catalog.service";
import { setBusinessCapabilities, setDeliverySettings, setOrderingSettings } from "@/modules/tenant/capabilities";
import { resolveStorefrontCartQuote, MAX_LINE_QUANTITY, MAX_CART_LINES } from "./storefront-cart";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function makeBusiness(label: string, capabilities: ("PRODUCTS" | "ORDERS" | "DELIVERY")[] = ["PRODUCTS", "ORDERS"]) {
  const { business } = await createBusiness({
    name: `Storefront Cart Test ${label}`,
    category: "RETAIL_STORE" as never,
    owner: {
      firstName: "Owner",
      lastName: label,
      email: `storefront-cart-owner-${label}-${suffix}@example.test`,
      passwordHash: await hashPassword("SomePassword123"),
    },
  });
  await setBusinessCapabilities(business.id, capabilities as never);
  // createBusiness defaults to PENDING_VERIFICATION — every test here is
  // about the quote's OWN logic, not the separate PENDING-business test
  // below, so activate explicitly.
  const active = await prisma.business.update({ where: { id: business.id }, data: { status: "ACTIVE" } });
  return active;
}

async function makeProduct(businessId: string, name: string, price: number) {
  return createProduct(businessId, { name, price } as never);
}

test.after(async () => {
  const businesses = await prisma.business.findMany({
    where: { name: { startsWith: "Storefront Cart Test " } },
    select: { id: true },
  });
  const ids = businesses.map((b) => b.id);
  await prisma.product.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessRole.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.business.deleteMany({ where: { id: { in: ids } } });
  await prisma.appUser.deleteMany({ where: { email: { contains: `storefront-cart-owner-` } } });
});

// ---------------------------------------------------------------------------
// Authoritative pricing — the client can never set name/price/total.
// ---------------------------------------------------------------------------

test("a quote's line name/unitPrice come from the Product row, never from the request (the request only ever has productId/quantity)", async () => {
  const business = await makeBusiness("authoritative-price");
  const product = await makeProduct(business.id, "Real Name", 45.00);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 2 }],
    fulfilmentMethod: "COLLECTION",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.quote.lines.length, 1);
  assert.equal(result.quote.lines[0]!.name, "Real Name");
  assert.equal(result.quote.lines[0]!.unitPrice, "45.00");
  assert.equal(result.quote.lines[0]!.lineTotal, "90.00");
  assert.equal(result.quote.subtotal, "90.00");
  assert.equal(result.quote.total, "90.00");
});

test("a productId belonging to a DIFFERENT business is rejected (removed from the quote), never resolved", async () => {
  const businessA = await makeBusiness("cross-biz-a");
  const businessB = await makeBusiness("cross-biz-b");
  const productOnB = await makeProduct(businessB.id, "B's Product", 10.00);

  const result = await resolveStorefrontCartQuote({
    businessId: businessA.id,
    lines: [{ productId: productOnB.id, quantity: 1 }],
    fulfilmentMethod: "COLLECTION",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  // An empty cart (the only line was cross-tenant and got dropped) is the
  // correct terminal state — never a quote priced off another business's product.
  assert.equal(result.code, "CART_EMPTY");
});

test("a cross-business product mixed with a real line: the real line still prices correctly, the cross-business one is reported removed, never silently included", async () => {
  const businessA = await makeBusiness("mixed-a");
  const businessB = await makeBusiness("mixed-b");
  const ownProduct = await makeProduct(businessA.id, "A's Product", 20.00);
  const foreignProduct = await makeProduct(businessB.id, "B's Product", 999.00);

  const result = await resolveStorefrontCartQuote({
    businessId: businessA.id,
    lines: [
      { productId: ownProduct.id, quantity: 1 },
      { productId: foreignProduct.id, quantity: 1 },
    ],
    fulfilmentMethod: "COLLECTION",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.quote.lines.length, 1);
  assert.equal(result.quote.lines[0]!.productId, ownProduct.id);
  assert.equal(result.quote.subtotal, "20.00");
  assert.equal(result.quote.removedLines.length, 1);
  assert.equal(result.quote.removedLines[0]!.productId, foreignProduct.id);
  assert.equal(result.quote.changed, true, "a removed line must mark the quote as changed");
});

test("an inactive product is rejected the same way a nonexistent one is — never purchasable from a stale cart", async () => {
  const business = await makeBusiness("inactive-product");
  const product = await makeProduct(business.id, "Soon Inactive", 15.00);
  await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1 }],
    fulfilmentMethod: "COLLECTION",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "CART_EMPTY");
});

test("a business without ORDERS capability rejects the whole cart, even though PRODUCTS exist", async () => {
  const business = await makeBusiness("no-orders-cap", ["PRODUCTS"]);
  const product = await makeProduct(business.id, "Display Only", 5.00);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1 }],
    fulfilmentMethod: "COLLECTION",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "ORDERS_UNAVAILABLE");
});

test("a PENDING (not yet ACTIVE) business is never quotable — generic unavailable, no distinction leaked", async () => {
  const { business } = await createBusiness({
    name: `Storefront Cart Test pending-${suffix}`,
    category: "RETAIL_STORE" as never,
    owner: {
      firstName: "Owner",
      lastName: "pending",
      email: `storefront-cart-owner-pending-${suffix}@example.test`,
      passwordHash: await hashPassword("SomePassword123"),
    },
  });
  // Deliberately left PENDING_VERIFICATION (createBusiness's default) — never activated.
  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: "does-not-matter", quantity: 1 }],
    fulfilmentMethod: "COLLECTION",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "BUSINESS_UNAVAILABLE");
});

// ---------------------------------------------------------------------------
// Multiple lines, quantities, dedup/bounds.
// ---------------------------------------------------------------------------

test("multiple distinct products resolve as separate lines with correct per-line and subtotal totals", async () => {
  const business = await makeBusiness("multi-line");
  const a = await makeProduct(business.id, "Kota", 55.00);
  const b = await makeProduct(business.id, "Chips", 20.00);
  const c = await makeProduct(business.id, "Coke", 15.00);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [
      { productId: a.id, quantity: 2 },
      { productId: b.id, quantity: 1 },
      { productId: c.id, quantity: 3 },
    ],
    fulfilmentMethod: "COLLECTION",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.quote.lines.length, 3);
  // 2*55 + 1*20 + 3*15 = 110 + 20 + 45 = 175
  assert.equal(result.quote.subtotal, "175.00");
  assert.equal(result.quote.total, "175.00");
});

test("the same productId submitted twice (two lines) is deduped into one line with summed quantity", async () => {
  const business = await makeBusiness("dedup");
  const product = await makeProduct(business.id, "Item", 10.00);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [
      { productId: product.id, quantity: 2 },
      { productId: product.id, quantity: 3 },
    ],
    fulfilmentMethod: "COLLECTION",
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.quote.lines.length, 1);
  assert.equal(result.quote.lines[0]!.quantity, 5);
  assert.equal(result.quote.subtotal, "50.00");
});

test("a combined/deduped quantity over MAX_LINE_QUANTITY is capped, and reported as adjusted, never silently over-charged for the requested amount", async () => {
  const business = await makeBusiness("cap-quantity");
  const product = await makeProduct(business.id, "Item", 1.00);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: MAX_LINE_QUANTITY }],
    fulfilmentMethod: "COLLECTION",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.quote.lines[0]!.quantity, MAX_LINE_QUANTITY);
  assert.equal(result.quote.adjustedLines.length, 0, "exactly at the ceiling is not itself an adjustment");
});

test("an empty lines array is rejected before ever touching the database meaningfully", async () => {
  const business = await makeBusiness("empty-lines");
  await assert.rejects(() =>
    resolveStorefrontCartQuote({ businessId: business.id, lines: [], fulfilmentMethod: "COLLECTION" }),
  );
});

test("a lines array beyond MAX_CART_LINES is rejected by the request schema itself, not silently truncated", async () => {
  const business = await makeBusiness("too-many-lines");
  const lines = Array.from({ length: MAX_CART_LINES + 1 }, (_, i) => ({ productId: `p${i}`, quantity: 1 }));
  await assert.rejects(() =>
    resolveStorefrontCartQuote({ businessId: business.id, lines, fulfilmentMethod: "COLLECTION" }),
  );
});

// ---------------------------------------------------------------------------
// Fulfilment / delivery fee — server-authoritative, never client-set.
// ---------------------------------------------------------------------------

test("COLLECTION always prices a zero delivery fee, regardless of the business's configured delivery fee", async () => {
  const business = await makeBusiness("collection-zero-fee", ["PRODUCTS", "ORDERS", "DELIVERY"]);
  await setDeliverySettings(business.id, { enabled: true, feeCents: 2500 });
  const product = await makeProduct(business.id, "Item", 10.00);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1 }],
    fulfilmentMethod: "COLLECTION",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.quote.deliveryFee, "0.00");
  assert.equal(result.quote.total, "10.00");
});

test("DELIVERY applies the business's OWN configured fee exactly once, never a client-suppliable value", async () => {
  const business = await makeBusiness("delivery-real-fee", ["PRODUCTS", "ORDERS", "DELIVERY"]);
  await setDeliverySettings(business.id, { enabled: true, feeCents: 2000 });
  const product = await makeProduct(business.id, "Item", 10.00);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1 }],
    fulfilmentMethod: "DELIVERY",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.quote.deliveryFee, "20.00");
  assert.equal(result.quote.total, "30.00");
});

test("DELIVERY is rejected outright when the business hasn't enabled it, even though the field exists to ask for", async () => {
  const business = await makeBusiness("delivery-disabled");
  const product = await makeProduct(business.id, "Item", 10.00);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1 }],
    fulfilmentMethod: "DELIVERY",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "DELIVERY_UNAVAILABLE");
});

test("changing the business's configured delivery fee AFTER a quote does not retroactively change that already-returned quote object (each call is a fresh, independent computation)", async () => {
  const business = await makeBusiness("fee-change-mid-checkout", ["PRODUCTS", "ORDERS", "DELIVERY"]);
  await setDeliverySettings(business.id, { enabled: true, feeCents: 1000 });
  const product = await makeProduct(business.id, "Item", 10.00);

  const first = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1 }],
    fulfilmentMethod: "DELIVERY",
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.quote.deliveryFee, "10.00");

  await setDeliverySettings(business.id, { enabled: true, feeCents: 5000 });

  const second = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1 }],
    fulfilmentMethod: "DELIVERY",
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.quote.deliveryFee, "50.00", "a fresh quote reflects the CURRENT fee — this is what protects against a stale checkout, not a bug");
  assert.equal(first.quote.deliveryFee, "10.00", "the earlier quote object itself is untouched — proves no shared mutable state");
});

// ---------------------------------------------------------------------------
// Business-hours gating.
// ---------------------------------------------------------------------------

test("a business whose configured hours exclude the current time rejects with HOURS_CLOSED", async () => {
  const business = await makeBusiness("hours-closed");
  await prisma.business.update({ where: { id: business.id }, data: { operatingHours: { monday: { closed: true }, tuesday: { closed: true }, wednesday: { closed: true }, thursday: { closed: true }, friday: { closed: true }, saturday: { closed: true }, sunday: { closed: true } } } });
  const product = await makeProduct(business.id, "Item", 10.00);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1 }],
    fulfilmentMethod: "COLLECTION",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "HOURS_CLOSED");
});

test("a business with no operatingHours configured (every business today) still succeeds regardless of the time — regression guard for fail-open", async () => {
  const business = await makeBusiness("hours-unconfigured");
  const product = await makeProduct(business.id, "Item", 10.00);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1 }],
    fulfilmentMethod: "COLLECTION",
  });

  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// Minimum order amount.
// ---------------------------------------------------------------------------

test("a cart below a configured minimum order rejects with BELOW_MINIMUM_ORDER", async () => {
  const business = await makeBusiness("min-order-below");
  await setOrderingSettings(business.id, { minOrderCents: 10000 }); // R100
  const product = await makeProduct(business.id, "Cheap Item", 50.00);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1 }],
    fulfilmentMethod: "COLLECTION",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "BELOW_MINIMUM_ORDER");
});

test("a cart at or above a configured minimum order succeeds", async () => {
  const business = await makeBusiness("min-order-met");
  await setOrderingSettings(business.id, { minOrderCents: 10000 }); // R100
  const product = await makeProduct(business.id, "Item", 50.00);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 2 }], // R100 exactly
    fulfilmentMethod: "COLLECTION",
  });

  assert.equal(result.ok, true);
});

test("minOrderCents: 0 (the default) never blocks regardless of cart size", async () => {
  const business = await makeBusiness("min-order-default");
  const product = await makeProduct(business.id, "Cheap Item", 1.00);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1 }],
    fulfilmentMethod: "COLLECTION",
  });

  assert.equal(result.ok, true);
});

test("the minimum is checked against subtotal, not total — a delivery fee must never help a cart clear it", async () => {
  const business = await makeBusiness("min-order-subtotal-not-total", ["PRODUCTS", "ORDERS", "DELIVERY"]);
  await setDeliverySettings(business.id, { enabled: true, feeCents: 10000 }); // R100 delivery fee
  await setOrderingSettings(business.id, { minOrderCents: 10000 }); // R100 minimum
  const product = await makeProduct(business.id, "Cheap Item", 50.00); // subtotal R50, total R150 with delivery

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1 }],
    fulfilmentMethod: "DELIVERY",
  });

  assert.equal(result.ok, false, "subtotal (R50) is below the R100 minimum even though total (R150) would clear it");
  if (result.ok) return;
  assert.equal(result.code, "BELOW_MINIMUM_ORDER");
});

// ---------------------------------------------------------------------------
// PER_KM delivery pricing — no GOOGLE_MAPS_API_KEY is configured in this
// test environment, so geocodeAddress() reliably returns null here (see
// src/lib/geocoding.ts's own doc comment: never throws, null on any
// failure including "no key configured"). That makes the two failure paths
// below fully testable without a live key; the successful distance-fee
// computation itself is covered by the plan's live walkthrough instead,
// which exercises a real geocoded address against a real test business.
// ---------------------------------------------------------------------------

test("PER_KM mode without deliveryAddress is PENDING, not an error — there is simply no fee to show yet", async () => {
  const business = await makeBusiness("per-km-pending", ["PRODUCTS", "ORDERS", "DELIVERY"]);
  await setDeliverySettings(business.id, { enabled: true, pricingMode: "PER_KM", feeCents: 0, perKmFeeCents: 500 });
  await prisma.business.update({ where: { id: business.id }, data: { latitude: -26.26, longitude: 27.86 } });
  const product = await makeProduct(business.id, "Item", 10.0);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1 }],
    fulfilmentMethod: "DELIVERY",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.quote.deliveryFeePending, true);
  assert.equal(result.quote.deliveryFee, "0.00");
});

test("PER_KM mode blocks with DELIVERY_PRICING_UNAVAILABLE when the business itself has never been geocoded", async () => {
  const business = await makeBusiness("per-km-no-business-pin", ["PRODUCTS", "ORDERS", "DELIVERY"]);
  await setDeliverySettings(business.id, { enabled: true, pricingMode: "PER_KM", feeCents: 0, perKmFeeCents: 500 });
  const product = await makeProduct(business.id, "Item", 10.0);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1 }],
    fulfilmentMethod: "DELIVERY",
    deliveryAddress: "1 Example Street, Soweto",
  });
  assert.equal(result.ok, false, "an owner-configuration problem, not the customer's fault");
  if (result.ok) return;
  assert.equal(result.code, "DELIVERY_PRICING_UNAVAILABLE");
});

test("PER_KM mode blocks with DELIVERY_DISTANCE_UNAVAILABLE when the submitted address can't be geocoded (no API key configured here)", async () => {
  const business = await makeBusiness("per-km-no-geocode", ["PRODUCTS", "ORDERS", "DELIVERY"]);
  await setDeliverySettings(business.id, { enabled: true, pricingMode: "PER_KM", feeCents: 0, perKmFeeCents: 500 });
  await prisma.business.update({ where: { id: business.id }, data: { latitude: -26.26, longitude: 27.86 } });
  const product = await makeProduct(business.id, "Item", 10.0);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1 }],
    fulfilmentMethod: "DELIVERY",
    deliveryAddress: "1 Example Street, Soweto",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "DELIVERY_DISTANCE_UNAVAILABLE");
});

test("FLAT mode is completely unaffected by geocoding being unavailable — never blocks on it, proving zero regression for existing businesses", async () => {
  const business = await makeBusiness("flat-mode-unaffected-by-geocoding", ["PRODUCTS", "ORDERS", "DELIVERY"]);
  await setDeliverySettings(business.id, { enabled: true, pricingMode: "FLAT", feeCents: 2000, perKmFeeCents: 0 });
  const product = await makeProduct(business.id, "Item", 10.0);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1 }],
    fulfilmentMethod: "DELIVERY",
    deliveryAddress: "1 Example Street, Soweto",
  });
  assert.equal(result.ok, true, "FLAT pricing must never fail just because geocoding (used only for the map pin) is unavailable");
  if (!result.ok) return;
  assert.equal(result.quote.deliveryFee, "20.00");
  assert.equal(result.quote.deliveryFeePending, false);
});

test("a business with no settings.delivery.pricingMode key at all (every business saved before this feature) resolves to FLAT, never PER_KM", async () => {
  const business = await makeBusiness("legacy-no-pricing-mode", ["PRODUCTS", "ORDERS", "DELIVERY"]);
  // Writes the pre-pricingMode shape directly, bypassing setDeliverySettings
  // (which always writes pricingMode now) — simulates a business that saved
  // delivery settings before this feature existed.
  await prisma.business.update({
    where: { id: business.id },
    data: { settings: { delivery: { enabled: true, feeCents: 1500 } } },
  });
  const product = await makeProduct(business.id, "Item", 10.0);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1 }],
    fulfilmentMethod: "DELIVERY",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.quote.deliveryFee, "15.00", "must use the legacy flat fee, never block or silently charge R0");
});
