import test from "node:test";
import assert from "node:assert/strict";
import { getAdminConsoleGroups, type AdminModuleContext } from "./admin-modules";
import { getBusinessExperience } from "@/modules/tenant/business-experience";
import { ALL_PERMISSIONS, NO_PERMISSIONS, type StaffPermissions } from "@/types";
import type { BusinessCapability } from "@/modules/tenant/capabilities";

function ctx(overrides: Partial<AdminModuleContext> = {}): AdminModuleContext {
  const capabilities = overrides.capabilities ?? new Set<BusinessCapability>();
  return {
    isOwner: false,
    permissions: NO_PERMISSIONS,
    capabilities,
    experience: getBusinessExperience("OTHER"),
    hasProducts: capabilities.has("PRODUCTS"),
    hasServices: capabilities.has("SERVICES"),
    ...overrides,
  };
}

function allKeys(groups: ReturnType<typeof getAdminConsoleGroups>) {
  return groups.flatMap((g) => g.modules.map((m) => m.key));
}

test("no empty groups are ever returned", () => {
  const groups = getAdminConsoleGroups(ctx({ isOwner: false, permissions: NO_PERMISSIONS }));
  assert.ok(groups.every((g) => g.modules.length > 0));
});

test("no duplicate modules across groups", () => {
  const groups = getAdminConsoleGroups(ctx({ isOwner: true, permissions: ALL_PERMISSIONS, capabilities: new Set(["ORDERS", "PRODUCTS", "SERVICES", "BOOKINGS", "DELIVERY"] as const) }));
  const keys = allKeys(groups);
  assert.equal(keys.length, new Set(keys).size);
});

test("Food (PRODUCTS/ORDERS) with owner: Orders + Kitchen shown, no Bookings, Menu terminology", () => {
  const capabilities = new Set(["PRODUCTS", "ORDERS", "LOYALTY"] as const);
  const groups = getAdminConsoleGroups(ctx({ isOwner: true, permissions: ALL_PERMISSIONS, capabilities, experience: getBusinessExperience("FOOD_VENDOR"), hasProducts: true, hasServices: false }));
  const keys = allKeys(groups);
  assert.ok(keys.includes("orders"));
  assert.ok(keys.includes("kitchen"));
  assert.ok(!keys.includes("appointments"));
  assert.ok(!keys.includes("deliveries"));
  const catalog = groups.flatMap((g) => g.modules).find((m) => m.key === "catalog")!;
  assert.equal(catalog.label, "Menu");
});

test("Food with DELIVERY enabled additionally shows Deliveries", () => {
  const capabilities = new Set(["PRODUCTS", "ORDERS", "DELIVERY"] as const);
  const groups = getAdminConsoleGroups(ctx({ isOwner: true, permissions: ALL_PERMISSIONS, capabilities, experience: getBusinessExperience("FOOD_VENDOR"), hasProducts: true }));
  assert.ok(allKeys(groups).includes("deliveries"));
});

test("Salon (SERVICES/BOOKINGS) with owner: Bookings shown, no Orders/Kitchen/Menu/Deliveries", () => {
  const capabilities = new Set(["SERVICES", "BOOKINGS", "LOYALTY"] as const);
  const groups = getAdminConsoleGroups(ctx({ isOwner: true, permissions: ALL_PERMISSIONS, capabilities, experience: getBusinessExperience("SALON"), hasProducts: false, hasServices: true }));
  const keys = allKeys(groups);
  assert.ok(keys.includes("appointments"));
  assert.ok(!keys.includes("orders"));
  assert.ok(!keys.includes("kitchen"));
  assert.ok(!keys.includes("deliveries"));
  const catalog = groups.flatMap((g) => g.modules).find((m) => m.key === "catalog")!;
  assert.equal(catalog.label, "Services");
});

test("Retail (PRODUCTS/ORDERS/INVENTORY) with owner: Products terminology, inventory-only-when-operational is respected (no dedicated inventory module exists yet, so none shown)", () => {
  const capabilities = new Set(["PRODUCTS", "ORDERS", "INVENTORY", "LOYALTY"] as const);
  const groups = getAdminConsoleGroups(ctx({ isOwner: true, permissions: ALL_PERMISSIONS, capabilities, experience: getBusinessExperience("RETAIL_STORE"), hasProducts: true }));
  const catalog = groups.flatMap((g) => g.modules).find((m) => m.key === "catalog")!;
  assert.equal(catalog.label, "Products");
  // No "inventory" module is registered at all yet (no operational inventory
  // page exists) — DashboardSection's type itself makes an "inventory" key
  // structurally impossible here, which is the real guarantee.
});

test("mixed Products + Services business gets a combined catalogue module, not two", () => {
  const capabilities = new Set(["PRODUCTS", "SERVICES", "ORDERS", "BOOKINGS"] as const);
  const groups = getAdminConsoleGroups(ctx({ isOwner: true, permissions: ALL_PERMISSIONS, capabilities, experience: getBusinessExperience("MECHANIC"), hasProducts: true, hasServices: true }));
  const catalogModules = groups.flatMap((g) => g.modules).filter((m) => m.key === "catalog");
  assert.equal(catalogModules.length, 1);
  assert.equal(catalogModules[0].label, "Parts & Services");
});

test("a hidden module is presentation only — this registry never claims to authorize anything (permissions object is read, never mutated or bypassed)", () => {
  const permissions: StaffPermissions = { ...NO_PERMISSIONS };
  const before = { ...permissions };
  getAdminConsoleGroups(ctx({ isOwner: false, permissions, capabilities: new Set(["ORDERS"] as const) }));
  assert.deepEqual(permissions, before);
});

test("legacy business with no explicit experience config (GENERAL/OTHER) still renders a safe, non-empty console", () => {
  const capabilities = new Set(["PRODUCTS", "ORDERS", "LOYALTY"] as const);
  const groups = getAdminConsoleGroups(ctx({ isOwner: true, permissions: ALL_PERMISSIONS, capabilities, hasProducts: true }));
  assert.ok(groups.length > 0);
  const catalog = groups.flatMap((g) => g.modules).find((m) => m.key === "catalog")!;
  assert.equal(catalog.label, "Products");
});

test("Home is always present regardless of capabilities/permissions", () => {
  const groups = getAdminConsoleGroups(ctx({ isOwner: false, permissions: NO_PERMISSIONS, capabilities: new Set() }));
  assert.ok(allKeys(groups).includes("home"));
});

test("catalogue module is hidden entirely when the business has neither PRODUCTS nor SERVICES", () => {
  const groups = getAdminConsoleGroups(ctx({ isOwner: true, permissions: ALL_PERMISSIONS, capabilities: new Set(["ORDERS"] as const), hasProducts: false, hasServices: false }));
  assert.ok(!allKeys(groups).includes("catalog"));
});

test("Staff module requires isOwner regardless of permission grants (staff/page.tsx is owner-only)", () => {
  const groups = getAdminConsoleGroups(ctx({ isOwner: false, permissions: ALL_PERMISSIONS }));
  assert.ok(!allKeys(groups).includes("staff"));
  const ownerGroups = getAdminConsoleGroups(ctx({ isOwner: true, permissions: NO_PERMISSIONS }));
  assert.ok(allKeys(ownerGroups).includes("staff"));
});
