import test from "node:test";
import assert from "node:assert/strict";
import { classifyBusinessCategory, getCategoryClassifier } from "./category-classifier";

// The model path is chosen only by the single external-AI gate
// (src/lib/ai/external-ai.ts): BUDDY_EXTERNAL_AI=enabled AND a key. Tests that
// exercise the model path set both and mock fetch; a key alone must never be
// enough (cross-border AI boundary, docs/legal-dependencies.md).

test("a key alone never selects the model — the external-AI switch is required", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalSwitch = process.env.BUDDY_EXTERNAL_AI;
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  delete process.env.BUDDY_EXTERNAL_AI;
  try {
    assert.equal(getCategoryClassifier().source, "rules");
    process.env.BUDDY_EXTERNAL_AI = "enabled";
    assert.equal(getCategoryClassifier().source, "model");
  } finally {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    if (originalSwitch === undefined) delete process.env.BUDDY_EXTERNAL_AI;
    else process.env.BUDDY_EXTERNAL_AI = originalSwitch;
  }
});

test("getCategoryClassifier resolves to the rules-based provider when ANTHROPIC_API_KEY is unset", () => {
  const original = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.equal(getCategoryClassifier().source, "rules");
  } finally {
    if (original !== undefined) process.env.ANTHROPIC_API_KEY = original;
  }
});

test("classifyBusinessCategory detects a Food business from free text", async () => {
  const result = await classifyBusinessCategory("We sell kotas, chips and cold drinks from a stand");
  assert.equal(result?.category, "FOOD_VENDOR");
  assert.equal(result?.source, "rules");
});

test("classifyBusinessCategory detects a Mechanic business, not Retail, despite 'shop' appearing", async () => {
  const result = await classifyBusinessCategory("Car repair shop, we fix engines and gearboxes");
  assert.equal(result?.category, "MECHANIC");
});

test("classifyBusinessCategory detects Hair Braider specifically, not the general Salon bucket", async () => {
  const result = await classifyBusinessCategory("I do braids, cornrows and weaves from home");
  assert.equal(result?.category, "HAIR_BRAIDER");
});

test("classifyBusinessCategory detects Nail Technician specifically", async () => {
  const result = await classifyBusinessCategory("Gel nails and manicures, mobile service");
  assert.equal(result?.category, "NAIL_TECHNICIAN");
});

test("classifyBusinessCategory falls back to the general Salon bucket for plain hair/beauty text", async () => {
  const result = await classifyBusinessCategory("Ladies hair salon, blow dries and styling");
  assert.equal(result?.category, "SALON");
});

test("classifyBusinessCategory distinguishes Tuck Shop from Food Vendor", async () => {
  const result = await classifyBusinessCategory("Spaza shop selling airtime, snacks and cooldrinks");
  assert.equal(result?.category, "TUCK_SHOP");
});

test("classifyBusinessCategory returns null for text that matches nothing — never guesses, never returns OTHER", async () => {
  const result = await classifyBusinessCategory("asdkjhaskjdh random gibberish text");
  assert.equal(result, null);
});

test("classifyBusinessCategory returns null for an empty/whitespace-only description", async () => {
  assert.equal(await classifyBusinessCategory(""), null);
  assert.equal(await classifyBusinessCategory("   "), null);
});

test("classifyBusinessCategory never throws — a classifier error must resolve null, not reject", async () => {
  // Simulate the model path being selected but failing, by forcing a fetch
  // that always rejects — the wrapper's try/catch must swallow this.
  const original = process.env.ANTHROPIC_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.BUDDY_EXTERNAL_AI = "enabled";
  globalThis.fetch = (async () => {
    throw new Error("network unavailable");
  }) as typeof fetch;
  try {
    const result = await classifyBusinessCategory("we sell food");
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
    delete process.env.BUDDY_EXTERNAL_AI;
  }
});

test("classifyBusinessCategory never throws — a non-ok HTTP response must resolve null, not reject", async () => {
  const original = process.env.ANTHROPIC_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.BUDDY_EXTERNAL_AI = "enabled";
  globalThis.fetch = (async () => new Response("rate limited", { status: 429 })) as typeof fetch;
  try {
    const result = await classifyBusinessCategory("we sell food");
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
    delete process.env.BUDDY_EXTERNAL_AI;
  }
});

test("classifyBusinessCategory (model path) trusts only an exact allowlisted category in the response", async () => {
  const original = process.env.ANTHROPIC_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.BUDDY_EXTERNAL_AI = "enabled";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ content: [{ text: "FOOD_VENDOR" }] }), { status: 200 })) as typeof fetch;
  try {
    const result = await classifyBusinessCategory("we sell food");
    assert.equal(result?.category, "FOOD_VENDOR");
    assert.equal(result?.source, "model");
  } finally {
    globalThis.fetch = originalFetch;
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
    delete process.env.BUDDY_EXTERNAL_AI;
  }
});

test("classifyBusinessCategory (model path) rejects a hallucinated/non-enum response rather than trusting it", async () => {
  const original = process.env.ANTHROPIC_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.BUDDY_EXTERNAL_AI = "enabled";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ content: [{ text: "PET_GROOMING" }] }), { status: 200 })) as typeof fetch;
  try {
    const result = await classifyBusinessCategory("we sell food");
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
    delete process.env.BUDDY_EXTERNAL_AI;
  }
});

test("classifyBusinessCategory (model path) returns null, not OTHER, when the model itself says OTHER", async () => {
  const original = process.env.ANTHROPIC_API_KEY;
  const originalFetch = globalThis.fetch;
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.BUDDY_EXTERNAL_AI = "enabled";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ content: [{ text: "OTHER" }] }), { status: 200 })) as typeof fetch;
  try {
    const result = await classifyBusinessCategory("something truly unclassifiable");
    assert.equal(result, null);
  } finally {
    globalThis.fetch = originalFetch;
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
    delete process.env.BUDDY_EXTERNAL_AI;
  }
});
