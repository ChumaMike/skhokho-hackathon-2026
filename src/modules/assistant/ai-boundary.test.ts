import test from "node:test";
import assert from "node:assert/strict";
import { answerWithFallback, buildAssistantSystemPrompt, externalAssistantEnabled, getAssistantProvider, pseudonymiseForModel, type AssistantContext } from "./llm-provider";

/** B10 — what the Business Buddy may send to an external AI provider. */

const ctx: AssistantContext = {
  businessName: "Kota Tainment",
  briefing: ["3 orders need attention."],
  customers: {
    total: 40,
    regulars: [{ name: "Thandi Mokoena", stamps: 9 }, { name: "Sipho", stamps: 7 }],
    lapsed: [{ name: "Lerato", lastSeen: new Date("2026-08-01") }],
  },
  ordersThisWeek: { count: 12, total: "R 1 560.00" },
  upcomingAppointments: [{ customerName: "Thandi Mokoena", serviceName: "Braids", startTime: new Date("2026-10-08T08:00:00Z") }],
};

function withEnv(env: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("external AI is OFF by default — even with an API key configured", () => {
  withEnv({ ANTHROPIC_API_KEY: "sk-test", BUDDY_EXTERNAL_AI: undefined }, () => {
    assert.equal(externalAssistantEnabled(), false);
    assert.equal(getAssistantProvider().source, "rules");
  });
  withEnv({ ANTHROPIC_API_KEY: undefined, BUDDY_EXTERNAL_AI: "enabled" }, () => {
    assert.equal(externalAssistantEnabled(), false, "no key → still off");
  });
  withEnv({ ANTHROPIC_API_KEY: "sk-test", BUDDY_EXTERNAL_AI: "enabled" }, () => {
    assert.equal(externalAssistantEnabled(), true);
  });
});

test("rules-only mode answers locally without any network call", async () => {
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error("no network in rules mode");
  }) as typeof fetch;
  try {
    const { source, text } = await answerWithFallback("who are my regulars?", ctx);
    assert.equal(source, "rules");
    assert.match(text, /Thandi Mokoena/, "local answers can use real names — nothing left the server");
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("data minimisation: no customer name reaches the model's prompt or question", () => {
  const { ctx: safe, question } = pseudonymiseForModel("Has Thandi Mokoena booked? And Lerato?", ctx);
  const prompt = buildAssistantSystemPrompt(safe);
  for (const name of ["Thandi Mokoena", "Sipho", "Lerato"]) {
    assert.equal(prompt.includes(name), false, `${name} in prompt`);
    assert.equal(question.includes(name), false, `${name} in question`);
  }
  assert.match(prompt, /Customer 1/);
  assert.match(prompt, /Kota Tainment/, "the business's own name is business data");
  // The same person gets the same label everywhere.
  assert.equal(safe.upcomingAppointments![0].customerName, safe.customers!.regulars[0].name);
});

test("labels are swapped back locally in the answer", () => {
  const { restore } = pseudonymiseForModel("x", ctx);
  assert.equal(restore("Customer 1 and Customer 3 are regulars; Customer 2 has lapsed?"), "Thandi Mokoena and Lerato are regulars; Sipho has lapsed?");
});

test("restoration handles double-digit labels without clobbering", () => {
  const many: AssistantContext = {
    ...ctx,
    customers: { total: 12, regulars: Array.from({ length: 12 }, (_, i) => ({ name: `Person${i + 1}`, stamps: 1 })), lapsed: [] },
    upcomingAppointments: [],
  };
  const { restore } = pseudonymiseForModel("x", many);
  assert.equal(restore("Customer 12 then Customer 1"), "Person12 then Person1");
});

test("a live model call (when enabled) sends only pseudonymised data", async () => {
  const realFetch = globalThis.fetch;
  let sentBody = "";
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    sentBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ content: [{ text: "Customer 1 is your top regular." }] }), { status: 200 });
  }) as typeof fetch;
  const saved = { key: process.env.ANTHROPIC_API_KEY, flag: process.env.BUDDY_EXTERNAL_AI };
  process.env.ANTHROPIC_API_KEY = "sk-test";
  process.env.BUDDY_EXTERNAL_AI = "enabled";
  try {
    const { source, text } = await answerWithFallback("Is Thandi Mokoena my best customer?", ctx);
    assert.equal(source, "model");
    for (const name of ["Thandi Mokoena", "Sipho", "Lerato"]) assert.equal(sentBody.includes(name), false, `${name} sent to the provider`);
    assert.equal(text, "Thandi Mokoena is your top regular.");
  } finally {
    globalThis.fetch = realFetch;
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.flag === undefined) delete process.env.BUDDY_EXTERNAL_AI;
    else process.env.BUDDY_EXTERNAL_AI = saved.flag;
  }
});
