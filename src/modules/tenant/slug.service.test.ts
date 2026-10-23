import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { allocateSlug, changeBusinessSlug, InvalidSlugError } from "./slug.service";

/**
 * Slug allocation + safe slug change, against a real database (the app's
 * Prisma singleton — same pattern as domain-attacks.test.ts). Every fixture
 * carries a unique run suffix and is removed in `after`.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const created: string[] = [];

async function makeBusiness(slug: string, status: "ACTIVE" | "PENDING_VERIFICATION" = "ACTIVE") {
  const business = await prisma.business.create({ data: { name: slug, slug, status }, select: { id: true, slug: true } });
  created.push(business.id);
  return business;
}

async function allocate(name: string, context: { suburb?: string; city?: string } = {}) {
  // Same budget createBusiness gives this work on a cold serverless database.
  return prisma.$transaction((tx) => allocateSlug(tx, name, context), { timeout: 15_000, maxWait: 10_000 });
}

test.after(async () => {
  await prisma.businessSlugHistory.deleteMany({ where: { businessId: { in: created } } });
  await prisma.business.deleteMany({ where: { id: { in: created } } });
});

test("allocateSlug returns the plain name when it's free", async () => {
  assert.equal(await allocate(`Kota Tainment ${run}`), `kota-tainment-${run}`);
});

test("collision handling is deterministic: location first, then numbers", async () => {
  const base = `kota-${run}`;
  await makeBusiness(base);
  assert.equal(await allocate(`Kota ${run}`, { suburb: "Soweto", city: "Johannesburg" }), `${base}-soweto`);

  await makeBusiness(`${base}-soweto`);
  assert.equal(await allocate(`Kota ${run}`, { suburb: "Soweto", city: "Johannesburg" }), `${base}-johannesburg`);

  await makeBusiness(`${base}-johannesburg`);
  assert.equal(await allocate(`Kota ${run}`, { suburb: "Soweto", city: "Johannesburg" }), `${base}-2`);
});

test("a slug held in history is never handed to a new business", async () => {
  const owner = await makeBusiness(`history-owner-${run}`);
  await prisma.businessSlugHistory.create({ data: { businessId: owner.id, slug: `retired-${run}` } });
  assert.equal(await allocate(`Retired ${run}`), `retired-${run}-2`);
});

test("a reserved business name never gets the reserved slug", async () => {
  const slug = await allocate("Admin", { suburb: `Soweto ${run}` });
  assert.notEqual(slug, "admin");
  assert.equal(slug, `admin-soweto-${run}`);
});

test("concurrent signups with the same name get different slugs (advisory lock)", async () => {
  const name = `Race ${run}`;
  const slugs = await Promise.all(
    [0, 1, 2].map(() =>
      prisma.$transaction(async (tx) => {
        const slug = await allocateSlug(tx, name);
        const business = await tx.business.create({ data: { name, slug }, select: { id: true } });
        created.push(business.id);
        return slug;
      }, { timeout: 20_000, maxWait: 20_000 }),
    ),
  );
  assert.equal(new Set(slugs).size, 3);
  assert.ok(slugs.includes(`race-${run}`));
});

test("changeBusinessSlug moves the old slug to history and keeps Business.id", async () => {
  const business = await makeBusiness(`before-${run}`);
  const slug = await changeBusinessSlug(business.id, `After ${run}`);
  assert.equal(slug, `after-${run}`);

  const reloaded = await prisma.business.findUniqueOrThrow({ where: { id: business.id }, select: { id: true, slug: true } });
  assert.equal(reloaded.id, business.id);
  assert.equal(reloaded.slug, `after-${run}`);
  const history = await prisma.businessSlugHistory.findUnique({ where: { slug: `before-${run}` } });
  assert.equal(history?.businessId, business.id);
});

test("changeBusinessSlug refuses a reserved or malformed slug", async () => {
  const business = await makeBusiness(`refuse-${run}`);
  await assert.rejects(changeBusinessSlug(business.id, "dashboard"), InvalidSlugError);
  await assert.rejects(changeBusinessSlug(business.id, "ab"), InvalidSlugError);
});

test("owner input is normalized first, so it can never produce a punycode label", async () => {
  const business = await makeBusiness(`puny-${run}`);
  const slug = await changeBusinessSlug(business.id, `XN--${run}`);
  assert.equal(slug, `xn-${run}`);
  assert.ok(!slug.startsWith("xn--"));
});

test("changeBusinessSlug refuses another business's live or retired slug", async () => {
  const a = await makeBusiness(`taker-${run}`);
  const b = await makeBusiness(`holder-${run}`);
  await assert.rejects(changeBusinessSlug(a.id, b.slug), /already taken/);

  await changeBusinessSlug(b.id, `holder-new-${run}`);
  await assert.rejects(changeBusinessSlug(a.id, b.slug), /already taken/, "a retired slug stays with its business");
});

test("a business can reclaim its own retired slug", async () => {
  const business = await makeBusiness(`reclaim-${run}`);
  await changeBusinessSlug(business.id, `reclaim-other-${run}`);
  assert.equal(await changeBusinessSlug(business.id, `reclaim-${run}`), `reclaim-${run}`);
  assert.equal(await prisma.businessSlugHistory.count({ where: { slug: `reclaim-${run}` } }), 0);
  assert.equal(await prisma.businessSlugHistory.count({ where: { slug: `reclaim-other-${run}` } }), 1);
});
