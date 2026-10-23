import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { hashPassword } from "@/modules/auth/auth.service";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function makeBusiness(label: string, category: string, description?: string) {
  const { business } = await createBusiness({
    name: `Tenant Service Test ${label} ${suffix}`,
    category: category as never,
    description,
    owner: {
      firstName: "Owner",
      lastName: label,
      email: `tenant-owner-${label}-${suffix}@example.test`,
      passwordHash: await hashPassword("SomePassword123"),
    },
  });
  return business;
}

test.after(async () => {
  const businesses = await prisma.business.findMany({
    where: { name: { startsWith: "Tenant Service Test " } },
    select: { id: true },
  });
  for (const { id } of businesses) {
    await prisma.businessStaff.deleteMany({ where: { businessId: id } });
    await prisma.businessRole.deleteMany({ where: { businessId: id } });
    await prisma.businessSubscription.deleteMany({ where: { businessId: id } });
    await prisma.business.delete({ where: { id } });
  }
});

// These exercise createBusiness's category-classifier integration (§Phase
// 4) against the free rules-based fallback — ANTHROPIC_API_KEY is never set
// in this test run, matching this module's own test convention.

test("OTHER + a food-shaped description is auto-classified to FOOD_VENDOR", async () => {
  const business = await makeBusiness("food-other", "OTHER", "We sell kotas and cold drinks from a stand");
  assert.equal(business.category, "FOOD_VENDOR");
});

test("OTHER with no description at all stays OTHER — classifier is never invoked without text to classify", async () => {
  const business = await makeBusiness("no-description", "OTHER");
  assert.equal(business.category, "OTHER");
});

test("OTHER with an unclassifiable description stays OTHER, never a wrong guess", async () => {
  const business = await makeBusiness("gibberish", "OTHER", "asdkjhaskjdh random gibberish text");
  assert.equal(business.category, "OTHER");
});

test("a real dropdown pick is always trusted as-is — never overridden even when the description suggests a different category", async () => {
  const business = await makeBusiness("salon-with-food-text", "SALON", "We sell kotas and cold drinks from a stand");
  assert.equal(business.category, "SALON");
});
