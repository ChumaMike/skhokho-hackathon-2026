import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import {
  generateDraft,
  editDraft,
  publishRevision,
  discardDraft,
  getRevision,
  listRevisions,
  DAILY_GENERATION_LIMIT,
  GenerationLimitError,
  InvalidEditError,
  RevisionNotFoundError,
} from "./revision.service";
import { SpecNotPublishableError } from "./validate";
import { gatherStorefrontFacts } from "./facts";
import { projectSpec } from "./project";
import { getStorefrontLayout } from "./layout";
import type { StorefrontModel } from "./copywriter";

/**
 * The merchant workflow against a real database (the app's Prisma
 * singleton, like the other service tests). Fixture businesses carry a
 * unique suffix and are removed in `after`. The model is always a stub —
 * these tests never call a real AI.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const created: string[] = [];

async function makeFood(label: string) {
  const b = await prisma.business.create({
    data: {
      name: `Kota ${label}`,
      slug: `sf-${label}-${run}`,
      category: "FOOD_VENDOR",
      status: "ACTIVE",
      description: "Soweto kotas and chips.",
      suburb: "Soweto",
      whatsapp: "+27821234567",
      primaryColor: "#9A5A0A",
      accentColor: "#1F6F5C",
      settings: { delivery: { enabled: true, feeCents: 2500 } },
    },
    select: { id: true },
  });
  created.push(b.id);
  await prisma.product.createMany({
    data: [
      { businessId: b.id, name: "Russian kota", price: 45 },
      { businessId: b.id, name: "Chips", price: 20 },
    ],
  });
  return b.id;
}

const stub = (over: Record<string, unknown> = {}): StorefrontModel => async () =>
  JSON.stringify({
    rationale: "Ordering online is the main job, so the menu comes first.",
    heroHeadline: "Proper Soweto kotas",
    heroSubline: "Order online and collect.",
    ctaLabel: "Order now",
    seoTitle: "Kota — kotas in Soweto",
    seoDescription: "Order Russian kotas and chips online in Soweto and collect them hot from our counter.",
    ...over,
  });

test.after(async () => {
  await prisma.storefrontRevision.deleteMany({ where: { businessId: { in: created } } });
  await prisma.product.deleteMany({ where: { businessId: { in: created } } });
  await prisma.service.deleteMany({ where: { businessId: { in: created } } });
  await prisma.business.deleteMany({ where: { id: { in: created } } });
});

test("AI generation creates a DRAFT only — the live storefront is untouched", async () => {
  const biz = await makeFood("draft");
  const before = await prisma.business.findUniqueOrThrow({ where: { id: biz }, select: { settings: true, primaryColor: true } });

  const draft = await generateDraft(biz, "staff-1", "GENERATE", { model: stub() });
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.source, "AI_GENERATED");
  assert.equal(draft.version, 1);
  assert.equal(draft.spec.content.heroHeadline, "Proper Soweto kotas");
  assert.equal(draft.validation.ok, true);

  const after = await prisma.business.findUniqueOrThrow({ where: { id: biz }, select: { settings: true, primaryColor: true } });
  assert.deepEqual(after, before, "nothing published");
});

test("invalid AI output still yields a usable draft, built from the rules, with the reason", async () => {
  const biz = await makeFood("badai");
  const draft = await generateDraft(biz, null, "GENERATE", { model: async () => "<html><script>alert(1)</script></html>" });
  assert.equal(draft.source, "RULES");
  assert.match(draft.aiNote ?? "", /not valid JSON/);
  assert.equal(draft.validation.ok, true);
});

test("no model configured → a rules draft", async () => {
  const biz = await makeFood("nomodel");
  const draft = await generateDraft(biz, null, "ASSIST", { model: null });
  assert.equal(draft.source, "RULES");
});

test("merchant edits are applied; unsafe edits are refused outright", async () => {
  const biz = await makeFood("edit");
  const draft = await generateDraft(biz, null, "GENERATE", { model: stub() });

  const edited = await editDraft(biz, draft.id, { heroHeadline: "Kotas made the Soweto way", ctaLabel: "Order a kota" });
  assert.equal(edited.spec.content.heroHeadline, "Kotas made the Soweto way");
  assert.equal(edited.spec.cta.label, "Order a kota");

  await assert.rejects(editDraft(biz, draft.id, { heroHeadline: "<img src=x onerror=alert(1)>" }), InvalidEditError);
  await assert.rejects(editDraft(biz, draft.id, { aboutBody: "Visit https://evil.example" }), InvalidEditError);
  await assert.rejects(editDraft(biz, draft.id, { html: "<div/>" }), InvalidEditError);
  await assert.rejects(editDraft(biz, draft.id, { ctaAction: "PAY_NOW" }), InvalidEditError);
});

test("an edit the business can't honour is saved, but blocks publishing until fixed", async () => {
  const biz = await makeFood("blocked");
  const draft = await generateDraft(biz, null, "GENERATE", { model: stub() });

  // A food business has no bookings — the edit is well-formed but impossible.
  const edited = await editDraft(biz, draft.id, { ctaAction: "BOOK" });
  assert.equal(edited.validation.ok, false);
  await assert.rejects(publishRevision(biz, draft.id, null), SpecNotPublishableError);
  const stillDraft = await getRevision(biz, draft.id);
  assert.equal(stillDraft?.status, "DRAFT");
});

test("publishing applies exactly the previewed projection, keeps unrelated settings, and archives the old version", async () => {
  const biz = await makeFood("publish");
  const first = await generateDraft(biz, null, "GENERATE", { model: stub({ presetId: "BOLD", sectionOrder: ["ABOUT", "CATALOGUE", "TRUST_BAR", "REVIEWS"] }) });

  const beforeSettings = (await prisma.business.findUniqueOrThrow({ where: { id: biz }, select: { settings: true } })).settings;
  const expected = projectSpec(beforeSettings, first.spec, first.id);

  const published = await publishRevision(biz, first.id, "staff-1");
  assert.equal(published.status, "PUBLISHED");

  const live = await prisma.business.findUniqueOrThrow({ where: { id: biz }, select: { settings: true, primaryColor: true, accentColor: true } });
  assert.deepEqual(live.settings, expected.settings, "what was previewed is what went live");
  assert.equal(live.primaryColor, expected.primaryColor);
  assert.deepEqual((live.settings as Record<string, unknown>).delivery, { enabled: true, feeCents: 2500 });
  assert.equal(getStorefrontLayout(live)?.revisionId, first.id);

  const second = await generateDraft(biz, null, "ASSIST", { model: stub({ heroHeadline: "Kotas, chips, cold drinks" }) });
  await publishRevision(biz, second.id, "staff-1");
  assert.equal((await getRevision(biz, first.id))?.status, "ARCHIVED");
  assert.equal(await prisma.storefrontRevision.count({ where: { businessId: biz, status: "PUBLISHED" } }), 1);

  // ...and an earlier published version can be restored.
  await publishRevision(biz, first.id, "staff-1");
  const restored = await prisma.business.findUniqueOrThrow({ where: { id: biz }, select: { settings: true } });
  assert.equal(getStorefrontLayout(restored)?.revisionId, first.id);
});

test("publishing re-validates against today's business: a capability switched off since drafting blocks it", async () => {
  const biz = await makeFood("drift");
  const draft = await generateDraft(biz, null, "GENERATE", { model: stub() });
  assert.equal(draft.spec.cta.action, "ORDER");

  // The owner switches online ordering off after the draft was made.
  await prisma.business.update({ where: { id: biz }, data: { settings: { capabilities: ["PRODUCTS", "PICKUP"] } } });
  await assert.rejects(publishRevision(biz, draft.id, null), (e: unknown) => e instanceof SpecNotPublishableError && /order/i.test(e.message));
});

test("a discarded draft can't be published or edited", async () => {
  const biz = await makeFood("discard");
  const draft = await generateDraft(biz, null, "GENERATE", { model: stub() });
  await discardDraft(biz, draft.id);
  await assert.rejects(publishRevision(biz, draft.id, null), RevisionNotFoundError);
  await assert.rejects(editDraft(biz, draft.id, { heroHeadline: "Hello" }), RevisionNotFoundError);
});

test("tenant isolation: business B can't read, edit, publish or discard business A's revision", async () => {
  const a = await makeFood("iso-a");
  const b = await makeFood("iso-b");
  const draftA = await generateDraft(a, null, "GENERATE", { model: stub() });

  assert.equal(await getRevision(b, draftA.id), null);
  assert.equal((await listRevisions(b)).some((r) => r.id === draftA.id), false);
  await assert.rejects(editDraft(b, draftA.id, { heroHeadline: "Hijacked" }), RevisionNotFoundError);
  await assert.rejects(publishRevision(b, draftA.id, null), RevisionNotFoundError);
  await assert.rejects(discardDraft(b, draftA.id), RevisionNotFoundError);

  const untouched = await getRevision(a, draftA.id);
  assert.equal(untouched?.status, "DRAFT");
  assert.equal(untouched?.spec.content.heroHeadline, "Proper Soweto kotas");
});

test("the AI never sees private data: facts carry presence flags, not phone numbers", async () => {
  const biz = await makeFood("privacy");
  const facts = await gatherStorefrontFacts(biz);
  assert.equal(facts.contact.whatsapp, true);
  assert.doesNotMatch(JSON.stringify(facts), /\+27|821234567/);
});

test("generation is limited per business per day (cost control)", async () => {
  const biz = await makeFood("limit");
  for (let i = 0; i < DAILY_GENERATION_LIMIT; i++) await generateDraft(biz, null, "ASSIST", { model: null });
  await assert.rejects(generateDraft(biz, null, "ASSIST", { model: null }), GenerationLimitError);
  // A day later it works again.
  const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000);
  const next = await generateDraft(biz, null, "ASSIST", { model: null, now: tomorrow });
  assert.equal(next.status, "DRAFT");
});

test("switching design in the editor re-derives the layout and ignores that save's stale layout fields", async () => {
  const biz = await makeFood("switch");
  const draft = await generateDraft(biz, null, "GENERATE", { model: null });
  assert.equal(draft.spec.templateId, "FOOD_MENU");

  // The form posts every field — including the OLD menu-first section order and button.
  const switched = await editDraft(biz, draft.id, {
    templateId: "CLASSIC",
    heroHeadline: "Kotas, chips and cold drinks",
    sections: draft.spec.home.sections,
    ctaAction: draft.spec.cta.action,
    presetId: "PLAYFUL",
  });
  assert.equal(switched.spec.templateId, null);
  assert.equal(switched.spec.content.heroHeadline, "Kotas, chips and cold drinks", "the words still apply");
  assert.deepEqual(switched.spec.home.sections.map((s) => s.id), ["TRUST_BAR", "CATALOGUE", "ABOUT", "REVIEWS"], "classic order, not the stale menu order");
  assert.notEqual(switched.spec.theme.presetId, "PLAYFUL", "style comes from the switch, not the stale field");
  assert.equal(switched.validation.ok, true);
});

test("the editor refuses a design the business doesn't fit", async () => {
  const biz = await makeFood("switch-bad");
  const draft = await generateDraft(biz, null, "GENERATE", { model: null });
  await assert.rejects(editDraft(biz, draft.id, { templateId: "SALON_BOOKING" }), (e: unknown) => e instanceof InvalidEditError && /doesn't fit/.test(e.message));
});
