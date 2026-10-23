import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { clearHostnameCache } from "@/lib/tenant/context";
import { POST as eventsPOST } from "@/app/api/store/events/route";
import { generateDraft, publishRevision } from "@/modules/storefront-spec/revision.service";
import { recordStorefrontEvents, storefrontDay } from "./events";
import { getStorefrontInsights } from "./insights";
import { gatherPerformance, getApprovedPattern, patternFromSpec, patternSignature, reviewPatternCandidate, runPatternDetection } from "./patterns";
import { STOREFRONT_STATS_RETENTION_DAYS, deleteStorefrontStatsForBusiness, purgeExpiredStorefrontStats } from "./retention";
import { parseSpec } from "@/modules/storefront-spec/spec";

/**
 * Storefront learning against a real database. Fixture businesses carry a
 * unique suffix and are removed in `after`. No AI is called (model: null).
 */

const STOREFRONT = "skhokholabs.app";
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const previousStorefront = process.env.STOREFRONT_DOMAIN;
const created: string[] = [];
const signatures: string[] = [];

async function makeFood(label: string, settings: Record<string, unknown> = {}) {
  const b = await prisma.business.create({
    data: {
      name: `Learn ${label}`,
      slug: `lrn-${label}-${run}`,
      category: "FOOD_VENDOR",
      status: "ACTIVE",
      description: "Kotas and chips.",
      whatsapp: "+27821234567",
      settings: { delivery: { enabled: true, feeCents: 2500 }, ...settings },
    },
    select: { id: true, slug: true },
  });
  created.push(b.id);
  const p = await prisma.product.create({ data: { businessId: b.id, name: `Kota ${label}`, price: 45 }, select: { id: true } });
  return { ...b, productId: p.id };
}

async function stats(businessId: string) {
  return prisma.storefrontDailyStat.findMany({ where: { businessId }, orderBy: [{ event: "asc" }, { page: "asc" }] });
}

function beacon(host: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`https://${host}/api/store/events`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { host, "content-type": "application/json", "x-forwarded-for": `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...headers },
  });
}

test.before(() => {
  process.env.STOREFRONT_DOMAIN = STOREFRONT;
});
test.beforeEach(clearHostnameCache);

test.after(async () => {
  clearHostnameCache();
  if (previousStorefront === undefined) delete process.env.STOREFRONT_DOMAIN;
  else process.env.STOREFRONT_DOMAIN = previousStorefront;
  await prisma.storefrontPatternCandidate.deleteMany({ where: { signature: { in: signatures } } });
  await prisma.storefrontDailyStat.deleteMany({ where: { businessId: { in: created } } });
  await prisma.storefrontRevision.deleteMany({ where: { businessId: { in: created } } });
  await prisma.product.deleteMany({ where: { businessId: { in: created } } });
  await prisma.business.deleteMany({ where: { id: { in: created } } });
});

// ---------------------------------------------------------------------------
// Privacy: what the table can hold
// ---------------------------------------------------------------------------

test("privacy: the counters table has no column that could hold a person", async () => {
  const cols = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'storefront_daily_stats'`;
  const names = cols.map((c) => c.column_name).sort();
  assert.deepEqual(names, ["business_id", "count", "day", "device", "event", "id", "item_id", "page", "revision_id", "section", "template_id"]);
  const patternCols = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'storefront_pattern_candidates'`;
  assert.equal(patternCols.some((c) => c.column_name === "business_id"), false, "pattern candidates name no business");
});

test("privacy: Do Not Track and Global Privacy Control mean nothing is counted", async () => {
  const biz = await makeFood("dnt");
  const host = `${biz.slug}.${STOREFRONT}`;
  const body = { businessId: biz.id, events: [{ type: "PAGE_VIEW", page: "HOME" }] };
  assert.equal((await eventsPOST(beacon(host, body, { dnt: "1" }))).status, 204);
  assert.equal((await eventsPOST(beacon(host, body, { "sec-gpc": "1" }))).status, 204);
  assert.equal((await stats(biz.id)).length, 0);
  assert.equal((await eventsPOST(beacon(host, body))).status, 204);
  assert.equal((await stats(biz.id)).length, 1);
});

test("privacy: a browser can't fake an order; junk is ignored, always 204", async () => {
  const biz = await makeFood("fake");
  const host = `${biz.slug}.${STOREFRONT}`;
  for (const body of [
    { businessId: biz.id, events: [{ type: "ORDER_PLACED", page: "CHECKOUT" }] },
    { businessId: biz.id, events: [{ type: "PAGE_VIEW", page: "HOME", email: "a@b.co" }] },
    "not json at all",
  ]) {
    const res = await eventsPOST(beacon(host, body));
    assert.equal(res.status, 204);
  }
  assert.equal((await stats(biz.id)).length, 0);
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

test("isolation: a tenant host can only count for its own business", async () => {
  const a = await makeFood("iso-a");
  const b = await makeFood("iso-b");
  await eventsPOST(beacon(`${a.slug}.${STOREFRONT}`, { businessId: b.id, events: [{ type: "PAGE_VIEW", page: "HOME" }] }));
  assert.equal((await stats(b.id)).length, 0, "A's host cannot inflate B's numbers");
});

test("isolation: another business's product ids are dropped, own are kept", async () => {
  const a = await makeFood("item-a");
  const b = await makeFood("item-b");
  await eventsPOST(
    beacon(`${a.slug}.${STOREFRONT}`, {
      businessId: a.id,
      events: [
        { type: "ADD_TO_BASKET", page: "SHOP", itemId: a.productId },
        { type: "ADD_TO_BASKET", page: "SHOP", itemId: b.productId },
      ],
    }),
  );
  const rows = await stats(a.id);
  assert.deepEqual(rows.map((r) => r.itemId), [a.productId]);
});

test("isolation: suspended businesses are not counted", async () => {
  const biz = await makeFood("susp");
  await prisma.business.update({ where: { id: biz.id }, data: { status: "SUSPENDED" } });
  await eventsPOST(beacon("localhost", { businessId: biz.id, events: [{ type: "PAGE_VIEW", page: "HOME" }] }));
  assert.equal((await stats(biz.id)).length, 0);
});

test("isolation: insights only ever read the business's own counters and items", async () => {
  const a = await makeFood("ins-a");
  const b = await makeFood("ins-b");
  await recordStorefrontEvents(a.id, Array(30).fill({ type: "PAGE_VIEW", page: "HOME" }));
  await recordStorefrontEvents(b.id, Array(500).fill({ type: "PAGE_VIEW", page: "SHOP" }));
  await recordStorefrontEvents(b.id, Array(10).fill({ type: "ADD_TO_BASKET", page: "SHOP", itemId: b.productId }));
  // Even if a foreign item id somehow got into A's counters, its name never shows.
  await recordStorefrontEvents(a.id, Array(10).fill({ type: "ADD_TO_BASKET", page: "SHOP", itemId: b.productId }));

  const insights = await getStorefrontInsights(a.id);
  assert.equal(insights.visits, 30);
  assert.match(insights.insights.find((i) => i.key === "TOP_PAGE")!.text, /home page/);
  assert.equal(insights.insights.some((i) => i.text.includes("Kota ins-b")), false);
});

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

test("aggregation: one row per counter; batches merge; increments add up", async () => {
  const biz = await makeFood("agg");
  await recordStorefrontEvents(biz.id, [{ type: "PAGE_VIEW", page: "HOME" }, { type: "PAGE_VIEW", page: "HOME" }, { type: "CTA_CLICK", page: "HOME", section: "HERO" }]);
  await recordStorefrontEvents(biz.id, [{ type: "PAGE_VIEW", page: "HOME" }]);
  const rows = await stats(biz.id);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.event === "PAGE_VIEW")!.count, 3);
  assert.equal(rows.find((r) => r.event === "CTA_CLICK")!.count, 1);
});

test("aggregation: concurrent visitors never lose a count", async () => {
  const biz = await makeFood("conc");
  await Promise.all(Array.from({ length: 25 }, () => recordStorefrontEvents(biz.id, [{ type: "PAGE_VIEW", page: "HOME" }], { device: "MOBILE" })));
  const rows = await stats(biz.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 25);
});

test("aggregation: separate days, devices and the live storefront version are separate counters", async () => {
  const biz = await makeFood("dims");
  await recordStorefrontEvents(biz.id, [{ type: "PAGE_VIEW", page: "HOME" }], { now: new Date("2026-10-01T10:00:00Z"), device: "MOBILE" });
  await recordStorefrontEvents(biz.id, [{ type: "PAGE_VIEW", page: "HOME" }], { now: new Date("2026-10-02T10:00:00Z"), device: "MOBILE" });
  await recordStorefrontEvents(biz.id, [{ type: "PAGE_VIEW", page: "HOME" }], { now: new Date("2026-10-02T10:00:00Z"), device: "DESKTOP" });
  assert.equal((await stats(biz.id)).length, 3);

  // Publish a storefront version: new counts are attributed to it.
  const draft = await generateDraft(biz.id, null, "GENERATE", { model: null });
  await publishRevision(biz.id, draft.id, null);
  await recordStorefrontEvents(biz.id, [{ type: "PAGE_VIEW", page: "HOME" }]);
  const attributed = await prisma.storefrontDailyStat.findMany({ where: { businessId: biz.id, revisionId: draft.id } });
  assert.equal(attributed.length, 1);
});

test("aggregation: orders and bookings are counted server-side", async () => {
  const { countServerEvent } = await import("./events");
  const biz = await makeFood("server");
  await countServerEvent(biz.id, "ORDER_PLACED", "CHECKOUT");
  await countServerEvent(biz.id, "BOOKING_SUBMITTED", "HOME");
  const rows = await stats(biz.id);
  assert.deepEqual(rows.map((r) => r.event).sort(), ["BOOKING_SUBMITTED", "ORDER_PLACED"]);
  // A failure to count never throws into the order path.
  await assert.doesNotReject(countServerEvent("00000000-0000-4000-8000-000000000000", "ORDER_PLACED", "CHECKOUT"));
});

// ---------------------------------------------------------------------------
// Retention & deletion
// ---------------------------------------------------------------------------

test("retention: counters older than the retention period are purged; recent ones stay", async () => {
  const biz = await makeFood("ret");
  const now = new Date("2026-10-05T10:00:00Z");
  const old = new Date(storefrontDay(now).getTime() - (STOREFRONT_STATS_RETENTION_DAYS + 1) * 86_400_000);
  const recent = new Date(storefrontDay(now).getTime() - 10 * 86_400_000);
  await recordStorefrontEvents(biz.id, [{ type: "PAGE_VIEW", page: "HOME" }], { now: old });
  await recordStorefrontEvents(biz.id, [{ type: "PAGE_VIEW", page: "SHOP" }], { now: recent });
  await purgeExpiredStorefrontStats(now);
  const rows = await stats(biz.id);
  assert.deepEqual(rows.map((r) => r.page), ["SHOP"]);
});

test("deletion: a business clearing its analytics touches only its own counters", async () => {
  const a = await makeFood("del-a");
  const b = await makeFood("del-b");
  await recordStorefrontEvents(a.id, [{ type: "PAGE_VIEW", page: "HOME" }]);
  await recordStorefrontEvents(b.id, [{ type: "PAGE_VIEW", page: "HOME" }]);
  await deleteStorefrontStatsForBusiness(a.id);
  assert.equal((await stats(a.id)).length, 0);
  assert.equal((await stats(b.id)).length, 1);
});

test("deletion: deleting a business deletes its counters (cascade)", async () => {
  const biz = await makeFood("cascade");
  await recordStorefrontEvents(biz.id, [{ type: "PAGE_VIEW", page: "HOME" }]);
  await prisma.product.deleteMany({ where: { businessId: biz.id } });
  await prisma.business.delete({ where: { id: biz.id } });
  assert.equal(await prisma.storefrontDailyStat.count({ where: { businessId: biz.id } }), 0);
});

// ---------------------------------------------------------------------------
// The pipeline: successful storefronts → candidate → approval → reuse
// ---------------------------------------------------------------------------

test("pipeline: detection makes a CANDIDATE only; nothing is used until approved; opt-outs are excluded", async () => {
  // Three businesses on the winning structure, two on another, one opted out.
  const winners = await Promise.all(["w1", "w2", "w3"].map((l) => makeFood(`pipe-${l}`)));
  const others = await Promise.all(["o1", "o2"].map((l) => makeFood(`pipe-${l}`)));
  const optOut = await makeFood("pipe-out", { storefrontLearning: { contribute: false } });

  const publish = async (biz: { id: string }, reverse: boolean) => {
    const draft = await generateDraft(biz.id, null, "GENERATE", { model: null });
    if (reverse) {
      const spec = parseSpec((await prisma.storefrontRevision.findUniqueOrThrow({ where: { id: draft.id } })).spec);
      assert.ok(spec.ok);
      spec.spec.home.sections = [...spec.spec.home.sections].reverse();
      await prisma.storefrontRevision.update({ where: { id: draft.id }, data: { spec: spec.spec as object } });
    }
    await publishRevision(biz.id, draft.id, null);
    return draft.id;
  };
  for (const w of winners) await publish(w, false);
  for (const o of others) await publish(o, true);
  await publish(optOut, true);

  const now = new Date();
  for (const w of winners) {
    await recordStorefrontEvents(w.id, Array(10).fill({ type: "PAGE_VIEW", page: "HOME" }), { now });
    await prisma.storefrontDailyStat.updateMany({ where: { businessId: w.id, event: "PAGE_VIEW" }, data: { count: 200 } });
    await recordStorefrontEvents(w.id, [{ type: "ORDER_PLACED", page: "CHECKOUT" }], { now });
    await prisma.storefrontDailyStat.updateMany({ where: { businessId: w.id, event: "ORDER_PLACED" }, data: { count: 30 } });
  }
  for (const o of [...others, optOut]) {
    await recordStorefrontEvents(o.id, [{ type: "PAGE_VIEW", page: "HOME" }], { now });
    await prisma.storefrontDailyStat.updateMany({ where: { businessId: o.id, event: "PAGE_VIEW" }, data: { count: 600 } });
    await recordStorefrontEvents(o.id, [{ type: "ORDER_PLACED", page: "CHECKOUT" }], { now });
    await prisma.storefrontDailyStat.updateMany({ where: { businessId: o.id, event: "ORDER_PLACED" }, data: { count: 30 } });
  }

  const performance = await gatherPerformance(now);
  assert.equal(performance.some((p) => p.businessId === optOut.id), false, "opted-out business is not evidence");

  const winnerRev = await prisma.storefrontRevision.findFirstOrThrow({ where: { businessId: winners[0].id, status: "PUBLISHED" } });
  const winnerSpec = parseSpec(winnerRev.spec);
  assert.ok(winnerSpec.ok);
  const winnerShape = patternFromSpec(winnerSpec.spec);
  const signature = patternSignature(winnerShape);
  signatures.push(signature, patternSignature({ ...winnerShape, sections: [...winnerShape.sections].reverse() }));

  await runPatternDetection(now);
  const candidate = await prisma.storefrontPatternCandidate.findUniqueOrThrow({ where: { signature } });
  assert.equal(candidate.status, "CANDIDATE");
  // >= 3: other fixtures in this file may publish the same standard structure.
  assert.ok((candidate.evidence as { businesses: number }).businesses >= 3);
  assert.doesNotMatch(JSON.stringify(candidate), /Learn pipe|Kota pipe|lrn-pipe/, "no merchant content in the candidate");
  for (const w of winners) assert.equal(JSON.stringify(candidate).includes(w.id), false, "no business id in the candidate");

  // Not approved → not used.
  assert.equal(await getApprovedPattern(winnerShape.vertical, winnerShape.templateId), null);

  // Approve → used; re-detection doesn't reset the decision.
  await reviewPatternCandidate(candidate.id, "APPROVED", "admin-test", "Looks right");
  await runPatternDetection(now);
  assert.equal((await prisma.storefrontPatternCandidate.findUniqueOrThrow({ where: { signature } })).status, "APPROVED");
  assert.deepEqual(await getApprovedPattern(winnerShape.vertical, winnerShape.templateId), winnerShape);

  // A new business's Level B draft starts from the approved structure, and records what the engine proposed.
  const fresh = await makeFood("pipe-new");
  const draft = await generateDraft(fresh.id, null, "GENERATE", { model: null });
  assert.deepEqual(draft.spec.home.sections.map((s) => s.id), winnerShape.sections.concat(draft.spec.home.sections.map((s) => s.id).filter((id) => !winnerShape.sections.includes(id))));
  const stored = await prisma.storefrontRevision.findUniqueOrThrow({ where: { id: draft.id }, select: { originalSpec: true, spec: true } });
  assert.deepEqual(stored.originalSpec, stored.spec);

  // Retire → no longer used.
  await reviewPatternCandidate(candidate.id, "RETIRED", "admin-test");
  assert.equal(await getApprovedPattern(winnerShape.vertical, winnerShape.templateId), null);
});
