import test from "node:test";
import assert from "node:assert/strict";
import { QUESTIONS, suggestionsFor, answerText, isAnswered, type Answers } from "./questions";
import { planPages } from "./onboarding-provider";
import { shouldOpenInterview, type ProfileView } from "./onboarding.service";

/**
 * Pure-logic tests only — no database. Everything covered here is a decision
 * the interview makes on its own: which options an owner is shown, whether
 * they get a dialog or a card, and which pages we commit to building for
 * them. The last of those is the one with teeth: planPages is what the
 * storefront generator ultimately acts on, so it stays deterministic and
 * pinned by tests rather than left to a model.
 */

function profile(over: Partial<ProfileView> = {}): ProfileView {
  return {
    status: "IN_PROGRESS",
    answers: {},
    currentStep: 0,
    brief: null,
    briefSource: null,
    skippedAt: null,
    completedAt: null,
    ...over,
  };
}

// --- when the interview shows up -------------------------------------------

test("a business with no profile at all is interviewed — the just-registered case", () => {
  assert.equal(shouldOpenInterview(null), true);
});

test("an interview in progress that was never put off reopens where it left off", () => {
  assert.equal(shouldOpenInterview(profile({ currentStep: 3 })), true);
});

test('"remind me later" stops the dialog reopening on every single visit', () => {
  assert.equal(shouldOpenInterview(profile({ skippedAt: new Date() })), false);
});

test("a completed interview never reopens, skipped or not", () => {
  assert.equal(shouldOpenInterview(profile({ status: "COMPLETED", completedAt: new Date() })), false);
  assert.equal(
    shouldOpenInterview(profile({ status: "COMPLETED", skippedAt: new Date() })),
    false,
  );
});

// --- the tap-first options --------------------------------------------------

test("the first question's options come from the business category, so it's answerable by tapping", () => {
  const salon = suggestionsFor("sells", "SALON");
  const food = suggestionsFor("sells", "FOOD_VENDOR");
  assert.ok(salon.includes("Braids"), "a salon is offered salon work");
  assert.ok(food.includes("Kota"), "a food vendor is offered food");
  assert.notDeepEqual(salon, food, "the two categories are genuinely different lists");
});

test("a category with no curated list still gets usable options, never an empty screen", () => {
  const other = suggestionsFor("sells", "OTHER");
  assert.ok(other.length > 0);
});

test("every other question falls back to its own declared options", () => {
  for (const q of QUESTIONS) {
    if (q.id === "sells") continue;
    assert.deepEqual(suggestionsFor(q.id, "OTHER"), q.options, `${q.id} keeps its options`);
    assert.ok(q.options.length > 0, `${q.id} has something to tap`);
  }
});

test("an unknown question id returns nothing rather than throwing", () => {
  assert.deepEqual(suggestionsFor("not-a-question", "SALON"), []);
});

// --- answer shape -----------------------------------------------------------

test("answers read back as a readable phrase whether they're one chip or several", () => {
  const answers: Answers = { sells: ["Braids", "Cuts"], where: ["I deliver"] };
  assert.equal(answerText(answers, "sells"), "Braids, Cuts");
  assert.equal(answerText(answers, "where"), "I deliver");
  assert.equal(answerText(answers, "busy"), "", "an unanswered question is empty, not undefined");
});

test("an empty selection counts as unanswered — no question is ever mandatory", () => {
  assert.equal(isAnswered({ sells: [] }, "sells"), false);
  assert.equal(isAnswered({ sells: ["  "] }, "sells"), true);
  assert.equal(isAnswered({}, "sells"), false);
});

// --- the page plan ----------------------------------------------------------

test("every plan has a Home page, even when the owner answered nothing", () => {
  const pages = planPages({});
  assert.equal(pages.length, 1);
  assert.equal(pages[0].page, "Home");
});

test("wanting bookings produces a booking page; not wanting them doesn't", () => {
  const withBookings = planPages({ goal: ["Take bookings"] }).map((p) => p.page);
  const without = planPages({ goal: ["Look professional"] }).map((p) => p.page);
  assert.ok(withBookings.includes("Book a time"));
  assert.ok(!without.includes("Book a time"));
});

test("we never plan an ordering page for someone who didn't ask to take orders", () => {
  const pages = planPages({ goal: ["Show my prices"] }).map((p) => p.page);
  assert.ok(!pages.includes("Order online"), "an order page we can't fulfil is worse than none");
  assert.ok(pages.includes("What we sell (with prices)"), "but prices were asked for");
});

test("delivering or travelling to the customer adds a delivery-areas page", () => {
  for (const answer of ["I deliver", "I travel to the customer", "Both — they come to me and I deliver"]) {
    const pages = planPages({ where: [answer] }).map((p) => p.page);
    assert.ok(
      pages.includes("Delivery & areas we cover"),
      `"${answer}" should set delivery expectations`,
    );
  }
});

test("a shopfront business gets directions instead of a delivery area", () => {
  const pages = planPages({ where: ["At my shop or salon"] }).map((p) => p.page);
  assert.ok(pages.includes("Find us"));
  assert.ok(!pages.includes("Delivery & areas we cover"));
});

test("already being on WhatsApp puts WhatsApp in the plan — we meet customers where they are", () => {
  const pages = planPages({ ordering: ["WhatsApp"] }).map((p) => p.page);
  assert.ok(pages.includes("WhatsApp button on every page"));
});

test("every planned page carries the answer that justified it, so the plan is reviewable", () => {
  const pages = planPages({
    goal: ["Take orders", "Take bookings", "Build a customer list"],
    where: ["I deliver"],
    ordering: ["WhatsApp"],
  });
  assert.ok(pages.length > 1);
  for (const p of pages) {
    assert.ok(p.because.trim().length > 0, `${p.page} explains itself`);
  }
  const names = pages.map((p) => p.page);
  assert.equal(new Set(names).size, names.length, "no page is planned twice");
});
