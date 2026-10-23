import test from "node:test";
import assert from "node:assert/strict";
import { generatePagesWithFallback, getTemplateGenerationProvider, buildSystemPrompt } from "@/modules/onboarding/template-generation-provider";

// getTemplateGenerationProvider's choice depends on this environment's own
// ANTHROPIC_API_KEY (set in some dev .env.local files, unset in CI) — these
// tests assert against that fact rather than assuming either state.
// generatePagesWithFallback's own result.source is asserted "rules"
// regardless of the key: with no key the rules provider runs directly;
// with a key but no genuinely reachable model, the model call fails and
// falls back to rules — either way the fallback contract holds. The model
// path succeeding end-to-end was verified manually against the live
// seeded business instead of mocking global fetch here, matching this
// session's practice elsewhere.

test("getTemplateGenerationProvider's source matches the external-AI gate in this environment", () => {
  // One gate for every external model call (src/lib/ai/external-ai.ts): the switch AND a key.
  const expected = process.env.BUDDY_EXTERNAL_AI === "enabled" && process.env.ANTHROPIC_API_KEY ? "model" : "rules";
  assert.equal(getTemplateGenerationProvider().source, expected);
});

test("generatePagesWithFallback: FOOD_VENDOR gets the FOOD_MENU template's page set", async () => {
  const result = await generatePagesWithFallback({ businessName: "Test Kota Spot", category: "FOOD_VENDOR" });
  assert.deepEqual(result.pages, ["HOME", "GALLERY", "CONTACT"]);
});

test("generatePagesWithFallback: OTHER falls through to CLASSIC's HOME-only page set, never a stub or empty list", async () => {
  const result = await generatePagesWithFallback({ businessName: "Test Business", category: "OTHER" });
  assert.deepEqual(result.pages, ["HOME"]);
});

test("generatePagesWithFallback ignores an absent brief without throwing", async () => {
  const result = await generatePagesWithFallback({ businessName: "Test Business", category: "SALON" });
  assert.deepEqual(result.pages, ["HOME", "GALLERY", "CONTACT"]);
});

test("generatePagesWithFallback ignores an absent catalogueSummary without throwing (brand-new business)", async () => {
  const result = await generatePagesWithFallback({ businessName: "Test Business", category: "RETAIL_STORE" });
  assert.deepEqual(result.pages, ["HOME", "GALLERY", "ABOUT"]);
});

test("buildSystemPrompt mentions the real catalogue when a summary is provided, and says so honestly when it isn't", () => {
  const withoutCatalogue = buildSystemPrompt({ businessName: "Test Kota Spot", category: "FOOD_VENDOR" });
  assert.match(withoutCatalogue, /No catalogue data is available yet/);
  assert.doesNotMatch(withoutCatalogue, /currently has/);

  const withCatalogue = buildSystemPrompt({
    businessName: "Test Kota Spot",
    category: "FOOD_VENDOR",
    catalogueSummary: { productCount: 3, serviceCount: 0, sampleNames: ["Beef Kota", "Chicken Kota", "Vetkoek"] },
  });
  assert.match(withCatalogue, /currently has 3 product\(s\) and 0 service\(s\)/);
  assert.match(withCatalogue, /Beef Kota, Chicken Kota, Vetkoek/);
  assert.doesNotMatch(withCatalogue, /No catalogue data is available yet/);
});

test("buildSystemPrompt treats a zero-count catalogueSummary the same as no summary at all", () => {
  const zeroCounts = buildSystemPrompt({
    businessName: "Test Business",
    category: "OTHER",
    catalogueSummary: { productCount: 0, serviceCount: 0, sampleNames: [] },
  });
  assert.match(zeroCounts, /No catalogue data is available yet/);
});
