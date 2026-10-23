import test from "node:test";
import assert from "node:assert/strict";
import { ALL_PERMISSIONS, NO_PERMISSIONS, type StaffPermissions } from "@/types";
import { STAFF_PRESETS } from "@/modules/staff/staff-presets";
import { actorCan, type StaffActor } from "@/lib/auth/guards";
import { buildBriefing, greetingFor } from "./briefing";
import type { BuddySnapshot } from "./buddy-snapshot";
import { ACTION_PERMISSION, BUDDY_ACTION_KINDS, NEVER_BUDDY_ACTIONS, PrepareRequestSchema } from "./buddy-actions";
import { NOT_IN_ROLE, NO_FORECAST, buildAssistantSystemPrompt, ruleBasedProvider, type AssistantContext } from "./llm-provider";

/** Pure rules of the Business Buddy — what each role is told and offered. */

const actor = (permissions: StaffPermissions, isOwner = false): StaffActor => ({ tenantId: "biz-a", staffId: "s1", isOwner, permissions });
const OWNER = actor(ALL_PERMISSIONS, true);
const MANAGER = actor(STAFF_PRESETS.MANAGER.permissions);
const KITCHEN = actor(STAFF_PRESETS.KITCHEN.permissions);
const DRIVER = actor(STAFF_PRESETS.DRIVER.permissions);

// 07:30 in South Africa.
const MORNING = new Date("2026-10-06T05:30:00Z");

function fullSnapshot(): BuddySnapshot {
  return {
    businessName: "Kota Tainment",
    now: MORNING,
    orders: { needsAttention: 3, toPrepare: 2, ready: 0 },
    storefront: { visits: 120, topItem: { kind: "PRODUCT", id: "p-russian", name: "Russian Kota", isFeatured: false } },
  };
}

test("example: owner gets the morning briefing with a preparable recommendation", () => {
  const b = buildBriefing(fullSnapshot(), OWNER);
  assert.equal(b.greeting, "Good morning, Kota Tainment.");
  assert.equal(b.attention[0].text, "3 orders need attention.");
  assert.ok(b.highlights.some((h) => h.text === "Your Russian Kota is receiving the most storefront engagement."));
  const feature = b.recommendations.find((r) => r.key === "feature-top-item")!;
  assert.equal(feature.text, "Feature Russian Kota on your homepage.");
  assert.deepEqual(feature.action, { kind: "FEATURE_ITEM", params: { itemType: "PRODUCT", itemId: "p-russian", featured: true } });
});

test("greeting follows South African time", () => {
  assert.equal(greetingFor(new Date("2026-10-06T09:59:00Z"), "X"), "Good morning, X.");
  assert.equal(greetingFor(new Date("2026-10-06T10:00:00Z"), "X"), "Good afternoon, X.");
  assert.equal(greetingFor(new Date("2026-10-06T15:00:00Z"), "X"), "Good evening, X.");
});

test("manager may feature an item (canManageServices) — same gate as the Catalogue page", () => {
  const rec = buildBriefing(fullSnapshot(), MANAGER).recommendations.find((r) => r.key === "feature-top-item")!;
  assert.ok(rec.action, "manager gets the button");
  assert.equal(rec.blocked, undefined);
});

test("restricted staff: a recommendation they can't act on has no action, and says who can", () => {
  // Even if a restricted person's snapshot somehow held storefront data, no button is offered.
  const rec = buildBriefing(fullSnapshot(), KITCHEN).recommendations.find((r) => r.key === "feature-top-item")!;
  assert.equal(rec.action, undefined);
  assert.match(rec.blocked!, /Ask the business owner/);
});

test("kitchen's 'to prepare' links to the kitchen screen, not the full orders page", () => {
  const snap: BuddySnapshot = { businessName: "K", now: MORNING, orders: { toPrepare: 4 } };
  const b = buildBriefing(snap, KITCHEN);
  assert.deepEqual(b.attention.map((l) => [l.text, l.href]), [["4 orders to prepare.", "/dashboard/kitchen"]]);
});

test("an area missing from the snapshot is never mentioned", () => {
  const b = buildBriefing({ businessName: "K", now: MORNING }, DRIVER);
  assert.equal(b.attention.length + b.highlights.length + b.recommendations.length, 0);
  assert.equal(b.allClear, true);
});

test("high-risk work is only ever a link, never a preparable action", () => {
  const snap: BuddySnapshot = { ...fullSnapshot(), refundsDue: 1 };
  const b = buildBriefing(snap, OWNER);
  for (const r of b.recommendations.filter((r) => r.key === "refunds" || r.key === "orders")) {
    assert.equal(r.action, undefined);
    assert.ok(r.href);
  }
});

test("the action catalogue holds only low-risk kinds; high-risk kinds are rejected outright", () => {
  // APPLY_PRODUCT_TEXT: a product description/title the person already previewed, through the same updateProduct the catalogue form uses.
  assert.deepEqual([...BUDDY_ACTION_KINDS].sort(), ["APPLY_PRODUCT_TEXT", "DRAFT_STOREFRONT", "FEATURE_ITEM"]);
  for (const kind of NEVER_BUDDY_ACTIONS) {
    assert.equal(PrepareRequestSchema.safeParse({ kind, params: {} }).success, false, kind);
  }
  // No smuggling extra params (e.g. a businessId) into an allowed kind.
  assert.equal(
    PrepareRequestSchema.safeParse({ kind: "FEATURE_ITEM", params: { itemType: "PRODUCT", itemId: "p1", featured: true, businessId: "other" } }).success,
    false,
  );
  assert.equal(PrepareRequestSchema.safeParse({ kind: "FEATURE_ITEM", params: { itemType: "PRODUCT", itemId: "p1", featured: true }, tenantId: "x" }).success, false);
});

test("each action needs the same permission the dashboard uses; the role matrix follows", () => {
  assert.equal(ACTION_PERMISSION.FEATURE_ITEM, "canManageServices");
  assert.equal(ACTION_PERMISSION.DRAFT_STOREFRONT, "canManageSettings");
  const matrix = Object.fromEntries(
    [["OWNER", OWNER], ["MANAGER", MANAGER], ["KITCHEN", KITCHEN], ["DRIVER", DRIVER]].map(([name, a]) => [
      name,
      BUDDY_ACTION_KINDS.filter((k) => actorCan(a as StaffActor, ACTION_PERMISSION[k])),
    ]),
  );
  assert.deepEqual(matrix, { OWNER: ["FEATURE_ITEM", "DRAFT_STOREFRONT", "APPLY_PRODUCT_TEXT"], MANAGER: ["FEATURE_ITEM", "APPLY_PRODUCT_TEXT"], KITCHEN: [], DRIVER: [] });
});

test("actorCan: missing permission keys read false (fail closed)", () => {
  assert.equal(actorCan(actor({ ...NO_PERMISSIONS }), "canManageServices"), false);
  assert.equal(actorCan(actor({ ...NO_PERMISSIONS, canReadBookings: true }), ["canManageBookings", "canReadBookings"]), true);
});

// ---------------------------------------------------------------------------
// Chat: answers only from what the person may see
// ---------------------------------------------------------------------------

const restrictedContext: AssistantContext = { businessName: "Kota Tainment", briefing: ["2 orders to prepare."] };

test("chat (rules): a restricted person is told their role doesn't include it — never the data", async () => {
  assert.equal(await ruleBasedProvider.answer("who are my regulars?", restrictedContext), NOT_IN_ROLE("customer details"));
  assert.equal(await ruleBasedProvider.answer("who has lapsed?", restrictedContext), NOT_IN_ROLE("customer details"));
  assert.equal(await ruleBasedProvider.answer("how much money did we make?", restrictedContext), NOT_IN_ROLE("orders and sales"));
  assert.equal(await ruleBasedProvider.answer("any bookings coming up?", restrictedContext), NOT_IN_ROLE("bookings"));
  assert.equal(await ruleBasedProvider.answer("what needs attention today?", restrictedContext), "2 orders to prepare.");
});

test("chat (model prompt): withheld areas are absent and named as withheld; the model can't claim to act", () => {
  const prompt = buildAssistantSystemPrompt(restrictedContext);
  assert.match(prompt, /role does not include: customer details, orders and sales, bookings/);
  assert.doesNotMatch(prompt, /Top regulars|Lapsed 30\+|This week's orders|Upcoming bookings/);
  assert.match(prompt, /must never say you have/);

  const full = buildAssistantSystemPrompt({
    ...restrictedContext,
    customers: { total: 2, regulars: [{ name: "Thandi", stamps: 9 }], lapsed: [] },
    ordersThisWeek: { count: 5, total: "R 500.00" },
    upcomingAppointments: [],
  });
  assert.match(full, /Thandi \(9\)/);
  assert.doesNotMatch(full, /role does not include/);
});

// ---------------------------------------------------------------------------
// Chat: the cash-flow forecast, answered by the rules path
// ---------------------------------------------------------------------------

const forecastContext: AssistantContext = {
  businessName: "Kota Tainment",
  briefing: ["2 orders to prepare."],
  forecast: {
    nextWeek: "R 2 800.00",
    fourWeeks: "R 11 200.00",
    lines: ["Next week looks like about R 2 800.00.", "Saturday is your big day, averaging R 720.00."],
  },
};

test("chat (rules): a forecast question is answered with the forecast, not this week's orders", async () => {
  for (const question of [
    "what does next week look like?",
    "what is my cash flow forecast?",
    "how much will I make next month?",
    "which is my busiest day?",
    "what are my slow days?",
  ]) {
    assert.equal(
      await ruleBasedProvider.answer(question, forecastContext),
      forecastContext.forecast!.lines.join(" "),
      question,
    );
  }
});

test("chat (rules): without the plan or the permission, the forecast answer explains both, and no figure leaks", async () => {
  assert.equal(await ruleBasedProvider.answer("what does next week look like?", restrictedContext), NO_FORECAST);
  assert.doesNotMatch(NO_FORECAST, /R \d/);
});

test("chat (rules): the forecast case leaves the other cases exactly as they were", async () => {
  // "today" and a bare "next" still reach the briefing; sales still reach the
  // orders case rather than being swallowed by the forecast pattern.
  assert.equal(await ruleBasedProvider.answer("what needs attention today?", forecastContext), "2 orders to prepare.");
  assert.equal(await ruleBasedProvider.answer("what's next?", forecastContext), "2 orders to prepare.");
  assert.equal(
    await ruleBasedProvider.answer("how much money did we make?", { ...forecastContext, ordersThisWeek: { count: 5, total: "R 500.00" } }),
    "This week: 5 orders, totalling R 500.00.",
  );
});

test("chat (rules): the help line offers the forecast only when the person has one", async () => {
  const offered = await ruleBasedProvider.answer("tell me a joke", forecastContext);
  assert.match(offered, /what the next four weeks look like/);
  const withheld = await ruleBasedProvider.answer("tell me a joke", restrictedContext);
  assert.doesNotMatch(withheld, /next four weeks/);
});

test("chat (model prompt): the forecast is handed over as figures the model may not rework", () => {
  const prompt = buildAssistantSystemPrompt(forecastContext);
  assert.match(prompt, /next week about R 2 800\.00, the next four weeks about R 11 200\.00/);
  assert.match(prompt, /quote these figures, never your own/);
  assert.doesNotMatch(buildAssistantSystemPrompt(restrictedContext), /Cash-flow forecast/);
});
