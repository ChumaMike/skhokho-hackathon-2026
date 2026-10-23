import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { hashPassword } from "@/modules/auth/auth.service";
import { createProduct } from "@/modules/catalog/catalog.service";
import {
  createOptionGroup,
  createOption,
  assignOptionGroupToProduct,
  setOptionActive,
  setOptionGroupActive,
} from "@/modules/catalog/menu-options.service";
import { resolveStorefrontCartQuote, computeLineKey } from "./storefront-cart";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function makeBusiness(label: string) {
  const { business } = await createBusiness({
    name: `Cart Options Test ${label}`,
    category: "FOOD_VENDOR" as never,
    owner: {
      firstName: "Owner",
      lastName: label,
      email: `cart-options-owner-${label}-${suffix}@example.test`,
      passwordHash: await hashPassword("SomePassword123"),
    },
  });
  await prisma.business.update({ where: { id: business.id }, data: { status: "ACTIVE" } });
  return business;
}

test.after(async () => {
  const businesses = await prisma.business.findMany({
    where: { name: { startsWith: "Cart Options Test " } },
    select: { id: true },
  });
  for (const { id } of businesses) {
    await prisma.businessStaff.deleteMany({ where: { businessId: id } });
    await prisma.businessRole.deleteMany({ where: { businessId: id } });
    await prisma.businessSubscription.deleteMany({ where: { businessId: id } });
    await prisma.business.delete({ where: { id } });
  }
});

/** Sets up "Kota Special" (R45) with Choose size (Regular +0 / Large +15, required, SINGLE) and Extras (Cheese +10 / Egg +8, optional, MULTIPLE up to 2). */
async function makeKotaWithOptions(business: { id: string }) {
  const product = await createProduct(business.id, { name: "Kota Special", price: 45 });

  const sizeGroup = await createOptionGroup(business.id, {
    name: "Choose your size",
    selectionType: "SINGLE",
    minSelections: 1,
    maxSelections: 1,
  });
  const regular = await createOption(business.id, sizeGroup.id, { name: "Regular", priceDelta: 0 });
  const large = await createOption(business.id, sizeGroup.id, { name: "Large", priceDelta: 15 });
  await assignOptionGroupToProduct(business.id, product.id, sizeGroup.id);

  const extrasGroup = await createOptionGroup(business.id, {
    name: "Extras",
    selectionType: "MULTIPLE",
    minSelections: 0,
    maxSelections: 2,
  });
  const cheese = await createOption(business.id, extrasGroup.id, { name: "Cheese", priceDelta: 10 });
  const egg = await createOption(business.id, extrasGroup.id, { name: "Egg", priceDelta: 8 });
  await assignOptionGroupToProduct(business.id, product.id, extrasGroup.id);

  return { product, sizeGroup, regular, large, extrasGroup, cheese, egg };
}

// ---------------------------------------------------------------------------
// Authoritative pricing (§12)
// ---------------------------------------------------------------------------

test("base price + deltas: Large + Cheese prices as 45 + 15 + 10 = 70", async () => {
  const business = await makeBusiness("pricing-base");
  const { product, large, cheese } = await makeKotaWithOptions(business);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1, optionIds: [large.id, cheese.id] }],
    fulfilmentMethod: "COLLECTION",
  });

  assert.ok(result.ok);
  const line = result.quote.lines[0];
  assert.equal(line.unitPrice, "45.00");
  assert.equal(line.configuredUnitPrice, "70.00");
  assert.equal(line.lineTotal, "70.00");
  assert.equal(line.options.length, 2);
});

test("client cannot control price deltas — submitting Large's id still prices at the server's own +R15, never a client-supplied amount", async () => {
  const business = await makeBusiness("pricing-no-client-control");
  const { product, large } = await makeKotaWithOptions(business);

  // The wire schema has no field for a client-supplied price at all
  // (CartLineSchema only accepts productId/quantity/optionIds) — this test
  // documents that structural guarantee by asserting the resolved delta
  // matches the SERVER's stored value regardless of what "Large" actually
  // costs having been set to 15 by the fixture above, not by this request.
  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1, optionIds: [large.id] }],
    fulfilmentMethod: "COLLECTION",
  });
  assert.ok(result.ok);
  assert.equal(result.quote.lines[0].options[0].priceDelta, "15.00");
});

test("Regular (a real, existing, zero-delta option) prices at +R0 — a customer cannot claim a discount by submitting a wrong option id, only a real R0 option", async () => {
  const business = await makeBusiness("pricing-zero-delta");
  const { product, regular } = await makeKotaWithOptions(business);
  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1, optionIds: [regular.id] }],
    fulfilmentMethod: "COLLECTION",
  });
  assert.ok(result.ok);
  assert.equal(result.quote.lines[0].configuredUnitPrice, "45.00");
});

// ---------------------------------------------------------------------------
// Validation rules (§13)
// ---------------------------------------------------------------------------

test("a required group with no selection is rejected — Kota Special has no valid Regular/Large default", async () => {
  const business = await makeBusiness("required-unsatisfied");
  const { product } = await makeKotaWithOptions(business);
  const chips = await createProduct(business.id, { name: "Chips", price: 25 });
  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [
      { productId: product.id, quantity: 1 },
      { productId: chips.id, quantity: 1 },
    ],
    fulfilmentMethod: "COLLECTION",
  });
  if (!result.ok) throw new Error(`expected ok quote, got ${result.code}`);
  assert.equal(result.quote.lines.length, 1, "the Kota line must be removed, not silently added without a size — Chips still prices fine");
  assert.equal(result.quote.lines[0].productId, chips.id);
  assert.ok(result.quote.removedLines.some((r) => r.productId === product.id && r.reason === "INVALID_OPTIONS"));
});

test("an optional group left unselected is fine — ordering just Regular with no extras succeeds", async () => {
  const business = await makeBusiness("optional-unselected");
  const { product, regular } = await makeKotaWithOptions(business);
  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1, optionIds: [regular.id] }],
    fulfilmentMethod: "COLLECTION",
  });
  assert.ok(result.ok);
  assert.equal(result.quote.removedLines.length, 0);
  assert.equal(result.quote.lines[0].configuredUnitPrice, "45.00");
});

test("selecting more than a group's maxSelections is rejected — 3 extras when the cap is 2", async () => {
  const business = await makeBusiness("max-exceeded");
  const { product, regular, extrasGroup, cheese, egg } = await makeKotaWithOptions(business);
  const thirdExtra = await createOption(business.id, extrasGroup.id, { name: "Bacon", priceDelta: 12 });
  const chips = await createProduct(business.id, { name: "Chips", price: 25 });
  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [
      { productId: product.id, quantity: 1, optionIds: [regular.id, cheese.id, egg.id, thirdExtra.id] },
      { productId: chips.id, quantity: 1 },
    ],
    fulfilmentMethod: "COLLECTION",
  });
  if (!result.ok) throw new Error(`expected ok quote, got ${result.code}`);
  assert.ok(result.quote.removedLines.some((r) => r.reason === "INVALID_OPTIONS"));
});

test("duplicate option submissions are deduped, not double-selected or double-charged", async () => {
  const business = await makeBusiness("duplicate-dedup");
  const { product, regular, cheese } = await makeKotaWithOptions(business);
  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: product.id, quantity: 1, optionIds: [regular.id, cheese.id, cheese.id, cheese.id] }],
    fulfilmentMethod: "COLLECTION",
  });
  assert.ok(result.ok);
  assert.equal(result.quote.removedLines.length, 0, "duplicates must not push the count over maxSelections");
  assert.equal(result.quote.lines[0].options.length, 2, "Regular + Cheese once, not Cheese three times");
  assert.equal(result.quote.lines[0].configuredUnitPrice, "55.00");
});

test("an inactive option is rejected even though it's a real, correctly-shaped id", async () => {
  const business = await makeBusiness("inactive-option");
  const { product, regular, cheese } = await makeKotaWithOptions(business);
  await setOptionActive(business.id, cheese.id, false);
  const chips = await createProduct(business.id, { name: "Chips", price: 25 });
  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [
      { productId: product.id, quantity: 1, optionIds: [regular.id, cheese.id] },
      { productId: chips.id, quantity: 1 },
    ],
    fulfilmentMethod: "COLLECTION",
  });
  if (!result.ok) throw new Error(`expected ok quote, got ${result.code}`);
  assert.ok(result.quote.removedLines.some((r) => r.reason === "INVALID_OPTIONS"));
});

test("an inactive group makes every one of its options unselectable, even if the option itself is still isActive:true", async () => {
  const business = await makeBusiness("inactive-group");
  const { product, regular, cheese } = await makeKotaWithOptions(business);
  await setOptionGroupActive(business.id, (await prisma.menuOption.findUniqueOrThrow({ where: { id: cheese.id } })).groupId, false);
  const chips = await createProduct(business.id, { name: "Chips", price: 25 });
  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [
      { productId: product.id, quantity: 1, optionIds: [regular.id, cheese.id] },
      { productId: chips.id, quantity: 1 },
    ],
    fulfilmentMethod: "COLLECTION",
  });
  if (!result.ok) throw new Error(`expected ok quote, got ${result.code}`);
  assert.ok(result.quote.removedLines.some((r) => r.reason === "INVALID_OPTIONS"));
});

// ---------------------------------------------------------------------------
// Tenancy (§25)
// ---------------------------------------------------------------------------

test("Business A's product with Business B's option group id is rejected", async () => {
  const businessA = await makeBusiness("tenancy-a");
  const businessB = await makeBusiness("tenancy-b");
  const { product: productA, regular: regularA } = await makeKotaWithOptions(businessA);
  const { cheese: cheeseB } = await makeKotaWithOptions(businessB);
  const chipsA = await createProduct(businessA.id, { name: "Chips", price: 25 });

  const result = await resolveStorefrontCartQuote({
    businessId: businessA.id,
    lines: [
      { productId: productA.id, quantity: 1, optionIds: [regularA.id, cheeseB.id] },
      { productId: chipsA.id, quantity: 1 },
    ],
    fulfilmentMethod: "COLLECTION",
  });
  if (!result.ok) throw new Error(`expected ok quote, got ${result.code}`);
  assert.ok(result.quote.removedLines.some((r) => r.reason === "INVALID_OPTIONS"), "an option belonging to another business's product must never resolve");
});

test("an option group that exists for this business but was never assigned to THIS product is rejected", async () => {
  const business = await makeBusiness("unassigned-group");
  const { product: kota, regular } = await makeKotaWithOptions(business);
  // A second product with its OWN, never-assigned-to-kota option group.
  const chips = await createProduct(business.id, { name: "Chips", price: 25 });
  const saltGroup = await createOptionGroup(business.id, { name: "Salt", selectionType: "SINGLE", minSelections: 0, maxSelections: 1 });
  const salted = await createOption(business.id, saltGroup.id, { name: "Salted", priceDelta: 0 });
  await assignOptionGroupToProduct(business.id, chips.id, saltGroup.id);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [
      { productId: kota.id, quantity: 1, optionIds: [regular.id, salted.id] },
      { productId: chips.id, quantity: 1 },
    ],
    fulfilmentMethod: "COLLECTION",
  });
  if (!result.ok) throw new Error(`expected ok quote, got ${result.code}`);
  assert.ok(result.quote.removedLines.some((r) => r.reason === "INVALID_OPTIONS"), "Salt was never assigned to Kota Special — must not resolve there");
});

// ---------------------------------------------------------------------------
// Cart-line identity (§11)
// ---------------------------------------------------------------------------

test("computeLineKey: same product + same (unordered) option sets produce the identical key", () => {
  const a = computeLineKey("p1", ["opt-b", "opt-a"]);
  const b = computeLineKey("p1", ["opt-a", "opt-b"]);
  assert.equal(a, b);
});

test("computeLineKey: same product + different option sets produce different keys", () => {
  const a = computeLineKey("p1", ["opt-a"]);
  const b = computeLineKey("p1", ["opt-b"]);
  assert.notEqual(a, b);
});

test("two differently-configured lines of the same product remain separate quote lines, each priced independently", async () => {
  const business = await makeBusiness("distinct-lines");
  const { product, regular, large, cheese } = await makeKotaWithOptions(business);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [
      { productId: product.id, quantity: 1, optionIds: [large.id, cheese.id] },
      { productId: product.id, quantity: 1, optionIds: [regular.id] },
    ],
    fulfilmentMethod: "COLLECTION",
  });

  assert.ok(result.ok);
  assert.equal(result.quote.lines.length, 2);
  const large_cheese = result.quote.lines.find((l) => l.configuredUnitPrice === "70.00");
  const regularOnly = result.quote.lines.find((l) => l.configuredUnitPrice === "45.00");
  assert.ok(large_cheese && regularOnly);
  assert.notEqual(large_cheese.lineKey, regularOnly.lineKey);
});

test("two IDENTICALLY-configured lines of the same product combine into one line with summed quantity", async () => {
  const business = await makeBusiness("combine-identical");
  const { product, large } = await makeKotaWithOptions(business);

  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [
      { productId: product.id, quantity: 1, optionIds: [large.id] },
      { productId: product.id, quantity: 2, optionIds: [large.id] },
    ],
    fulfilmentMethod: "COLLECTION",
  });

  assert.ok(result.ok);
  assert.equal(result.quote.lines.length, 1);
  assert.equal(result.quote.lines[0].quantity, 3);
  assert.equal(result.quote.lines[0].lineTotal, "180.00"); // (45+15) * 3
});

// ---------------------------------------------------------------------------
// Backward compatibility (§19)
// ---------------------------------------------------------------------------

test("a simple existing product with no option groups at all still quotes exactly as before", async () => {
  const business = await makeBusiness("backward-compat");
  const chips = await createProduct(business.id, { name: "Chips", price: 25 });
  const result = await resolveStorefrontCartQuote({
    businessId: business.id,
    lines: [{ productId: chips.id, quantity: 2 }],
    fulfilmentMethod: "COLLECTION",
  });
  assert.ok(result.ok);
  assert.equal(result.quote.lines.length, 1);
  assert.equal(result.quote.lines[0].lineTotal, "50.00");
  assert.equal(result.quote.lines[0].options.length, 0);
  assert.equal(result.quote.removedLines.length, 0);
});
