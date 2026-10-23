import test from "node:test";
import assert from "node:assert/strict";
import {
  parseHexColor,
  contrastRatio,
  resolveSafePair,
  buildStorefrontColorTokens,
  STOREFRONT_LIGHT,
  STOREFRONT_DARK,
} from "./storefront-colors";

test("#FFF normalizes to the same result as #FFFFFF", () => {
  assert.deepEqual(parseHexColor("#FFF"), parseHexColor("#FFFFFF"));
});

test("#RRGGBBAA strips its alpha byte and parses identically to #RRGGBB", () => {
  assert.deepEqual(parseHexColor("#FFFFFFAA"), parseHexColor("#FFFFFF"));
});

test("parseHexColor returns null for empty, malformed, or wrong-length input", () => {
  assert.equal(parseHexColor(""), null);
  assert.equal(parseHexColor("not-a-color"), null);
  assert.equal(parseHexColor("#12"), null);
  assert.equal(parseHexColor(null), null);
  assert.equal(parseHexColor(undefined), null);
});

test("contrastRatio(black, white) is approximately 21", () => {
  const ratio = contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
  assert.ok(Math.abs(ratio - 21) < 0.1, `expected ~21, got ${ratio}`);
});

test("a near-white primary colour is used as-is with a dark foreground", () => {
  const result = resolveSafePair("#FEFEFE");
  assert.equal(result.adjusted, false);
  assert.equal(result.background, "#FEFEFE");
  assert.equal(result.foreground, `#${[STOREFRONT_DARK.r, STOREFRONT_DARK.g, STOREFRONT_DARK.b].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`);
  assert.ok(result.ratio >= 4.5);
});

test("a near-black primary colour is used as-is with a light foreground", () => {
  const result = resolveSafePair("#050505");
  assert.equal(result.adjusted, false);
  assert.equal(result.background, "#050505");
  assert.equal(result.foreground, `#${[STOREFRONT_LIGHT.r, STOREFRONT_LIGHT.g, STOREFRONT_LIGHT.b].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`);
  assert.ok(result.ratio >= 4.5);
});

test("a mid-gray primary colour (#808080) fails both fixed candidates and requires adjustment", () => {
  const result = resolveSafePair("#808080");
  assert.equal(result.adjusted, true);
  assert.ok(result.ratio >= 4.5, `expected adjusted ratio >= 4.5, got ${result.ratio}`);
  assert.notEqual(result.background, "#808080", "background must actually have moved");
});

test("resolveSafePair falls back to the app default (#E8A020) for invalid/missing input, never throws", () => {
  assert.doesNotThrow(() => resolveSafePair(undefined));
  assert.doesNotThrow(() => resolveSafePair("garbage"));
  const result = resolveSafePair("garbage");
  assert.equal(result.background, "#E8A020");
});

test("buildStorefrontColorTokens falls back to the default primary when primaryColor is null", () => {
  const tokens = buildStorefrontColorTokens({ primaryColor: null, accentColor: null });
  assert.equal(tokens["--store-primary"], "#E8A020");
});

test("buildStorefrontColorTokens produces both a raw and a safe value for primary and accent", () => {
  const tokens = buildStorefrontColorTokens({ primaryColor: "#808080", accentColor: "#F59E0B" });
  assert.equal(tokens["--store-primary"], "#808080");
  assert.notEqual(tokens["--store-primary-safe"], "#808080");
  assert.ok(tokens["--store-on-primary"]);
  assert.equal(tokens["--store-accent"], "#F59E0B");
  assert.ok(tokens["--store-on-accent"]);
});
