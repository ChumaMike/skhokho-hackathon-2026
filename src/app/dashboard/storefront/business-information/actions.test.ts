import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { createBusiness, updateBusiness } from "@/modules/tenant/tenant.service";
import { hashPassword } from "@/modules/auth/auth.service";
import { setStorefrontConfig, getStorefrontConfig } from "@/modules/tenant/storefront-theme";
import { setBusinessCapabilities, getBusinessCapabilities, setDeliverySettings } from "@/modules/tenant/capabilities";
import { STAFF_PERMISSIONS_BY_PRESET } from "@/types";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function makeBusiness(label: string) {
  const { business } = await createBusiness({
    name: `Storefront Business Info Test ${label}`,
    category: "FOOD_VENDOR" as never,
    owner: {
      firstName: "Owner",
      lastName: label,
      email: `storefront-bizinfo-owner-${label}-${suffix}@example.test`,
      passwordHash: await hashPassword("SomePassword123"),
    },
  });
  return business;
}

test.after(async () => {
  const businesses = await prisma.business.findMany({
    where: { name: { startsWith: "Storefront Business Info Test " } },
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
 * updateBusinessInformation (this route's server action) calls exactly this
 * function with exactly this field shape — see actions.ts's own comment on
 * why the server action itself isn't directly callable outside Next's
 * request context (identical reasoning to
 * storefront/design/actions.test.ts).
 */
test("business-information fields persist via updateBusiness, the same write path Settings already uses", async () => {
  const business = await makeBusiness("persist");
  await updateBusiness(business.id, {
    name: "Kota Corner",
    description: "The best kotas in town",
    phone: "+27821234567",
    whatsapp: "+27821234568",
    address: "1 Vilakazi Street",
    suburb: "Orlando West",
    city: "Soweto",
  });
  const updated = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  assert.equal(updated.name, "Kota Corner");
  assert.equal(updated.description, "The best kotas in town");
  assert.equal(updated.whatsapp, "+27821234568");
  assert.equal(updated.suburb, "Orlando West");
});

test("a business-information edit never touches unrelated settings JSON (capabilities, delivery, theme all survive untouched)", async () => {
  const business = await makeBusiness("preserve-settings");
  // DELIVERY is deliberately derived only from settings.delivery.enabled
  // (see capabilities.ts's own comment), never from this explicit array —
  // enabling it for real here so the assertion below is a meaningful check
  // of DELIVERY specifically, not just PRODUCTS/ORDERS.
  await setBusinessCapabilities(business.id, ["PRODUCTS", "ORDERS"]);
  await setDeliverySettings(business.id, { enabled: true, feeCents: 2000 });
  await setStorefrontConfig(business.id, { theme: { presetId: "PLAYFUL" } });

  // Exactly the field set business-information/actions.ts's
  // updateBusinessInformation passes — deliberately never includes `settings`.
  await updateBusiness(business.id, { name: "New Name", city: "Cape Town" });

  const updated = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  assert.equal(updated.name, "New Name");
  const capabilities = getBusinessCapabilities(updated);
  assert.ok(capabilities.has("PRODUCTS") && capabilities.has("ORDERS") && capabilities.has("DELIVERY"), "capabilities must survive a business-info edit");
  const theme = getStorefrontConfig(updated);
  assert.equal(theme.theme.presetId, "PLAYFUL", "theme preset must survive a business-info edit");
});

test("a business-information edit never sets primaryColor/accentColor — those stay Design's exclusive job", async () => {
  const business = await makeBusiness("no-branding");
  const before = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  await updateBusiness(business.id, { name: "Renamed" });
  const after = await prisma.business.findUniqueOrThrow({ where: { id: business.id } });
  assert.equal(after.primaryColor, before.primaryColor);
  assert.equal(after.accentColor, before.accentColor);
});

test("MANAGER and CASHIER presets never carry canManageSettings — the permission updateBusinessInformation's permittedRedirect gates on", () => {
  assert.equal(STAFF_PERMISSIONS_BY_PRESET.MANAGER.canManageSettings, false);
  assert.equal(STAFF_PERMISSIONS_BY_PRESET.CASHIER.canManageSettings, false);
});
