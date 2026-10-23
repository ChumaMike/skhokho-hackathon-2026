import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { hashPassword } from "@/modules/auth/auth.service";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { inviteStaff } from "@/modules/staff/staff.service";
import { STAFF_PRESETS } from "@/modules/staff/staff-presets";
import { ALL_PERMISSIONS, STAFF_PERMISSIONS_BY_PRESET, type StaffPermissions } from "@/types";

async function permissionsFor(staffId: string): Promise<StaffPermissions> {
  const staff = await prisma.businessStaff.findUniqueOrThrow({
    where: { id: staffId },
    include: { role: true },
  });
  return (staff.role?.permissions ?? {}) as unknown as StaffPermissions;
}

/**
 * P0 authorization-correctness fix (original): `inviteStaff` used to always
 * assign the `isDefault` BusinessRole regardless of which `staffRole` label
 * the owner picked — "Invite as Manager" and "Invite as Cashier" produced
 * identical access. `BusinessRole.presetRole` gave the invite flow a
 * stable, non-name-based way to resolve the role a label promised.
 *
 * Workforce architecture milestone 1 (this file, extended): the invite flow
 * now speaks in `StaffPresetId` (7 job-based presets —
 * src/modules/staff/staff-presets.ts) rather than the raw `StaffRole` enum,
 * resolved via the newer `BusinessRole.jobPreset` column. See
 * docs/research/2026-09-08-adaptive-os-gap-analysis.md §D.2/§E.4 for the
 * original finding this all traces back to.
 */

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function makeBusiness(label: string) {
  const { business } = await createBusiness({
    name: `Staff Preset Test ${label}`,
    category: "SALON",
    owner: {
      firstName: "Owner",
      lastName: label,
      email: `staff-preset-owner-${label}-${suffix}@example.test`,
      passwordHash: await hashPassword("SomePassword123"),
    },
  });
  return business;
}

async function rolesFor(businessId: string) {
  return prisma.businessRole.findMany({ where: { businessId } });
}

test.after(async () => {
  const businesses = await prisma.business.findMany({
    where: { name: { startsWith: "Staff Preset Test " } },
    select: { id: true },
  });
  for (const { id } of businesses) {
    await prisma.businessStaff.deleteMany({ where: { businessId: id } });
    await prisma.businessRole.deleteMany({ where: { businessId: id } });
    await prisma.businessSubscription.deleteMany({ where: { businessId: id } });
    await prisma.business.delete({ where: { id } });
  }
});

// ---------------------------------------------------------------------------
// createBusiness seeds all seven presets, correctly and distinctly
// ---------------------------------------------------------------------------

test("createBusiness seeds Owner + all seven staff presets, each with the intended permissions", async () => {
  const business = await makeBusiness("seed");
  const roles = await rolesFor(business.id);

  const byJobPreset = new Map(roles.map((r) => [r.jobPreset, r]));
  assert.equal(roles.length, 8, "Owner + 7 staff presets");

  const owner = roles.find((r) => r.presetRole === "OWNER");
  assert.ok(owner, "OWNER preset role exists");
  assert.deepEqual(owner!.permissions, ALL_PERMISSIONS, "owner behaviour remains intact — every permission true");

  for (const preset of Object.values(STAFF_PRESETS)) {
    const role = byJobPreset.get(preset.id);
    assert.ok(role, `${preset.id} preset role exists (jobPreset-tagged)`);
    assert.deepEqual(role!.permissions, preset.permissions, `${preset.id} has the intended permissions`);
    if (preset.presetRole) {
      assert.equal(role!.presetRole, preset.presetRole, `${preset.id} also carries its legacy presetRole tag`);
    } else {
      assert.equal(role!.presetRole, null, `${preset.id} has no StaffRole equivalent — presetRole stays null`);
    }
  }

  const generalRole = byJobPreset.get("GENERAL")!;
  assert.equal(generalRole.isDefault, true, "GENERAL stays the isDefault fallback row");
  for (const preset of Object.values(STAFF_PRESETS)) {
    if (preset.id === "GENERAL") continue;
    assert.equal(byJobPreset.get(preset.id)!.isDefault, false);
  }
});

// ---------------------------------------------------------------------------
// inviteStaff resolves the selected preset, not always the default
// ---------------------------------------------------------------------------

test("inviteStaff as MANAGER assigns the Manager preset, not the default General role", async () => {
  const business = await makeBusiness("manager-invite");
  const roles = await rolesFor(business.id);
  const managerRole = roles.find((r) => r.jobPreset === "MANAGER")!;
  const generalRole = roles.find((r) => r.jobPreset === "GENERAL")!;

  const { staff } = await inviteStaff(business.id, {
    firstName: "Nomsa",
    lastName: "Manager",
    email: `manager-${suffix}@example.test`,
    preset: "MANAGER",
  });

  assert.equal(staff.roleId, managerRole.id);
  assert.notEqual(staff.roleId, generalRole.id);
  assert.equal(staff.primaryWorkspace, "MANAGER");
});

test("inviteStaff as COUNTER assigns the Counter/Cashier preset", async () => {
  const business = await makeBusiness("counter-invite");
  const roles = await rolesFor(business.id);
  const counterRole = roles.find((r) => r.jobPreset === "COUNTER")!;

  const { staff } = await inviteStaff(business.id, {
    firstName: "Lerato",
    lastName: "Counter",
    email: `counter-${suffix}@example.test`,
    preset: "COUNTER",
  });

  assert.equal(staff.roleId, counterRole.id);
  assert.equal(staff.primaryWorkspace, "COUNTER");
});

test("inviteStaff as SERVICE_PROVIDER assigns a role distinct from Manager and General", async () => {
  const business = await makeBusiness("service-provider-invite");
  const roles = await rolesFor(business.id);
  const spRole = roles.find((r) => r.jobPreset === "SERVICE_PROVIDER")!;
  const managerRole = roles.find((r) => r.jobPreset === "MANAGER")!;
  const generalRole = roles.find((r) => r.jobPreset === "GENERAL")!;

  const { staff } = await inviteStaff(business.id, {
    firstName: "Kabelo",
    lastName: "Provider",
    email: `service-provider-${suffix}@example.test`,
    preset: "SERVICE_PROVIDER",
  });

  assert.equal(staff.roleId, spRole.id);
  assert.notEqual(staff.roleId, managerRole.id);
  assert.notEqual(staff.roleId, generalRole.id);
  assert.equal(staff.primaryWorkspace, "SERVICE_PROVIDER");
});

test("inviteStaff as KITCHEN assigns the narrow Kitchen role and workspace", async () => {
  const business = await makeBusiness("kitchen-invite");
  const roles = await rolesFor(business.id);
  const kitchenRole = roles.find((r) => r.jobPreset === "KITCHEN")!;
  assert.equal(kitchenRole.presetRole, null, "Kitchen has no StaffRole equivalent");

  const { staff } = await inviteStaff(business.id, {
    firstName: "Thabo",
    lastName: "Kitchen",
    email: `kitchen-${suffix}@example.test`,
    preset: "KITCHEN",
  });

  assert.equal(staff.roleId, kitchenRole.id);
  assert.equal(staff.primaryWorkspace, "KITCHEN");
  assert.equal(staff.staffRole, "STAFF", "legacy staffRole column falls back to STAFF for presets with no real StaffRole");
});

test("free-text jobTitle overrides the preset's suggested title; omitting it uses the suggestion", async () => {
  const business = await makeBusiness("job-title");

  const { staff: withOverride } = await inviteStaff(business.id, {
    firstName: "Senior",
    lastName: "Barber",
    email: `job-title-override-${suffix}@example.test`,
    preset: "SERVICE_PROVIDER",
    jobTitle: "Senior Barber",
  });
  assert.equal(withOverride.jobTitle, "Senior Barber");

  const { staff: withDefault } = await inviteStaff(business.id, {
    firstName: "Regular",
    lastName: "Provider",
    email: `job-title-default-${suffix}@example.test`,
    preset: "SERVICE_PROVIDER",
  });
  assert.equal(withDefault.jobTitle, STAFF_PRESETS.SERVICE_PROVIDER.jobTitle);
});

// ---------------------------------------------------------------------------
// Different presets must not silently collapse to identical access —
// except where that's explicitly intended (GENERAL/COUNTER)
// ---------------------------------------------------------------------------

test("MANAGER and SERVICE_PROVIDER grant genuinely different permissions than GENERAL/COUNTER", async () => {
  const manager = STAFF_PERMISSIONS_BY_PRESET.MANAGER;
  const technician = STAFF_PERMISSIONS_BY_PRESET.TECHNICIAN;
  const staffPerms = STAFF_PERMISSIONS_BY_PRESET.STAFF;

  assert.notDeepEqual(manager, staffPerms, "Manager must differ from the generic General preset");
  assert.notDeepEqual(technician, staffPerms, "Service Provider must differ from the generic General preset");
  assert.notDeepEqual(manager, technician, "Manager and Service Provider must differ from each other");

  for (const key of Object.keys(staffPerms) as (keyof StaffPermissions)[]) {
    if (staffPerms[key]) assert.equal(manager[key], true, `MANAGER must retain GENERAL's ${key} grant`);
  }
});

test("GENERAL and COUNTER are intentionally identical (documented, not accidental)", () => {
  assert.deepEqual(STAFF_PERMISSIONS_BY_PRESET.STAFF, STAFF_PERMISSIONS_BY_PRESET.CASHIER);
});

test("KITCHEN, STOCK, and DRIVER are least-privilege and distinct from every other preset", () => {
  const kitchen = STAFF_PRESETS.KITCHEN.permissions;
  const stock = STAFF_PRESETS.STOCK.permissions;
  const driver = STAFF_PRESETS.DRIVER.permissions;

  // Kitchen gets canPrepareOrders, deliberately NOT canManageOrders — the
  // architecture-hardening pass's whole point: a Kitchen worker can move
  // CONFIRMED->PROCESSING->READY but never accept, complete, or cancel.
  assert.equal(kitchen.canPrepareOrders, true);
  assert.equal(kitchen.canManageOrders, false, "Kitchen must never get full order-management authority");
  assert.equal(kitchen.canManageCustomers, false, "Kitchen must not get customer access");
  assert.equal(kitchen.canProcessPayments, false, "Kitchen must not get payment access");

  assert.equal(stock.canManageInventory, true);
  assert.equal(stock.canManageOrders, false);

  // Driver gets the operational delivery flag only, never the managerial
  // dispatcher one — the same mistake Kitchen's old canManageOrders was,
  // now avoided from the start.
  assert.equal(driver.canPerformDeliveries, true);
  assert.equal(driver.canManageDeliveries, false, "Driver must never get dispatcher-level authority");
  assert.equal(driver.canManageOrders, false);
});

test("Manager and Counter retain full order-management authority (canManageOrders), which already covers preparation transitions", () => {
  assert.equal(STAFF_PERMISSIONS_BY_PRESET.MANAGER.canManageOrders, true);
  assert.equal(STAFF_PERMISSIONS_BY_PRESET.CASHIER.canManageOrders, true, "Counter/Cashier keeps whatever order authority it already had");
  assert.equal(STAFF_PERMISSIONS_BY_PRESET.STAFF.canManageOrders, true, "General preserves backward-compatible behaviour");
});

test("Manager is prepared with canManageDeliveries ahead of the Delivery milestone, without it doing anything yet", () => {
  assert.equal(STAFF_PERMISSIONS_BY_PRESET.MANAGER.canManageDeliveries, true);
});

// ---------------------------------------------------------------------------
// Backward compatibility — pre-migration businesses degrade safely, and
// fixing resolution never touches an already-invited staff member's row
// ---------------------------------------------------------------------------

test("inviteStaff falls back to the default role when this business has no matching preset at all (fully legacy data)", async () => {
  const business = await makeBusiness("legacy-fallback");
  const generalRole = (await rolesFor(business.id)).find((r) => r.isDefault)!;

  // Simulate a business created before EITHER migration/backfill — no role
  // in this business resolves to any preset at all.
  await prisma.businessRole.updateMany({
    where: { businessId: business.id },
    data: { presetRole: null, jobPreset: null },
  });

  const { staff } = await inviteStaff(business.id, {
    firstName: "Legacy",
    lastName: "Invite",
    email: `legacy-${suffix}@example.test`,
    preset: "MANAGER",
  });

  // Degrades to exactly the old (buggy but non-crashing) behaviour rather
  // than throwing or leaving roleId null — never worse than before this fix.
  assert.equal(staff.roleId, generalRole.id);
});

test("inviteStaff falls back to presetRole when jobPreset isn't tagged yet (partially backfilled)", async () => {
  const business = await makeBusiness("partial-backfill");
  const roles = await rolesFor(business.id);
  const managerRole = roles.find((r) => r.presetRole === "MANAGER")!;

  // Simulate a business backfilled under the OLD script only — presetRole
  // tags exist, jobPreset tags don't.
  await prisma.businessRole.updateMany({ where: { businessId: business.id }, data: { jobPreset: null } });

  const { staff } = await inviteStaff(business.id, {
    firstName: "Partial",
    lastName: "Backfill",
    email: `partial-backfill-${suffix}@example.test`,
    preset: "MANAGER",
  });

  assert.equal(staff.roleId, managerRole.id, "resolves via the legacy presetRole tag when jobPreset is absent");
});

test("fixing inviteStaff's resolution does not alter an already-invited staff member's role", async () => {
  const business = await makeBusiness("existing-staff-untouched");
  const managerRole = (await rolesFor(business.id)).find((r) => r.jobPreset === "MANAGER")!;

  const { staff: before } = await inviteStaff(business.id, {
    firstName: "Already",
    lastName: "Invited",
    email: `existing-${suffix}@example.test`,
    preset: "MANAGER",
  });
  assert.equal(before.roleId, managerRole.id);

  // Simulate the backfill/legacy scenario running on this same business
  // AFTER the staff member was already invited — their own row must not
  // move just because the business's role rows change shape around them.
  await prisma.businessRole.updateMany({
    where: { businessId: business.id },
    data: { presetRole: null, jobPreset: null },
  });

  const after = await prisma.businessStaff.findUniqueOrThrow({ where: { id: before.id } });
  assert.equal(after.roleId, before.roleId, "existing staff record's role assignment must remain valid/unchanged");
});

// ---------------------------------------------------------------------------
// primaryWorkspace is presentation only — permissions remain authoritative,
// even for a direct call that bypasses navigation entirely
// ---------------------------------------------------------------------------

test("a Kitchen-preset staff member's stored permissions allow order preparation but nothing owner-only or managerial", async () => {
  const business = await makeBusiness("kitchen-authz");
  const { staff } = await inviteStaff(business.id, {
    firstName: "Kitchen",
    lastName: "Worker",
    email: `kitchen-authz-${suffix}@example.test`,
    preset: "KITCHEN",
  });

  // Reads via the exact same `staff.role?.permissions` shape
  // requireStaffPermission itself uses (guards.ts) — this is what that
  // request-bound guard would see for this staff member on ANY direct call,
  // regardless of which page or nav link (if any) got them there.
  const permissions = await permissionsFor(staff.id);
  assert.equal(permissions.canPrepareOrders, true, "Kitchen can prepare orders — canAdvanceOrderFromStatus's own gate");
  assert.equal(permissions.canManageOrders, false, "Kitchen must never get full order-management authority");
  assert.equal(permissions.canManageSettings, false, "Kitchen must never pass a settings-gated check");
  assert.equal(permissions.canManageDomains, false);
  assert.equal(permissions.canManageStaff, false);
  assert.equal(permissions.canManageCustomers, false, "Kitchen has no customer-record access");
  assert.equal(permissions.canProcessPayments, false, "Kitchen has no payment access");
});

test("a Counter-preset staff member's stored permissions never include owner-only actions", async () => {
  const business = await makeBusiness("counter-authz");
  const { staff } = await inviteStaff(business.id, {
    firstName: "Counter",
    lastName: "Worker",
    email: `counter-authz-${suffix}@example.test`,
    preset: "COUNTER",
  });

  const permissions = await permissionsFor(staff.id);
  assert.equal(permissions.canManageDomains, false);
  assert.equal(permissions.canManageSettings, false);
  assert.equal(permissions.canManageStaff, false);
  assert.equal(permissions.canManageBilling, false);
});

// ---------------------------------------------------------------------------
// Tenant isolation — the new @@unique([businessId, jobPreset]) constraint
// must separate businesses even though every business has a role with the
// exact same jobPreset value (e.g. both have their own 'KITCHEN' row)
// ---------------------------------------------------------------------------

test("two businesses sharing identical jobPreset values never resolve into each other's roles", async () => {
  const bizA = await makeBusiness("isolation-a");
  const bizB = await makeBusiness("isolation-b");

  const kitchenA = (await rolesFor(bizA.id)).find((r) => r.jobPreset === "KITCHEN")!;
  const kitchenB = (await rolesFor(bizB.id)).find((r) => r.jobPreset === "KITCHEN")!;
  assert.notEqual(kitchenA.id, kitchenB.id, "each business has its OWN Kitchen row despite the identical jobPreset value");

  const { staff } = await inviteStaff(bizA.id, {
    firstName: "Isolated",
    lastName: "Kitchen",
    email: `isolation-kitchen-${suffix}@example.test`,
    preset: "KITCHEN",
  });

  assert.equal(staff.roleId, kitchenA.id);
  assert.notEqual(staff.roleId, kitchenB.id, "business A's invite must never resolve to business B's role");
});
