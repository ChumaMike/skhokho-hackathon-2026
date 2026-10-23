import test from "node:test";
import assert from "node:assert/strict";
import { parseProductSort, PRODUCT_SORT_LABELS, PRODUCT_SORTS, sortProducts } from "./catalog-sort";

/** Price sort on storefront menus and grids: stable, non-mutating, tolerant of odd input. */

const owner = [
  { id: "kota", name: "Kota", price: "35.00" },
  { id: "chips", name: "Chips", price: "20.00" },
  { id: "russian", name: "Russian", price: "20" },
  { id: "combo", name: "Combo", price: "55.50" },
  { id: "mystery", name: "Mystery", price: "n/a" },
];

test("default keeps the owner's order and returns a copy", () => {
  const out = sortProducts(owner, "default");
  assert.deepEqual(out.map((p) => p.id), ["kota", "chips", "russian", "combo", "mystery"]);
  assert.notEqual(out, owner);
});

test("low to high and high to low are stable for equal prices and put unparseable prices last", () => {
  assert.deepEqual(sortProducts(owner, "price_asc").map((p) => p.id), ["chips", "russian", "kota", "combo", "mystery"], "20 and 20 keep owner order");
  assert.deepEqual(sortProducts(owner, "price_desc").map((p) => p.id), ["combo", "kota", "chips", "russian", "mystery"]);
  assert.deepEqual(owner.map((p) => p.id), ["kota", "chips", "russian", "combo", "mystery"], "input untouched");
});

test("numeric prices work too", () => {
  assert.deepEqual(sortProducts([{ price: 9 }, { price: 3 }, { price: 7 }], "price_asc").map((p) => p.price), [3, 7, 9]);
});

test("anything unknown from the URL falls back to the owner's order", () => {
  assert.equal(parseProductSort("price_asc"), "price_asc");
  assert.equal(parseProductSort("PRICE_ASC"), "default");
  assert.equal(parseProductSort("cheapest"), "default");
  assert.equal(parseProductSort(undefined), "default");
  assert.equal(parseProductSort(null), "default");
  for (const s of PRODUCT_SORTS) assert.ok(PRODUCT_SORT_LABELS[s].length > 0, `label for ${s}`);
});
