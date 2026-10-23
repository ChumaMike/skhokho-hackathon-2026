import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { hashPassword } from "@/modules/auth/auth.service";
import { setStorefrontConfig, getStorefrontConfig } from "@/modules/tenant/storefront-theme";
import { setBusinessCapabilities, getBusinessCapabilities, setDeliverySettings, getDeliverySettings } from "@/modules/tenant/capabilities";
import { STAFF_PERMISSIONS_BY_PRESET } from "@/types";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function makeBusiness(label: string) {
  const { business } = await createBusiness({
    name: `Storefront Ordering Test ${label}`,
    category: "FOOD_VENDOR" as never,
    owner: {
      firstName: "Owner",
      lastName: label,
      email: `storefront-ordering-owner-${label}-${suffix}@example.test`,
      passwordHash: await hashPassword("SomePassword123"),
    },
  });
  return business;
}

test.after(async () => {
  const businesses = await prisma.business.findMany({
    where: { name: { startsWith: "Storefront Ordering Test " } },
    select: { id: true },
  });
  for (const { id } of businesses) {
    await prisma.businessStaff.deleteMany({ where: { businessId: id } });
    await prisma.businessRole.deleteMany({ where: { businessId: id } });
    await prisma.businessSubscription.deleteMany({ where: { businessId: id } });
    await prisma.business.delete({ where: { id } });
  }
});

/**
 * updateOrderingDelivery (this route's server action) calls exactly this
 * function — see actions.ts's own comment on why the server action itself
 * isn't directly callable outside Next's request context.
 */
test("delivery settings persist via setDeliverySettings, the same write path Settings already uses", async () => {
  const business = await makeBusiness("persist");
  await setDeliverySettings(business.id, { enabled: true, feeCents: 2500, areaInfo: "Soweto only" });
  const updated = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  const delivery = getDeliverySettings(updated);
  assert.equal(delivery.enabled, true);
  assert.equal(delivery.feeCents, 2500);
  assert.equal(delivery.areaInfo, "Soweto only");
});

test("a delivery edit never touches unrelated settings (theme, capabilities, business info all survive untouched)", async () => {
  const business = await makeBusiness("preserve-settings");
  await setBusinessCapabilities(business.id, ["PRODUCTS", "ORDERS"]);
  await setStorefrontConfig(business.id, { theme: { presetId: "BOLD" } });

  await setDeliverySettings(business.id, { enabled: true, feeCents: 3000 });

  const updated = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  const capabilities = getBusinessCapabilities(updated);
  // DELIVERY itself is derived from the delivery settings just written, but
  // the ORIGINAL explicit capability list (PRODUCTS/ORDERS) must survive.
  assert.ok(capabilities.has("PRODUCTS") && capabilities.has("ORDERS"), "capabilities must survive a delivery edit");
  const theme = getStorefrontConfig(updated);
  assert.equal(theme.theme.presetId, "BOLD", "theme preset must survive a delivery edit");
});

test("disabling delivery removes DELIVERY from resolved capabilities without touching anything else", async () => {
  const business = await makeBusiness("disable");
  await setBusinessCapabilities(business.id, ["PRODUCTS", "ORDERS"]);
  await setDeliverySettings(business.id, { enabled: true, feeCents: 1500 });
  let updated = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  assert.ok(getBusinessCapabilities(updated).has("DELIVERY"));

  await setDeliverySettings(business.id, { enabled: false, feeCents: 1500 });
  updated = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  assert.ok(!getBusinessCapabilities(updated).has("DELIVERY"));
  assert.ok(getBusinessCapabilities(updated).has("PRODUCTS"), "unrelated capabilities untouched");
});

test("MANAGER and CASHIER presets never carry canManageSettings — the permission updateOrderingDelivery's permittedRedirect gates on", () => {
  assert.equal(STAFF_PERMISSIONS_BY_PRESET.MANAGER.canManageSettings, false);
  assert.equal(STAFF_PERMISSIONS_BY_PRESET.CASHIER.canManageSettings, false);
});
