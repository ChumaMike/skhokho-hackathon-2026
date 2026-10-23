import test from "node:test";
import assert from "node:assert/strict";
import { validateDesignConfig } from "./design-config";

const valid = { templateId: "PRODUCT", primaryColor: "#9A5A0A", sectionOrder: ["hero", "products", "contact"] };

test("accepts a minimal valid design", () => {
  const result = validateDesignConfig({ templateId: "BOOKING" });
  assert.deepEqual(result, { ok: true, config: { templateId: "BOOKING" } });
});

test("accepts a full valid design and trims copy", () => {
  const result = validateDesignConfig({ ...valid, heroHeadline: "  Fresh food daily  ", heroSubline: "Order by 2pm" });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.config.heroHeadline, "Fresh food daily");
});

test("rejects unknown fields instead of dropping them", () => {
  const result = validateDesignConfig({ ...valid, customCss: "body{display:none}" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(" "), /Unknown field "customCss"/);
});

test("rejects templates outside the two named designs", () => {
  assert.equal(validateDesignConfig({ templateId: "GENERIC" }).ok, false);
});

test("rejects non-hex colours, including CSS injection attempts", () => {
  for (const primaryColor of ["red", "#GGGGGG", "url(javascript:x)", "#9A5A0A;}"]) {
    assert.equal(validateDesignConfig({ ...valid, primaryColor }).ok, false, primaryColor);
  }
});

test("rejects sections we don't render and repeated sections", () => {
  assert.equal(validateDesignConfig({ ...valid, sectionOrder: ["hero", "script"] }).ok, false);
  assert.equal(validateDesignConfig({ ...valid, sectionOrder: ["hero", "hero"] }).ok, false);
});

test("rejects markup and over-long copy", () => {
  assert.equal(validateDesignConfig({ ...valid, heroHeadline: "<img src=x onerror=alert(1)>" }).ok, false);
  assert.equal(validateDesignConfig({ ...valid, heroSubline: "x".repeat(161) }).ok, false);
  assert.equal(validateDesignConfig({ ...valid, heroHeadline: "   " }).ok, false);
});

test("rejects non-object input", () => {
  for (const raw of [null, "PRODUCT", ["PRODUCT"], 3]) {
    assert.equal(validateDesignConfig(raw).ok, false);
  }
});
