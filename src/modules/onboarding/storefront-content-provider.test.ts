import test from "node:test";
import assert from "node:assert/strict";
import { generateContentWithFallback, getContentGenerationProvider, buildSystemPrompt } from "@/modules/onboarding/storefront-content-provider";

// Same reasoning as template-generation-provider.test.ts: getContentGenerationProvider's
// choice depends on this environment's own ANTHROPIC_API_KEY (set in some dev
// .env.local files, invalid/unreachable in others, unset in CI). These tests
// assert against that fact rather than assuming either state — with no key
// the rules provider runs directly; with a key but no genuinely reachable
// model, the model call fails and falls back to rules — either way the
// fallback contract holds. The model path succeeding end-to-end was verified
// manually against a live seeded business instead of mocking global fetch
// here, matching this session's practice elsewhere.

test("getContentGenerationProvider's source matches the external-AI gate in this environment", () => {
  // One gate for every external model call (src/lib/ai/external-ai.ts): the switch AND a key.
  const expected = process.env.BUDDY_EXTERNAL_AI === "enabled" && process.env.ANTHROPIC_API_KEY ? "model" : "rules";
  assert.equal(getContentGenerationProvider().source, expected);
});

test("generateContentWithFallback: rules path never fabricates — produces only a plain factual about sentence, empty hero/highlights", async () => {
  const result = await generateContentWithFallback({ businessName: "Test Kota Spot", category: "FOOD_VENDOR" });
  assert.deepEqual(result.content.highlights, { items: [] });
  assert.equal(result.content.hero.headline, undefined);
  assert.equal(result.content.hero.subheadline, undefined);
  assert.match(result.content.about.body!, /^Test Kota Spot is a /);
});

test("generateContentWithFallback's rules path mentions real catalogue counts when provided, never an invented number", async () => {
  const result = await generateContentWithFallback({
    businessName: "Test Kota Spot",
    category: "FOOD_VENDOR",
    catalogueSummary: { productCount: 3, serviceCount: 0, sampleNames: ["Beef Kota"] },
  });
  assert.match(result.content.about.body!, /3 product\(s\) and 0 service\(s\)/);
});

test("generateContentWithFallback ignores an absent brief/catalogue without throwing", async () => {
  const result = await generateContentWithFallback({ businessName: "Test Business", category: "OTHER" });
  assert.equal(typeof result.content.about.body, "string");
});

test("buildSystemPrompt includes the hard anti-fabrication instruction and the real catalogue/brief context when present", () => {
  const prompt = buildSystemPrompt({
    businessName: "Test Kota Spot",
    category: "FOOD_VENDOR",
    brief: "We sell kotas and vetkoek.",
    catalogueSummary: { productCount: 2, serviceCount: 0, sampleNames: ["Beef Kota", "Vetkoek"] },
  });
  assert.match(prompt, /never invent a fact/i);
  assert.match(prompt, /We sell kotas and vetkoek\./);
  assert.match(prompt, /Beef Kota, Vetkoek/);
});

test("buildSystemPrompt says so honestly when no catalogue data is available", () => {
  const prompt = buildSystemPrompt({ businessName: "Test Business", category: "OTHER" });
  assert.match(prompt, /No catalogue data is available yet/);
});

test("buildSystemPrompt includes a tone instruction when voiceTone is set, omits it when absent", () => {
  const withTone = buildSystemPrompt({ businessName: "Test Business", category: "OTHER", voiceTone: "PLAYFUL" });
  assert.match(withTone, /playful, energetic voice/);

  const withoutTone = buildSystemPrompt({ businessName: "Test Business", category: "OTHER" });
  assert.doesNotMatch(withoutTone, /voice — the owner chose/);
});

test("buildSystemPrompt's tone instruction matches the chosen tone, not a generic one, for every real option", () => {
  assert.match(buildSystemPrompt({ businessName: "X", category: "OTHER", voiceTone: "FRIENDLY" }), /warm, friendly voice/);
  assert.match(buildSystemPrompt({ businessName: "X", category: "OTHER", voiceTone: "PROFESSIONAL" }), /professional, polished voice/);
  assert.match(buildSystemPrompt({ businessName: "X", category: "OTHER", voiceTone: "DIRECT" }), /direct, no-fuss voice/);
});

test("buildSystemPrompt includes the owner's differentiator verbatim when present, flagged as real grounding not an invitation to embellish", () => {
  const prompt = buildSystemPrompt({
    businessName: "Test Business",
    category: "OTHER",
    differentiator: "We're the only halaal-certified kota spot in the area.",
  });
  assert.match(prompt, /We're the only halaal-certified kota spot in the area\./);
  assert.match(prompt, /not a suggestion to embellish/);
});

test("buildSystemPrompt omits the differentiator line entirely when none was given", () => {
  const prompt = buildSystemPrompt({ businessName: "Test Business", category: "OTHER" });
  assert.doesNotMatch(prompt, /what makes their business different/);
});
