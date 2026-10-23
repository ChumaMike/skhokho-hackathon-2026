import test from "node:test";
import assert from "node:assert/strict";
import {
  applyModuleToggle,
  categoryDefaultCapabilities,
  getBusinessCapabilities,
  ModuleError,
  MODULE_INFO,
  SWITCHABLE_MODULES,
} from "./capabilities";
import type { Entitlements } from "@/modules/billing/entitlements";
import { FEATURE_KEYS } from "@/modules/billing/features";

/** Settings › Modules: the pure switch decision (no database). */

function plan(granted: string[]): Entitlements {
  const features = Object.fromEntries(
    FEATURE_KEYS.map((k) => [k, { enabled: granted.includes(k), limit: null }]),
  ) as Entitlements["features"];
  return { planCode: "TEST", planName: "Test", state: "ACTIVE", accessUntil: null, features };
}

test("a food vendor can switch on Bookings, which its category never grants by default", () => {
  const current = getBusinessCapabilities({ category: "FOOD_VENDOR", settings: null });
  assert.equal(current.has("BOOKINGS"), false);
  const next = applyModuleToggle(current, "BOOKINGS", true, plan([]));
  assert.ok(next.includes("BOOKINGS"));
  // The full set is returned — the category's defaults survive the switch.
  for (const c of categoryDefaultCapabilities("FOOD_VENDOR")) assert.ok(next.includes(c), c);
  // ...and a business reading that stored set gets exactly it back.
  assert.deepEqual([...getBusinessCapabilities({ category: "FOOD_VENDOR", settings: { capabilities: next } })].sort(), next);
});

test("a plan-gated module needs the feature; switching it OFF never does", () => {
  const current = getBusinessCapabilities({ category: "RETAIL_STORE", settings: { capabilities: ["PRODUCTS", "ORDERS"] } });
  assert.throws(() => applyModuleToggle(current, "LOYALTY", true, plan([])), ModuleError);
  assert.throws(() => applyModuleToggle(current, "LOYALTY", true, null), ModuleError);
  assert.ok(applyModuleToggle(current, "LOYALTY", true, plan(["loyalty"])).includes("LOYALTY"));
  const withLoyalty = new Set(current).add("LOYALTY");
  assert.equal(applyModuleToggle(withLoyalty, "LOYALTY", false, plan([])).includes("LOYALTY"), false);
});

test("DELIVERY is never written into the stored set — it belongs to the delivery switch", () => {
  const current = getBusinessCapabilities({ category: "FOOD_VENDOR", settings: { delivery: { enabled: true, feeCents: 0 } } });
  assert.ok(current.has("DELIVERY"));
  const next = applyModuleToggle(current, "SERVICES", true, plan([]));
  assert.equal(next.includes("DELIVERY"), false);
  // Reading back still derives DELIVERY from settings.delivery, not the array.
  const reread = getBusinessCapabilities({
    category: "FOOD_VENDOR",
    settings: { capabilities: next, delivery: { enabled: true, feeCents: 0 } },
  });
  assert.ok(reread.has("DELIVERY"));
});

test("the last module can't be switched off (an empty set would silently restore the defaults)", () => {
  const current = new Set(["ORDERS"] as const);
  assert.throws(() => applyModuleToggle(current, "ORDERS", false, plan([])), /at least one module/);
});

test("every switchable module has merchant-facing copy, and unknown modules are refused", () => {
  for (const m of SWITCHABLE_MODULES) {
    assert.ok(MODULE_INFO[m].label.length > 0 && MODULE_INFO[m].description.length > 0, m);
  }
  assert.throws(() => applyModuleToggle(new Set(["ORDERS"]), "DELIVERY" as never, true, plan([])), ModuleError);
  assert.throws(() => applyModuleToggle(new Set(["ORDERS"]), "STAFF" as never, false, plan([])), ModuleError);
});
