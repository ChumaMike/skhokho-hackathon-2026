import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveEntitlements,
  subscriptionAccess,
  hasFeature,
  featureLimit,
  withinLimit,
  SUBSCRIPTION_GRACE_DAYS,
  type PlanInput,
  type SubscriptionInput,
} from "./entitlements";
import { FEATURE_KEYS } from "./features";

const NOW = new Date("2026-10-04T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

// Shaped like the seeded rows, but the codes here are arbitrary on purpose:
// nothing in the resolver may depend on a plan's code.
const FREE: PlanInput = {
  id: "p-free",
  code: "STARTER_TIER",
  name: "Free",
  entitlements: [
    { featureKey: "basic_analytics", enabled: true, limitValue: null },
    { featureKey: "loyalty", enabled: true, limitValue: null },
    { featureKey: "max_staff", enabled: true, limitValue: 2 },
  ],
};
const PAID: PlanInput = {
  id: "p-paid",
  code: "TOP_TIER",
  name: "Pro",
  entitlements: [
    { featureKey: "basic_analytics", enabled: true, limitValue: null },
    { featureKey: "advanced_analytics", enabled: true, limitValue: null },
    { featureKey: "custom_domain", enabled: true, limitValue: null },
    { featureKey: "max_staff", enabled: true, limitValue: 20 },
    { featureKey: "max_products", enabled: true, limitValue: null },
  ],
};

function onPaid(sub: Partial<NonNullable<SubscriptionInput>>) {
  return resolveEntitlements({
    subscription: { planId: PAID.id, status: "ACTIVE", currentPeriodEnd: null, graceEndsAt: null, ...sub },
    subscribedPlan: PAID,
    defaultPlan: FREE,
    overrides: [],
    now: NOW,
  });
}

// ---------------------------------------------------------------------------
// Free / missing subscription
// ---------------------------------------------------------------------------

test("missing subscription → the default plan", () => {
  const e = resolveEntitlements({ subscription: null, subscribedPlan: null, defaultPlan: FREE, overrides: [], now: NOW });
  assert.equal(e.planName, "Free");
  assert.equal(e.state, "NO_SUBSCRIPTION");
  assert.equal(hasFeature(e, "basic_analytics"), true);
  assert.equal(hasFeature(e, "custom_domain"), false);
});

test("a subscription with no planId → the default plan", () => {
  const e = resolveEntitlements({
    subscription: { planId: null, status: "ACTIVE", currentPeriodEnd: null, graceEndsAt: null },
    subscribedPlan: null,
    defaultPlan: FREE,
    overrides: [],
    now: NOW,
  });
  assert.equal(e.planName, "Free");
  assert.equal(e.state, "ACTIVE", "planId null is the default plan, not a fallback");
});

test("free business: free features on, paid features off, limits from the plan", () => {
  const e = resolveEntitlements({ subscription: null, subscribedPlan: null, defaultPlan: FREE, overrides: [], now: NOW });
  assert.equal(hasFeature(e, "loyalty"), true);
  assert.equal(hasFeature(e, "advanced_analytics"), false);
  assert.equal(featureLimit(e, "max_staff"), 2);
  assert.equal(withinLimit(e, "max_staff", 1), true);
  assert.equal(withinLimit(e, "max_staff", 2), false);
  // A limit feature the plan doesn't grant at all is a cap of 0, never unlimited.
  assert.equal(featureLimit(e, "max_products"), 0);
});

// ---------------------------------------------------------------------------
// Paid / lifecycle
// ---------------------------------------------------------------------------

test("paid business: its plan's features apply", () => {
  const e = onPaid({});
  assert.equal(e.planName, "Pro");
  assert.equal(e.state, "ACTIVE");
  assert.equal(hasFeature(e, "custom_domain"), true);
  assert.equal(featureLimit(e, "max_staff"), 20);
  assert.equal(featureLimit(e, "max_products"), null, "null limit = unlimited");
  assert.equal(withinLimit(e, "max_products", 1_000_000), true);
});

test("paid business inside its period: active, access until period end", () => {
  const e = onPaid({ currentPeriodEnd: day(10) });
  assert.equal(e.state, "ACTIVE");
  assert.deepEqual(e.accessUntil, day(10));
});

test("trialing business gets its plan", () => {
  const e = onPaid({ status: "TRIALING", currentPeriodEnd: day(5) });
  assert.equal(e.state, "TRIALING");
  assert.equal(hasFeature(e, "custom_domain"), true);
});

test("grace period: a lapsed period keeps the plan for the default grace days", () => {
  const lapsed = onPaid({ currentPeriodEnd: day(-2) });
  assert.equal(lapsed.state, "GRACE");
  assert.equal(hasFeature(lapsed, "custom_domain"), true);
  assert.deepEqual(lapsed.accessUntil, day(SUBSCRIPTION_GRACE_DAYS - 2));

  const pastGrace = onPaid({ currentPeriodEnd: day(-SUBSCRIPTION_GRACE_DAYS - 1) });
  assert.equal(pastGrace.state, "EXPIRED");
  assert.equal(pastGrace.planName, "Free");
});

test("grace period: PAST_DUE honours an explicit graceEndsAt", () => {
  const inGrace = onPaid({ status: "PAST_DUE", currentPeriodEnd: day(-20), graceEndsAt: day(1) });
  assert.equal(inGrace.state, "GRACE");
  assert.equal(hasFeature(inGrace, "custom_domain"), true);

  const graceOver = onPaid({ status: "PAST_DUE", currentPeriodEnd: day(-20), graceEndsAt: day(-1) });
  assert.equal(graceOver.state, "EXPIRED");
  assert.equal(hasFeature(graceOver, "custom_domain"), false);
});

test("PAST_DUE with no dates at all fails closed to the default plan", () => {
  const e = onPaid({ status: "PAST_DUE", currentPeriodEnd: null, graceEndsAt: null });
  assert.equal(e.state, "EXPIRED");
  assert.equal(hasFeature(e, "custom_domain"), false);
});

test("cancelled subscription keeps the plan until the period it paid for ends", () => {
  const pending = onPaid({ status: "CANCELLED", currentPeriodEnd: day(3) });
  assert.equal(pending.state, "CANCELLED_PENDING");
  assert.equal(hasFeature(pending, "custom_domain"), true);

  const ended = onPaid({ status: "CANCELLED", currentPeriodEnd: day(-1) });
  assert.equal(ended.state, "EXPIRED");
  assert.equal(ended.planName, "Free");
  // No grace after a deliberate cancellation.
  assert.equal(subscriptionAccess({ planId: "x", status: "CANCELLED", currentPeriodEnd: day(-1), graceEndsAt: null }, NOW).usesSubscribedPlan, false);
});

test("expired subscription → the default plan (features shrink, nothing else)", () => {
  const e = onPaid({ status: "EXPIRED", currentPeriodEnd: day(30) });
  assert.equal(e.state, "EXPIRED");
  assert.equal(e.planName, "Free");
  assert.equal(hasFeature(e, "basic_analytics"), true);
  assert.equal(hasFeature(e, "advanced_analytics"), false);
});

// ---------------------------------------------------------------------------
// Overrides & fail-closed behaviour
// ---------------------------------------------------------------------------

test("an unexpired override adjusts one feature; an expired one is ignored", () => {
  const base = { subscription: null, subscribedPlan: null, defaultPlan: FREE, now: NOW };
  const granted = resolveEntitlements({ ...base, overrides: [{ featureKey: "custom_domain", enabled: true, limitValue: null, expiresAt: day(1) }] });
  assert.equal(hasFeature(granted, "custom_domain"), true);

  const lapsed = resolveEntitlements({ ...base, overrides: [{ featureKey: "custom_domain", enabled: true, limitValue: null, expiresAt: day(-1) }] });
  assert.equal(hasFeature(lapsed, "custom_domain"), false);

  const revoked = resolveEntitlements({ ...base, overrides: [{ featureKey: "loyalty", enabled: false, limitValue: null, expiresAt: null }] });
  assert.equal(hasFeature(revoked, "loyalty"), false);

  const raised = resolveEntitlements({ ...base, overrides: [{ featureKey: "max_staff", enabled: true, limitValue: 10, expiresAt: null }] });
  assert.equal(featureLimit(raised, "max_staff"), 10);
});

test("unknown feature keys in data grant nothing", () => {
  const e = resolveEntitlements({
    subscription: null,
    subscribedPlan: null,
    defaultPlan: { ...FREE, entitlements: [{ featureKey: "everything", enabled: true, limitValue: null }] },
    overrides: [{ featureKey: "root_access", enabled: true, limitValue: null, expiresAt: null }],
    now: NOW,
  });
  assert.deepEqual(Object.keys(e.features).sort(), [...FEATURE_KEYS].sort());
  assert.ok(Object.values(e.features).every((grant) => !grant.enabled));
});

test("no default plan configured → nothing granted (fail closed)", () => {
  const e = resolveEntitlements({ subscription: null, subscribedPlan: null, defaultPlan: null, overrides: [], now: NOW });
  assert.equal(e.state, "UNCONFIGURED");
  assert.ok(FEATURE_KEYS.every((key) => !e.features[key].enabled));
});

test("an active subscription whose plan can't be loaded falls back honestly to the default plan", () => {
  const e = resolveEntitlements({
    subscription: { planId: "gone", status: "ACTIVE", currentPeriodEnd: null, graceEndsAt: null },
    subscribedPlan: null,
    defaultPlan: FREE,
    overrides: [],
    now: NOW,
  });
  assert.equal(e.planName, "Free");
  assert.equal(e.state, "NO_SUBSCRIPTION");
});

test("a disabled entitlement row disables the feature", () => {
  const e = resolveEntitlements({
    subscription: null,
    subscribedPlan: null,
    defaultPlan: { ...FREE, entitlements: [{ featureKey: "loyalty", enabled: false, limitValue: null }] },
    overrides: [],
    now: NOW,
  });
  assert.equal(hasFeature(e, "loyalty"), false);
});
