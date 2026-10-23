import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { ALL_PERMISSIONS, type StaffPermissions } from "@/types";
import { STAFF_PRESETS } from "@/modules/staff/staff-presets";
import { AuthError } from "@/lib/auth/guards";
import { assertFeature, EntitlementError } from "@/lib/auth/entitlement-guards";
import { getBusinessEntitlements, changeBusinessPlan, setSubscriptionStatus, listPublicPlans, UnknownPlanError } from "./subscription.service";
import { hasFeature, featureLimit } from "./entitlements";
import { toShowcasePlan } from "@/app/showcase/data";

/**
 * Entitlements against the real database, using the plans the migration
 * seeds (FREE default / GROW / PRO). Fixture businesses carry a unique run
 * suffix and are removed in `after`.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const created: string[] = [];
const DAY = 24 * 60 * 60 * 1000;

async function business(label: string) {
  const row = await prisma.business.create({ data: { name: label, slug: `ent-${label}-${run}`, status: "ACTIVE" }, select: { id: true } });
  created.push(row.id);
  return row.id;
}

test.after(async () => {
  await prisma.entitlementOverride.deleteMany({ where: { businessId: { in: created } } });
  await prisma.businessSubscription.deleteMany({ where: { businessId: { in: created } } });
  await prisma.business.deleteMany({ where: { id: { in: created } } });
});

test("the seeded catalogue: exactly one default plan, FREE is free, GROW and PRO priced", async () => {
  assert.equal(await prisma.plan.count({ where: { isDefault: true } }), 1);
  const plans = await listPublicPlans();
  assert.deepEqual(plans.map((p) => p.code), ["FREE", "GROW", "PRO"]);
  // The prices Chuma set (docs/specs/2026-10-21-plans.md §2), applied by
  // migration 20261022110000. Pinned here because an unpriced paid plan is
  // what this test used to assert, and a silent return to NULL would put
  // "Pricing coming soon" back on the showcase.
  assert.equal(plans[0].priceCents, 0);
  assert.equal(plans[1].priceCents, 59900);
  assert.equal(plans[2].priceCents, 129900);
});

test("missing subscription → the default (free) plan, a genuinely usable business", async () => {
  const id = await business("missing");
  const e = await getBusinessEntitlements(id);
  assert.equal(e.planCode, "FREE");
  assert.equal(e.state, "NO_SUBSCRIPTION");
  assert.equal(hasFeature(e, "basic_analytics"), true);
  assert.equal(hasFeature(e, "loyalty"), true);
  assert.equal(hasFeature(e, "custom_domain"), false);
  assert.equal(hasFeature(e, "advanced_analytics"), false);
});

test("a new business's subscription row (no planId) resolves to the default plan", async () => {
  const id = await business("new");
  await prisma.businessSubscription.create({ data: { businessId: id } });
  const e = await getBusinessEntitlements(id);
  assert.equal(e.planCode, "FREE");
  assert.equal(e.state, "ACTIVE");
});

test("paid business: PRO grants custom_domain and higher limits", async () => {
  const id = await business("paid");
  await changeBusinessPlan(id, "PRO", { currentPeriodEnd: new Date(Date.now() + 20 * DAY) });
  const e = await getBusinessEntitlements(id);
  assert.equal(e.planCode, "PRO");
  assert.equal(e.state, "ACTIVE");
  assert.equal(hasFeature(e, "custom_domain"), true);
  assert.equal(hasFeature(e, "advanced_analytics"), true);
  assert.equal(featureLimit(e, "max_staff"), 20);
});

test("expired subscription → back on the default plan", async () => {
  const id = await business("expired");
  await changeBusinessPlan(id, "PRO");
  await setSubscriptionStatus(id, "EXPIRED");
  const e = await getBusinessEntitlements(id);
  assert.equal(e.planCode, "FREE");
  assert.equal(e.state, "EXPIRED");
  assert.equal(hasFeature(e, "custom_domain"), false);
});

test("cancelled subscription keeps the paid plan until the period ends, then drops", async () => {
  const id = await business("cancelled");
  await changeBusinessPlan(id, "GROW", { currentPeriodEnd: new Date(Date.now() + 5 * DAY) });
  const sub = await setSubscriptionStatus(id, "CANCELLED");
  assert.ok(sub.cancelledAt, "cancellation is timestamped");

  const now = await getBusinessEntitlements(id);
  assert.equal(now.planCode, "GROW");
  assert.equal(now.state, "CANCELLED_PENDING");

  const later = await getBusinessEntitlements(id, new Date(Date.now() + 6 * DAY));
  assert.equal(later.planCode, "FREE");
  assert.equal(later.state, "EXPIRED");
});

test("grace period: a failed payment keeps the plan until graceEndsAt", async () => {
  const id = await business("grace");
  await changeBusinessPlan(id, "PRO", { currentPeriodEnd: new Date(Date.now() - DAY) });
  await setSubscriptionStatus(id, "PAST_DUE", { graceEndsAt: new Date(Date.now() + 3 * DAY) });

  const inGrace = await getBusinessEntitlements(id);
  assert.equal(inGrace.state, "GRACE");
  assert.equal(hasFeature(inGrace, "custom_domain"), true);

  const afterGrace = await getBusinessEntitlements(id, new Date(Date.now() + 4 * DAY));
  assert.equal(afterGrace.planCode, "FREE");
});

test("changing plan to an unknown code is refused", async () => {
  const id = await business("unknown-plan");
  await assert.rejects(changeBusinessPlan(id, "PLATINUM"), UnknownPlanError);
});

test("tenant isolation: one business's plan and overrides never reach another", async () => {
  const a = await business("iso-a");
  const b = await business("iso-b");
  await changeBusinessPlan(a, "PRO");
  await prisma.entitlementOverride.create({
    data: { businessId: a, featureKey: "multi_location", enabled: true, reason: "pilot" },
  });

  const ea = await getBusinessEntitlements(a);
  const eb = await getBusinessEntitlements(b);
  assert.equal(hasFeature(ea, "custom_domain"), true);
  assert.equal(hasFeature(ea, "multi_location"), true);
  assert.equal(eb.planCode, "FREE");
  assert.equal(hasFeature(eb, "custom_domain"), false);
  assert.equal(hasFeature(eb, "multi_location"), false);
});

test("an expired override stops applying", async () => {
  const id = await business("override-expired");
  await prisma.entitlementOverride.create({
    data: { businessId: id, featureKey: "custom_domain", enabled: true, reason: "trial", expiresAt: new Date(Date.now() - DAY) },
  });
  assert.equal(hasFeature(await getBusinessEntitlements(id), "custom_domain"), false);
});

// ---------------------------------------------------------------------------
// Permission × entitlement. guards.ts needs a Next.js request scope this
// harness can't provide (see dashboard-read-access.test.ts), so the PERSON
// side uses the real role permission data each dashboard surface checks;
// the BUSINESS side is the real assertFeature over real resolved entitlements.
// ---------------------------------------------------------------------------

type Who = { label: string; permissions: StaffPermissions };
const OWNER: Who = { label: "owner", permissions: ALL_PERMISSIONS };
const KITCHEN: Who = { label: "kitchen", permissions: STAFF_PRESETS.KITCHEN.permissions };
const MANAGER: Who = { label: "manager", permissions: STAFF_PRESETS.MANAGER.permissions };

/** The order every guarded surface uses: person first, then plan. */
function decide(who: Who, permission: keyof StaffPermissions, entitlements: Awaited<ReturnType<typeof getBusinessEntitlements>>, feature: "custom_domain" | "advanced_analytics" | "basic_analytics") {
  if (!who.permissions[permission]) return "NO_PERMISSION";
  try {
    assertFeature(entitlements, feature);
    return "ALLOWED";
  } catch (error) {
    assert.ok(error instanceof EntitlementError);
    assert.ok(error instanceof AuthError, "handled like any other 403");
    assert.equal((error as AuthError).status, 403);
    return "NOT_IN_PLAN";
  }
}

test("permission + entitlement: both must allow; neither can stand in for the other", async () => {
  const free = await getBusinessEntitlements(await business("combo-free"));
  const proId = await business("combo-pro");
  await changeBusinessPlan(proId, "PRO");
  const pro = await getBusinessEntitlements(proId);

  // Custom domains: canManageDomains × custom_domain
  assert.equal(decide(OWNER, "canManageDomains", pro, "custom_domain"), "ALLOWED");
  assert.equal(decide(OWNER, "canManageDomains", free, "custom_domain"), "NOT_IN_PLAN");
  assert.equal(decide(KITCHEN, "canManageDomains", pro, "custom_domain"), "NO_PERMISSION", "a paid plan never grants a person anything");

  // Analytics: canViewAnalytics × basic/advanced_analytics
  assert.equal(decide(MANAGER, "canViewAnalytics", free, "basic_analytics"), MANAGER.permissions.canViewAnalytics ? "ALLOWED" : "NO_PERMISSION");
  assert.equal(decide(OWNER, "canViewAnalytics", free, "advanced_analytics"), "NOT_IN_PLAN");
  assert.equal(decide(OWNER, "canViewAnalytics", pro, "advanced_analytics"), "ALLOWED");
  assert.equal(decide(KITCHEN, "canViewAnalytics", pro, "basic_analytics"), "NO_PERMISSION");
});

test("the showcase lists exactly what the plans grant", async () => {
  const plans = (await listPublicPlans()).map(toShowcasePlan);
  const free = plans.find((p) => p.code === "FREE")!;
  const pro = plans.find((p) => p.code === "PRO")!;
  assert.equal(free.priceLabel, "Free");
  assert.equal(pro.priceLabel, "R 1 299.00 / month");
  assert.equal(free.features.find((f) => f.key === "custom_domain")?.included, false);
  assert.equal(pro.features.find((f) => f.key === "custom_domain")?.included, true);
  assert.deepEqual(free.limits.find((l) => l.label === "Team members"), { label: "Team members", value: "2" });
});

test("advanced_storefront is granted on GROW and PRO only — the customer workflows are paid", async () => {
  // Chuma's decision of 2026-10-21, applied by 20261022110100. Phase A had
  // withdrawn this key along with four others for having no enforcement site;
  // it came back because the storefront-websites tab built one (quote request,
  // enquiry, pickup, callback, the ENQUIRE action and the Enquiries inbox).
  const rows = await prisma.planEntitlement.findMany({
    where: { featureKey: "advanced_storefront" },
    select: { id: true, planId: true, enabled: true, limitValue: true },
    orderBy: { id: "asc" },
  });
  assert.deepEqual(rows, [
    { id: "pe_grow_advanced_storefront", planId: "plan_grow", enabled: true, limitValue: null },
    { id: "pe_pro_advanced_storefront", planId: "plan_pro", enabled: true, limitValue: null },
  ]);

  // Entitlements, not just rows: a FREE business must not have it, or the four
  // workflows are free to everyone and the grant means nothing.
  const plans = await listPublicPlans();
  const included = (code: string) =>
    plans.find((p) => p.code === code)!.entitlements.some((e) => e.featureKey === "advanced_storefront" && e.enabled);
  assert.equal(included("FREE"), false);
  assert.equal(included("GROW"), true);
  assert.equal(included("PRO"), true);
});

test("the other four keys Phase A withdrew stay withdrawn", async () => {
  // Guards the asymmetry: only advanced_storefront earned its way back, and it
  // did so by acquiring an enforcement site (docs/specs/2026-10-21-plans.md §2.1).
  const rows = await prisma.planEntitlement.findMany({
    where: {
      featureKey: { in: ["advanced_staff", "advanced_ai", "multi_location", "advanced_business_insights"] },
    },
    select: { featureKey: true },
  });
  assert.deepEqual(rows, []);
});
