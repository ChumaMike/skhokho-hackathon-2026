import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma/client";
import { STAFF_PRESETS } from "@/modules/staff/staff-presets";
import { getDeliverySettings, setDeliverySettings, type SetDeliverySettingsInput } from "./capabilities";

/**
 * The delivery-settings contract (since distance-based pricing):
 *   stored  { enabled, pricingMode: 'FLAT' | 'PER_KM', feeCents, perKmFeeCents, areaInfo }
 *   read    old JSON without pricingMode/perKmFeeCents → FLAT / 0, never PER_KM
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const created: string[] = [];

async function makeBusiness(label: string, settings: object | undefined = undefined) {
  const b = await prisma.business.create({
    data: { name: `Delivery ${label}`, slug: `delivery-${label}-${run}`, category: "FOOD_VENDOR", ...(settings ? { settings } : {}) },
    select: { id: true },
  });
  created.push(b.id);
  return b.id;
}

async function stored(id: string) {
  return ((await prisma.business.findUniqueOrThrow({ where: { id }, select: { settings: true } })).settings as Record<string, unknown>).delivery;
}

test.after(async () => {
  await prisma.business.deleteMany({ where: { id: { in: created } } });
});

// --- reading -----------------------------------------------------------------

test("old stored settings (before pricingMode existed) read as FLAT with no per-km fee", () => {
  const s = getDeliverySettings({ settings: { delivery: { enabled: true, feeCents: 2500, areaInfo: "Soweto" } } });
  assert.deepEqual(s, { enabled: true, pricingMode: "FLAT", feeCents: 2500, perKmFeeCents: 0, baseFeeCents: 0, minFeeCents: 0, maxDistanceKm: 0, areaInfo: "Soweto" });
});

test("no delivery settings at all → delivery off (defaults)", () => {
  assert.equal(getDeliverySettings({ settings: null }).enabled, false);
  assert.equal(getDeliverySettings({ settings: {} }).enabled, false);
});

test("junk in stored JSON never becomes PER_KM or a negative/fractional fee", () => {
  const s = getDeliverySettings({ settings: { delivery: { enabled: true, pricingMode: "per_km", feeCents: -5, perKmFeeCents: 3.5 } } });
  assert.equal(s.pricingMode, "FLAT");
  assert.equal(s.feeCents, 0);
  assert.equal(s.perKmFeeCents, 0);
});

// --- writing -----------------------------------------------------------------

test("saving writes the full current contract", async () => {
  const id = await makeBusiness("full");
  await setDeliverySettings(id, { enabled: true, pricingMode: "PER_KM", feeCents: 1000, perKmFeeCents: 500, areaInfo: "  Soweto  " });
  assert.deepEqual(await stored(id), { enabled: true, pricingMode: "PER_KM", feeCents: 1000, perKmFeeCents: 500, baseFeeCents: 0, minFeeCents: 0, maxDistanceKm: 0, areaInfo: "Soweto" });
});

test("a save that omits pricing (the Ordering page) preserves an owner's PER_KM setup", async () => {
  const id = await makeBusiness("preserve");
  await setDeliverySettings(id, { enabled: true, pricingMode: "PER_KM", feeCents: 1000, perKmFeeCents: 700 });
  await setDeliverySettings(id, { enabled: true, feeCents: 1200, areaInfo: "Joburg" });
  const s = await stored(id);
  assert.deepEqual(s, { enabled: true, pricingMode: "PER_KM", feeCents: 1200, perKmFeeCents: 700, baseFeeCents: 0, minFeeCents: 0, maxDistanceKm: 0, areaInfo: "Joburg" });
});

test("switching modes keeps the other mode's fee", async () => {
  const id = await makeBusiness("switch");
  await setDeliverySettings(id, { enabled: true, pricingMode: "PER_KM", feeCents: 1500, perKmFeeCents: 400 });
  await setDeliverySettings(id, { enabled: true, pricingMode: "FLAT", feeCents: 1500, perKmFeeCents: 400 });
  assert.deepEqual(getDeliverySettings({ settings: { delivery: await stored(id) } }), { enabled: true, pricingMode: "FLAT", feeCents: 1500, perKmFeeCents: 400, baseFeeCents: 0, minFeeCents: 0, maxDistanceKm: 0, areaInfo: undefined });
});

test("malformed payloads are refused and change nothing", async () => {
  const id = await makeBusiness("malformed");
  await setDeliverySettings(id, { enabled: true, feeCents: 2000 });
  const before = await stored(id);
  const bad: unknown[] = [
    { enabled: true, feeCents: -1 },
    { enabled: true, feeCents: 12.5 },
    { enabled: true, feeCents: 1000, perKmFeeCents: -100 },
    { enabled: true, feeCents: 1000, perKmFeeCents: 2.5 },
    { enabled: true, feeCents: 1000, pricingMode: "per_km" },
    { enabled: true, feeCents: 1000, pricingMode: "FREE" },
    { enabled: "yes", feeCents: 1000 },
  ];
  for (const input of bad) {
    await assert.rejects(setDeliverySettings(id, input as SetDeliverySettingsInput), Error, JSON.stringify(input));
  }
  assert.deepEqual(await stored(id), before);
});

test("tenant isolation: one business's delivery settings never touch another's", async () => {
  const a = await makeBusiness("iso-a");
  const b = await makeBusiness("iso-b", { delivery: { enabled: false, pricingMode: "FLAT", feeCents: 0, perKmFeeCents: 0 } });
  const bBefore = await stored(b);
  await setDeliverySettings(a, { enabled: true, pricingMode: "PER_KM", feeCents: 900, perKmFeeCents: 300 });
  assert.deepEqual(await stored(b), bBefore);
});

test("other settings keys survive a delivery save", async () => {
  const id = await makeBusiness("merge", { capabilities: ["PRODUCTS", "ORDERS"], ordering: { minOrderCents: 5000 } });
  await setDeliverySettings(id, { enabled: true, feeCents: 1000 });
  const settings = (await prisma.business.findUniqueOrThrow({ where: { id }, select: { settings: true } })).settings as Record<string, unknown>;
  assert.deepEqual(settings.capabilities, ["PRODUCTS", "ORDERS"]);
  assert.deepEqual(settings.ordering, { minOrderCents: 5000 });
});

// --- who may change it ----------------------------------------------------------

test("permission: both delivery save paths require canManageSettings, which no staff preset has", () => {
  for (const file of ["src/app/dashboard/settings/actions.ts", "src/app/dashboard/storefront/ordering/actions.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /requireStaffPermission\("canManageSettings"\)/, file);
  }
  for (const [id, preset] of Object.entries(STAFF_PRESETS)) {
    assert.equal(preset.permissions.canManageSettings, false, `${id} must not change delivery settings`);
  }
});
