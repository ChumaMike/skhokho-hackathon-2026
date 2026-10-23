import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { getBusinessCapabilities, setBusinessModule, setDeliverySettings, ModuleError } from "./capabilities";

/** Settings › Modules against the database: the stored override round-trips and merges with other settings. */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const created: string[] = [];

test.after(async () => {
  await prisma.business.deleteMany({ where: { id: { in: created } } });
});

test("switching Bookings on for a food vendor persists the full set and leaves delivery settings alone", async () => {
  const b = await prisma.business.create({
    data: { name: "Modules food", slug: `modules-food-${run}`, category: "FOOD_VENDOR" },
    select: { id: true },
  });
  created.push(b.id);
  await setDeliverySettings(b.id, { enabled: true, feeCents: 1500 });

  const next = await setBusinessModule(b.id, "BOOKINGS", true, null);
  assert.ok(next.includes("BOOKINGS") && next.includes("ORDERS") && !next.includes("DELIVERY"));

  const reload = () => prisma.business.findUniqueOrThrow({ where: { id: b.id }, select: { category: true, settings: true } });
  const row = await reload();
  const effective = getBusinessCapabilities(row);
  assert.ok(effective.has("BOOKINGS"));
  assert.ok(effective.has("DELIVERY"), "delivery setting survived the module write");
  assert.equal((row.settings as { delivery?: { feeCents?: number } }).delivery?.feeCents, 1500);

  await assert.rejects(setBusinessModule(b.id, "LOYALTY", true, null), ModuleError);
  await setBusinessModule(b.id, "BOOKINGS", false, null);
  assert.equal(getBusinessCapabilities(await reload()).has("BOOKINGS"), false);
});
