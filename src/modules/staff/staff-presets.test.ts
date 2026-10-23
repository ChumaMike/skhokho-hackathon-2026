import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { hashPassword } from "@/modules/auth/auth.service";
import { createBusiness } from "@/modules/tenant/tenant.service";
import {
  STAFF_PRESETS,
  LEGACY_PRESET_ROLE_TO_JOB_PRESET,
  resolveCanonicalPreset,
} from "@/modules/staff/staff-presets";

/**
 * Architecture-hardening pass: jobPreset is now the canonical, stable
 * preset identifier for all seven presets. presetRole (the P0 pass's
 * four-preset system) is kept only for backward compatibility and is
 * never read directly outside LEGACY_PRESET_ROLE_TO_JOB_PRESET — this file
 * proves that mapping is exact and that resolution never authorizes
 * anything (permissions remain the only mechanism, checked separately).
 */

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function makeBusiness(label: string) {
  const { business } = await createBusiness({
    name: `Preset Consolidation Test ${label}`,
    category: "SALON",
    owner: {
      firstName: "Owner",
      lastName: label,
      email: `preset-consolidation-owner-${label}-${suffix}@example.test`,
      passwordHash: await hashPassword("SomePassword123"),
    },
  });
  return business;
}

test.after(async () => {
  const businesses = await prisma.business.findMany({
    where: { name: { startsWith: "Preset Consolidation Test " } },
    select: { id: true },
  });
  for (const { id } of businesses) {
    await prisma.businessStaff.deleteMany({ where: { businessId: id } });
    await prisma.businessRole.deleteMany({ where: { businessId: id } });
    await prisma.businessSubscription.deleteMany({ where: { businessId: id } });
    await prisma.business.delete({ where: { id } });
  }
});

test("the legacy compatibility mapping is exactly MANAGER->MANAGER, STAFF->GENERAL, CASHIER->COUNTER, TECHNICIAN->SERVICE_PROVIDER", () => {
  assert.deepEqual(LEGACY_PRESET_ROLE_TO_JOB_PRESET, {
    MANAGER: "MANAGER",
    STAFF: "GENERAL",
    CASHIER: "COUNTER",
    TECHNICIAN: "SERVICE_PROVIDER",
  });
});

test("resolveCanonicalPreset prefers jobPreset over presetRole when both are set", () => {
  const result = resolveCanonicalPreset({ jobPreset: "KITCHEN", presetRole: "MANAGER" });
  assert.equal(result, "KITCHEN");
});

test("resolveCanonicalPreset falls back to the legacy mapping when jobPreset is null", () => {
  assert.equal(resolveCanonicalPreset({ jobPreset: null, presetRole: "CASHIER" }), "COUNTER");
  assert.equal(resolveCanonicalPreset({ jobPreset: null, presetRole: "TECHNICIAN" }), "SERVICE_PROVIDER");
  assert.equal(resolveCanonicalPreset({ jobPreset: null, presetRole: "STAFF" }), "GENERAL");
  assert.equal(resolveCanonicalPreset({ jobPreset: null, presetRole: "MANAGER" }), "MANAGER");
});

test("resolveCanonicalPreset returns null for a genuinely custom role (both fields null)", () => {
  assert.equal(resolveCanonicalPreset({ jobPreset: null, presetRole: null }), null);
  // A custom role stays representable this way even though it resolves to
  // nothing canonical — e.g. name: "Weekend Senior Team", jobPreset: null.
});

test("resolveCanonicalPreset returns null for an OWNER presetRole (owner isn't an invite preset)", () => {
  assert.equal(resolveCanonicalPreset({ jobPreset: null, presetRole: "OWNER" }), null);
});

test("createBusiness sets jobPreset on every one of the seven non-owner roles — no role relies on presetRole alone", async () => {
  const business = await makeBusiness("canonical-seed");
  const roles = await prisma.businessRole.findMany({ where: { businessId: business.id } });

  const nonOwnerRoles = roles.filter((r) => r.presetRole !== "OWNER");
  assert.equal(nonOwnerRoles.length, 7);
  for (const role of nonOwnerRoles) {
    assert.ok(role.jobPreset, `${role.name} must carry the canonical jobPreset identifier, not rely on presetRole alone`);
    assert.equal(resolveCanonicalPreset(role), role.jobPreset, "canonical resolution must agree with the stored jobPreset");
  }
});

test("no business can have two roles resolving to the same canonical preset (uniqueness)", async () => {
  const business = await makeBusiness("no-duplicate");
  const roles = await prisma.businessRole.findMany({ where: { businessId: business.id } });
  const canonicalIds = roles
    .map((r) => resolveCanonicalPreset(r))
    .filter((id): id is NonNullable<typeof id> => id !== null);
  assert.equal(canonicalIds.length, new Set(canonicalIds).size, "every canonical preset must be unique per business");

  // The database constraint itself, not just application logic: a second
  // row claiming an already-used jobPreset must be rejected.
  await assert.rejects(
    prisma.businessRole.create({
      data: {
        businessId: business.id,
        name: "Duplicate Kitchen",
        jobPreset: "KITCHEN",
        permissions: STAFF_PRESETS.KITCHEN.permissions as never,
      },
    }),
  );
});

test("a custom role (jobPreset: null) can still coexist alongside every preset — uniqueness never blocks null", async () => {
  const business = await makeBusiness("custom-role");
  await prisma.businessRole.create({
    data: {
      businessId: business.id,
      name: "Weekend Senior Team",
      jobPreset: null,
      permissions: STAFF_PRESETS.GENERAL.permissions as never,
    },
  });
  const roles = await prisma.businessRole.findMany({ where: { businessId: business.id } });
  assert.equal(roles.length, 9, "8 seeded (owner + 7 presets) + 1 custom role");
});
