import test from "node:test";
import assert from "node:assert/strict";
import { getWorkspaceNav } from "./workspace-nav";
import {
  ALL_PERMISSIONS,
  NO_PERMISSIONS,
  STAFF_PERMISSIONS_BY_PRESET,
  KITCHEN_PERMISSIONS,
  DRIVER_PERMISSIONS,
  STOCK_PERMISSIONS,
  type StaffPermissions,
} from "@/types";

function sectionKeys(result: ReturnType<typeof getWorkspaceNav>) {
  return result.sections.map((s) => s.key);
}

test("OWNER gets the full grouped console, capabilities omitted fails open (every capability-gated module present)", () => {
  const result = getWorkspaceNav({ isOwner: true, permissions: ALL_PERMISSIONS, primaryWorkspace: null });
  assert.deepEqual(sectionKeys(result), [
    // "content" (Grow › Content & Marketing) sits between Customers and Business; plan gating happens on the page, not in the nav.
    "home", "orders", "kitchen", "deliveries", "appointments", "catalog", "storefront", "customers", "content", "staff", "analytics", "assistant", "settings", "domains", "payments",
  ]);
  assert.equal(result.defaultRoute, "/dashboard");
  assert.ok(result.groups && result.groups.length > 0, "OWNER gets grouped sections, not a flat list");
  assert.ok(!result.groups!.some((g) => g.modules.length === 0), "no empty groups");
});

test("primaryWorkspace: null is treated exactly like GENERAL — the backward-compatibility guarantee", () => {
  const nullResult = getWorkspaceNav({ isOwner: false, permissions: ALL_PERMISSIONS, primaryWorkspace: null });
  const generalResult = getWorkspaceNav({ isOwner: false, permissions: ALL_PERMISSIONS, primaryWorkspace: "GENERAL" });
  assert.deepEqual(nullResult, generalResult);
  assert.equal(nullResult.defaultRoute, "/dashboard");
});

test("a non-owner's console nav is filtered by their actual StaffPermissions grants — hidden modules stay hidden even on direct capability presence", () => {
  const result = getWorkspaceNav({ isOwner: false, permissions: NO_PERMISSIONS, primaryWorkspace: "GENERAL" });
  const keys = sectionKeys(result);
  // NO_PERMISSIONS grants nothing — only Home (unconditional) and Assistant/Storefront
  // (no permission gate defined for either) can remain.
  assert.ok(!keys.includes("orders"));
  assert.ok(!keys.includes("staff"));
  assert.ok(!keys.includes("settings"));
  assert.ok(!keys.includes("analytics"));
  assert.ok(!keys.includes("customers"));
  assert.ok(keys.includes("home"));
});

test("MANAGER excludes Staff, Settings and Domains — an emergent property of the MANAGER permission preset, not a hardcoded workspace check", () => {
  const result = getWorkspaceNav({ isOwner: false, permissions: STAFF_PERMISSIONS_BY_PRESET.MANAGER, primaryWorkspace: "MANAGER" });
  const keys = sectionKeys(result);
  assert.ok(!keys.includes("staff"));
  assert.ok(!keys.includes("settings"));
  assert.ok(!keys.includes("domains"));
  assert.ok(keys.includes("home") && keys.includes("orders") && keys.includes("appointments") && keys.includes("catalog") && keys.includes("analytics"));
  assert.equal(result.defaultRoute, "/dashboard");
});

test("navigation now DOES vary with the permissions object passed for MANAGER — supersedes the pre-Business-Console rule that nav was workspace-only", () => {
  // Deliberate change: the Business Console milestone (§12, "Permission-aware
  // admin") requires the module registry to filter on the caller's actual
  // StaffPermissions, not just their workspace label. A MANAGER-workspace
  // staffer whose role happens to grant canManageSettings now sees Settings;
  // one on the standard MANAGER preset (which never grants it) does not.
  const standardManager = getWorkspaceNav({ isOwner: false, permissions: STAFF_PERMISSIONS_BY_PRESET.MANAGER, primaryWorkspace: "MANAGER" });
  const managerWithFullPerms = getWorkspaceNav({ isOwner: false, permissions: ALL_PERMISSIONS, primaryWorkspace: "MANAGER" });
  assert.ok(!sectionKeys(standardManager).includes("settings"));
  assert.ok(sectionKeys(managerWithFullPerms).includes("settings"));
  assert.notDeepEqual(sectionKeys(standardManager), sectionKeys(managerWithFullPerms));
});

test("COUNTER excludes analytics/settings/staff/catalog and lands on /dashboard/counter", () => {
  const result = getWorkspaceNav({ isOwner: false, permissions: STAFF_PERMISSIONS_BY_PRESET.CASHIER, primaryWorkspace: "COUNTER" });
  const keys = sectionKeys(result);
  assert.ok(!keys.includes("analytics"));
  assert.ok(!keys.includes("settings"));
  assert.ok(!keys.includes("staff"));
  assert.ok(!keys.includes("catalog"));
  assert.ok(keys.includes("home") && keys.includes("customers") && keys.includes("orders") && keys.includes("appointments"));
  assert.equal(result.defaultRoute, "/dashboard/counter");
  assert.ok(!result.groups, "Counter keeps its plain flat minimal nav, not the grouped console");
  const home = result.sections.find((s) => s.key === "home")!;
  assert.equal(home.href, "/dashboard/counter", "Counter's own Home link must point at its own screen, not the owner dashboard");
});

test("KITCHEN gets a single minimal link, not a filtered full nav", () => {
  const result = getWorkspaceNav({ isOwner: false, permissions: NO_PERMISSIONS, primaryWorkspace: "KITCHEN" });
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].href, "/dashboard/kitchen");
  assert.equal(result.defaultRoute, "/dashboard/kitchen");
  assert.ok(!result.groups);
});

test("SERVICE_PROVIDER/STOCK (no dedicated screen yet) fall back to the full grouped console filtered by their real permissions", () => {
  for (const workspace of ["SERVICE_PROVIDER", "STOCK"] as const) {
    const result = getWorkspaceNav({ isOwner: false, permissions: NO_PERMISSIONS, primaryWorkspace: workspace });
    assert.equal(result.defaultRoute, "/dashboard", `${workspace} must land on the honest full-dashboard fallback`);
    assert.ok(result.groups && result.groups.length > 0);
    // NO_PERMISSIONS grants nothing beyond the unconditional modules.
    assert.deepEqual(sectionKeys(result).sort(), ["assistant", "home", "storefront"].sort());
  }
});

test("DELIVERY gets a single minimal link to /dashboard/driver, not the full Orders page", () => {
  const result = getWorkspaceNav({ isOwner: false, permissions: NO_PERMISSIONS, primaryWorkspace: "DELIVERY" });
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].href, "/dashboard/driver");
  assert.ok(!result.sections.some((s) => s.href === "/dashboard/orders"), "a Driver must not gain access to the full Orders page merely from their workspace");
  assert.equal(result.defaultRoute, "/dashboard/driver");
});

test("Deliveries only appears for OWNER/MANAGER when BOTH the DELIVERY capability is present AND the caller can dispatch", () => {
  const withCapability = new Set(["DELIVERY"] as const);

  const ownerWithCapability = getWorkspaceNav({ isOwner: true, permissions: ALL_PERMISSIONS, primaryWorkspace: null, capabilities: withCapability });
  assert.ok(sectionKeys(ownerWithCapability).includes("deliveries"));

  const ownerWithoutCapability = getWorkspaceNav({ isOwner: true, permissions: ALL_PERMISSIONS, primaryWorkspace: null, capabilities: new Set() });
  assert.ok(!sectionKeys(ownerWithoutCapability).includes("deliveries"), "no Deliveries link when the business hasn't enabled delivery");

  const managerCanDispatch = getWorkspaceNav({
    isOwner: false,
    permissions: STAFF_PERMISSIONS_BY_PRESET.MANAGER,
    primaryWorkspace: "MANAGER",
    capabilities: withCapability,
  });
  assert.ok(sectionKeys(managerCanDispatch).includes("deliveries"));

  const counterCannotDispatch = getWorkspaceNav({
    isOwner: false,
    permissions: STAFF_PERMISSIONS_BY_PRESET.CASHIER,
    primaryWorkspace: "COUNTER",
    capabilities: withCapability,
  });
  assert.ok(!sectionKeys(counterCannotDispatch).includes("deliveries"), "Counter's permission set has no canManageDeliveries");

  const generalWithoutManageDeliveries = getWorkspaceNav({
    isOwner: false,
    permissions: STAFF_PERMISSIONS_BY_PRESET.STAFF,
    primaryWorkspace: "GENERAL",
    capabilities: withCapability,
  });
  assert.ok(!sectionKeys(generalWithoutManageDeliveries).includes("deliveries"));
});

test("a business without the BOOKINGS capability never shows the Bookings tab, for Owner, Manager, or Counter", () => {
  const noBookings = new Set(["PRODUCTS", "ORDERS"] as const);

  const owner = getWorkspaceNav({ isOwner: true, permissions: ALL_PERMISSIONS, primaryWorkspace: null, capabilities: noBookings });
  assert.ok(!sectionKeys(owner).includes("appointments"));

  const manager = getWorkspaceNav({ isOwner: false, permissions: STAFF_PERMISSIONS_BY_PRESET.MANAGER, primaryWorkspace: "MANAGER", capabilities: noBookings });
  assert.ok(!sectionKeys(manager).includes("appointments"));

  const counter = getWorkspaceNav({ isOwner: false, permissions: STAFF_PERMISSIONS_BY_PRESET.CASHIER, primaryWorkspace: "COUNTER", capabilities: noBookings });
  assert.ok(!sectionKeys(counter).includes("appointments"));
});

test("a business WITH the BOOKINGS capability keeps the Bookings tab", () => {
  const withBookings = new Set(["SERVICES", "BOOKINGS"] as const);
  const owner = getWorkspaceNav({ isOwner: true, permissions: ALL_PERMISSIONS, primaryWorkspace: null, capabilities: withBookings });
  assert.ok(sectionKeys(owner).includes("appointments"));
});

test("omitting capabilities entirely keeps today's behaviour (fails open, never hides appointments for a caller that hasn't wired capabilities through)", () => {
  const owner = getWorkspaceNav({ isOwner: true, permissions: ALL_PERMISSIONS, primaryWorkspace: null });
  assert.ok(sectionKeys(owner).includes("appointments"));
});

test("no PRODUCTS or SERVICES capability hides the catalogue module entirely, rather than showing an empty Products page", () => {
  const owner = getWorkspaceNav({
    isOwner: true,
    permissions: ALL_PERMISSIONS,
    primaryWorkspace: null,
    capabilities: new Set(["ORDERS"] as const),
  });
  assert.ok(!sectionKeys(owner).includes("catalog"));
});

test("catalogue label adapts to businessCategory — Food gets Menu, Retail gets Products, unset gets the general fallback", () => {
  const withBoth = new Set(["PRODUCTS", "SERVICES"] as const);
  const food = getWorkspaceNav({ isOwner: true, permissions: ALL_PERMISSIONS, primaryWorkspace: null, capabilities: new Set(["PRODUCTS"] as const), businessCategory: "FOOD_VENDOR" });
  const retail = getWorkspaceNav({ isOwner: true, permissions: ALL_PERMISSIONS, primaryWorkspace: null, capabilities: new Set(["PRODUCTS"] as const), businessCategory: "RETAIL_STORE" });
  const mixed = getWorkspaceNav({ isOwner: true, permissions: ALL_PERMISSIONS, primaryWorkspace: null, capabilities: withBoth, businessCategory: "MECHANIC" });

  const label = (r: ReturnType<typeof getWorkspaceNav>) => r.sections.find((s) => s.key === "catalog")!.label;
  assert.equal(label(food), "Menu");
  assert.equal(label(retail), "Products");
  assert.equal(label(mixed), "Parts & Services");
});

test("no staff preset can reach Payments — only an owner decides where money is sent", () => {
  // canManageBilling is granted by no preset, which is what makes this
  // owner-only in practice. Deciding WHERE a business's money settles is a
  // different and far more dangerous power than taking a payment at the till
  // (canProcessPayments), which managers and cashiers do have.
  const everyPreset: [string, StaffPermissions][] = [
    ...Object.entries(STAFF_PERMISSIONS_BY_PRESET),
    ["KITCHEN", KITCHEN_PERMISSIONS],
    ["DRIVER", DRIVER_PERMISSIONS],
    ["STOCK", STOCK_PERMISSIONS],
  ];
  for (const [preset, permissions] of everyPreset) {
    const result = getWorkspaceNav({ isOwner: false, permissions, primaryWorkspace: "GENERAL" });
    assert.ok(
      !sectionKeys(result).includes("payments"),
      `${preset} must not see Payments in the console`,
    );
  }

  // And the owner does.
  const owner = getWorkspaceNav({ isOwner: true, permissions: ALL_PERMISSIONS, primaryWorkspace: null });
  assert.ok(sectionKeys(owner).includes("payments"));
});
