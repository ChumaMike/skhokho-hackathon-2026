import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { AuthError, resolveStaffActor, type StaffActor } from "@/lib/auth/guards";
import { signToken, verifyToken } from "@/modules/auth/auth.service";
import { STAFF_PRESETS } from "@/modules/staff/staff-presets";
import { recordStorefrontEvents } from "@/modules/storefront-learning/events";
import { gatherBuddySnapshot } from "./buddy-snapshot";
import { buildBriefing } from "./briefing";
import { BuddyActionError, applyBuddyAction, cancelBuddyAction, prepareBuddyAction } from "./buddy-actions";
import { buildAssistantContext } from "./assistant.service";
import { getBuddyHistory, sendBuddyMessage } from "./buddy-chat.service";

/**
 * The Business Buddy against a real database, through the normal
 * authorization path: a signed session token is verified and resolved to an
 * actor by the same lookup the dashboard guards use (resolveStaffActor), and
 * every read/action decides from that actor. Owner, manager, restricted
 * (kitchen) staff and a second business. No AI is called.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const businesses: string[] = [];

interface Fixture {
  id: string;
  russian: string;
  chips: string;
  ownerToken: string;
  managerToken: string;
  managerStaffId: string;
  managerRoleId: string;
  kitchenToken: string;
  inactiveToken: string;
}

async function staffToken(businessId: string, preset: "MANAGER" | "KITCHEN", label: string, isActive = true) {
  const role = await prisma.businessRole.create({
    data: { businessId, name: `${preset} ${label}`, permissions: STAFF_PRESETS[preset].permissions as object },
    select: { id: true },
  });
  const staff = await prisma.businessStaff.create({
    data: {
      businessId,
      roleId: role.id,
      email: `${label}-${run}@example.test`,
      passwordHash: "x",
      firstName: label,
      lastName: "Test",
      isActive,
    },
    select: { id: true },
  });
  const token = await signToken({ type: "staff", staffId: staff.id, tenantId: businessId, email: `${label}@example.test`, isOwner: false });
  return { token, staffId: staff.id, roleId: role.id };
}

async function makeBusiness(label: string): Promise<Fixture> {
  const b = await prisma.business.create({
    data: { name: `Kota ${label}`, slug: `buddy-${label}-${run}`, category: "FOOD_VENDOR", status: "ACTIVE", whatsapp: "+27821234567" },
    select: { id: true },
  });
  businesses.push(b.id);
  const russian = await prisma.product.create({ data: { businessId: b.id, name: `Russian Kota ${label}`, price: 45 }, select: { id: true } });
  const chips = await prisma.product.create({ data: { businessId: b.id, name: `Chips ${label}`, price: 20 }, select: { id: true } });
  await prisma.order.createMany({
    data: [
      { businessId: b.id, orderNumber: `B-${run}-${label}-1`, subtotal: 45, total: 45, status: "PENDING" },
      { businessId: b.id, orderNumber: `B-${run}-${label}-2`, subtotal: 45, total: 45, status: "PENDING" },
      { businessId: b.id, orderNumber: `B-${run}-${label}-3`, subtotal: 45, total: 45, status: "PENDING" },
      { businessId: b.id, orderNumber: `B-${run}-${label}-4`, subtotal: 20, total: 20, status: "PROCESSING" },
    ],
  });
  // Storefront engagement: Russian Kota is the most-engaged item.
  await recordStorefrontEvents(b.id, Array(10).fill({ type: "ADD_TO_BASKET", page: "SHOP", itemId: russian.id }));
  await recordStorefrontEvents(b.id, Array(30).fill({ type: "PAGE_VIEW", page: "HOME" }));

  const ownerToken = await signToken({ type: "staff", staffId: `owner-${label}-${run}`, tenantId: b.id, email: "owner@example.test", isOwner: true });
  const manager = await staffToken(b.id, "MANAGER", `mgr-${label}`);
  const kitchen = await staffToken(b.id, "KITCHEN", `kit-${label}`);
  const inactive = await staffToken(b.id, "MANAGER", `gone-${label}`, false);
  return {
    id: b.id,
    russian: russian.id,
    chips: chips.id,
    ownerToken,
    managerToken: manager.token,
    managerStaffId: manager.staffId,
    managerRoleId: manager.roleId,
    kitchenToken: kitchen.token,
    inactiveToken: inactive.token,
  };
}

/** The normal path: verify the signed token, then resolve the actor. */
async function as(token: string): Promise<StaffActor> {
  return resolveStaffActor(await verifyToken(token));
}

let A: Fixture;
let B: Fixture;

test.before(async () => {
  A = await makeBusiness("a");
  B = await makeBusiness("b");
});

test.after(async () => {
  await prisma.buddyAction.deleteMany({ where: { businessId: { in: businesses } } });
  await prisma.assistantMessage.deleteMany({ where: { conversation: { businessId: { in: businesses } } } });
  await prisma.assistantConversation.deleteMany({ where: { businessId: { in: businesses } } });
  await prisma.storefrontRevision.deleteMany({ where: { businessId: { in: businesses } } });
  await prisma.storefrontDailyStat.deleteMany({ where: { businessId: { in: businesses } } });
  await prisma.order.deleteMany({ where: { businessId: { in: businesses } } });
  await prisma.product.deleteMany({ where: { businessId: { in: businesses } } });
  await prisma.businessStaff.deleteMany({ where: { businessId: { in: businesses } } });
  await prisma.businessRole.deleteMany({ where: { businessId: { in: businesses } } });
  await prisma.business.deleteMany({ where: { id: { in: businesses } } });
});

// ---------------------------------------------------------------------------
// Authorization: who the buddy is acting for
// ---------------------------------------------------------------------------

test("auth: owner, manager and kitchen resolve to their real role permissions", async () => {
  const owner = await as(A.ownerToken);
  const manager = await as(A.managerToken);
  const kitchen = await as(A.kitchenToken);
  assert.equal(owner.isOwner, true);
  assert.equal(owner.permissions.canManageSettings, true);
  assert.equal(manager.permissions.canManageServices, true);
  assert.equal(manager.permissions.canManageSettings, false);
  assert.equal(kitchen.permissions.canManageOrders, false);
  assert.equal(kitchen.permissions.canPrepareOrders, true);
});

test("auth: deactivated staff, unknown staff and a staff id used against another business are refused", async () => {
  await assert.rejects(as(A.inactiveToken), (e) => e instanceof AuthError && e.status === 403);
  await assert.rejects(resolveStaffActor({ type: "staff", staffId: "nope", tenantId: A.id, isOwner: false }), AuthError);
  // A's manager's staff id presented with B's tenant id.
  await assert.rejects(resolveStaffActor({ type: "staff", staffId: A.managerStaffId, tenantId: B.id, isOwner: false }), AuthError);
  // Customer / admin tokens never become a staff actor.
  await assert.rejects(resolveStaffActor({ type: "platform_user" }), AuthError);
  // A tampered token never verifies.
  await assert.rejects(verifyToken(A.ownerToken.slice(0, -2) + "xx"));
});

// ---------------------------------------------------------------------------
// Observe: what each role's briefing contains
// ---------------------------------------------------------------------------

test("owner: sees orders, storefront engagement and the recommendation with Apply", async () => {
  const owner = await as(A.ownerToken);
  const b = buildBriefing(await gatherBuddySnapshot(owner), owner);
  assert.match(b.greeting, /^Good (morning|afternoon|evening), Kota a\.$/);
  assert.ok(b.attention.some((l) => l.text === "3 orders need attention."));
  assert.ok(b.highlights.some((l) => l.text === "Your Russian Kota a is receiving the most storefront engagement."));
  const rec = b.recommendations.find((r) => r.key === "feature-top-item")!;
  assert.deepEqual(rec.action, { kind: "FEATURE_ITEM", params: { itemType: "PRODUCT", itemId: A.russian, featured: true } });
});

test("manager: sees orders and engagement, can feature; no settings checklist or design drafting", async () => {
  const manager = await as(A.managerToken);
  const snap = await gatherBuddySnapshot(manager);
  assert.ok(snap.orders?.needsAttention === 3);
  assert.ok(snap.storefront?.topItem);
  assert.equal(snap.readiness, undefined);
  assert.equal(snap.hasPublishedDesign, undefined);
  const b = buildBriefing(snap, manager);
  assert.ok(b.recommendations.find((r) => r.key === "feature-top-item")?.action);
  assert.equal(b.recommendations.some((r) => r.action?.kind === "DRAFT_STOREFRONT"), false);
});

test("restricted (kitchen): only what's to prepare — no sales, customers, engagement or payments", async () => {
  const kitchen = await as(A.kitchenToken);
  const snap = await gatherBuddySnapshot(kitchen);
  assert.deepEqual(snap.orders, { toPrepare: 1 });
  for (const area of ["storefront", "lapsedCustomers", "refundsDue", "readiness", "lowStock", "bookings", "deliveries"] as const) {
    assert.equal(snap[area], undefined, area);
  }
  const ctx = await buildAssistantContext(kitchen);
  assert.equal(ctx.customers, undefined);
  assert.equal(ctx.ordersThisWeek, undefined);
  assert.equal(ctx.upcomingAppointments, undefined);
  assert.deepEqual(ctx.briefing, ["1 order to prepare."]);
});

test("cross-tenant: each business's briefing names only its own items", async () => {
  const ownerB = await as(B.ownerToken);
  const b = buildBriefing(await gatherBuddySnapshot(ownerB), ownerB);
  const text = JSON.stringify(b);
  assert.equal(text.includes("Kota a"), false);
  assert.equal(text.includes(A.russian), false);
});

// ---------------------------------------------------------------------------
// prepare → confirm → execute
// ---------------------------------------------------------------------------

async function featured(productId: string) {
  return (await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { isFeatured: true } })).isFeatured;
}

const featureReq = (itemId: string, featured = true) => ({ kind: "FEATURE_ITEM", params: { itemType: "PRODUCT", itemId, featured } });

test("owner: preview changes nothing; Apply features the item; it can't be applied twice", async () => {
  const owner = await as(A.ownerToken);
  const prepared = await prepareBuddyAction(owner, featureReq(A.russian));
  assert.equal(prepared.preview.title, "Feature Russian Kota a on your homepage");
  assert.equal(prepared.preview.changes[0].after, "Russian Kota a");
  assert.equal(await featured(A.russian), false, "preparing never changes the business");

  const result = await applyBuddyAction(owner, prepared.id);
  assert.match(result.message, /Russian Kota a is now featured/);
  assert.equal(await featured(A.russian), true);
  await assert.rejects(applyBuddyAction(owner, prepared.id), /already been dealt with/);

  const row = await prisma.buddyAction.findUniqueOrThrow({ where: { id: prepared.id } });
  assert.equal(row.status, "APPLIED");
  assert.equal(row.actorIsOwner, true);
});

test("manager: may feature (same permission as the Catalogue page)", async () => {
  const manager = await as(A.managerToken);
  const prepared = await prepareBuddyAction(manager, featureReq(A.chips));
  await applyBuddyAction(manager, prepared.id);
  assert.equal(await featured(A.chips), true);
  // And undo it the same way.
  const undo = await prepareBuddyAction(manager, featureReq(A.chips, false));
  await applyBuddyAction(manager, undo.id);
  assert.equal(await featured(A.chips), false);
});

test("restricted staff: preparing is refused with the normal 403, recorded as DENIED, nothing changes", async () => {
  const kitchen = await as(A.kitchenToken);
  await assert.rejects(prepareBuddyAction(kitchen, featureReq(A.chips)), (e) => e instanceof AuthError && e.status === 403);
  assert.equal(await featured(A.chips), false);
  const denied = await prisma.buddyAction.findFirst({ where: { businessId: A.id, actorId: kitchen.staffId }, orderBy: { createdAt: "desc" } });
  assert.equal(denied?.status, "DENIED");
});

test("restricted staff: can't apply someone else's prepared change either", async () => {
  const owner = await as(A.ownerToken);
  const kitchen = await as(A.kitchenToken);
  const prepared = await prepareBuddyAction(owner, featureReq(A.chips));
  await assert.rejects(applyBuddyAction(kitchen, prepared.id), /could not be found/);
  assert.equal(await featured(A.chips), false);
  await cancelBuddyAction(owner, prepared.id);
});

test("manager: publishing-level work (storefront drafts, settings) is refused", async () => {
  const manager = await as(A.managerToken);
  await assert.rejects(prepareBuddyAction(manager, { kind: "DRAFT_STOREFRONT", params: { mode: "GENERATE" } }), (e) => e instanceof AuthError && e.status === 403);
});

test("owner: a storefront draft is created for review — the live storefront is untouched, nothing is published", async () => {
  const owner = await as(A.ownerToken);
  const before = await prisma.business.findUniqueOrThrow({ where: { id: A.id }, select: { settings: true } });
  const prepared = await prepareBuddyAction(owner, { kind: "DRAFT_STOREFRONT", params: { mode: "GENERATE" } });
  const result = await applyBuddyAction(owner, prepared.id);
  assert.match(result.href!, /^\/dashboard\/storefront\/ai\//);
  const revisions = await prisma.storefrontRevision.findMany({ where: { businessId: A.id }, select: { status: true, publishedAt: true } });
  assert.deepEqual(revisions.map((r) => [r.status, r.publishedAt]), [["DRAFT", null]]);
  const after = await prisma.business.findUniqueOrThrow({ where: { id: A.id }, select: { settings: true } });
  assert.deepEqual(after.settings, before.settings);
});

test("high-risk kinds can't even be prepared", async () => {
  const owner = await as(A.ownerToken);
  for (const kind of ["PUBLISH_STOREFRONT", "CHANGE_PAYMENT_CREDENTIALS", "REFUND_PAYMENT", "CANCEL_ORDER", "MANAGE_STAFF", "BUY_DOMAIN"]) {
    await assert.rejects(prepareBuddyAction(owner, { kind, params: {} }), BuddyActionError, kind);
  }
});

test("cross-tenant: another business's item is 'not found'; its owner can't apply our change", async () => {
  const ownerA = await as(A.ownerToken);
  const ownerB = await as(B.ownerToken);
  await assert.rejects(prepareBuddyAction(ownerA, featureReq(B.russian)), /isn't in your catalogue/);
  assert.equal(await featured(B.russian), false);

  const prepared = await prepareBuddyAction(ownerA, featureReq(A.chips));
  await assert.rejects(applyBuddyAction(ownerB, prepared.id), /could not be found/);
  await cancelBuddyAction(ownerB, prepared.id); // no effect on A's action
  assert.equal((await prisma.buddyAction.findUniqueOrThrow({ where: { id: prepared.id } })).status, "PREPARED");
  await cancelBuddyAction(ownerA, prepared.id);
  assert.equal((await prisma.buddyAction.findUniqueOrThrow({ where: { id: prepared.id } })).status, "CANCELLED");
});

test("re-checked at Apply: permission removed after the preview → denied, nothing changes", async () => {
  const manager = await as(A.managerToken);
  const prepared = await prepareBuddyAction(manager, featureReq(A.chips));
  await prisma.businessRole.update({ where: { id: A.managerRoleId }, data: { permissions: { ...STAFF_PRESETS.MANAGER.permissions, canManageServices: false } } });
  try {
    const demoted = await as(A.managerToken);
    await assert.rejects(applyBuddyAction(demoted, prepared.id), (e) => e instanceof AuthError && e.status === 403);
    assert.equal(await featured(A.chips), false);
    assert.equal((await prisma.buddyAction.findUniqueOrThrow({ where: { id: prepared.id } })).status, "DENIED");
  } finally {
    await prisma.businessRole.update({ where: { id: A.managerRoleId }, data: { permissions: STAFF_PRESETS.MANAGER.permissions as object } });
  }
});

test("re-checked at Apply: an expired preview can't be applied", async () => {
  const owner = await as(A.ownerToken);
  const prepared = await prepareBuddyAction(owner, featureReq(A.chips), new Date(Date.now() - 60 * 60 * 1000));
  await assert.rejects(applyBuddyAction(owner, prepared.id), /expired/);
  assert.equal(await featured(A.chips), false);
});

test("a double-tap applies once", async () => {
  const owner = await as(A.ownerToken);
  const prepared = await prepareBuddyAction(owner, featureReq(A.chips));
  const results = await Promise.allSettled([applyBuddyAction(owner, prepared.id), applyBuddyAction(owner, prepared.id)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await featured(A.chips), true);
});

// ---------------------------------------------------------------------------
// Chat history is per person
// ---------------------------------------------------------------------------

test("chat: each person has their own history; kitchen never sees the owner's chat", async () => {
  const owner = await as(A.ownerToken);
  const kitchen = await as(A.kitchenToken);
  await sendBuddyMessage(owner, "who are my regulars?");
  await sendBuddyMessage(kitchen, "how much money did we make?");

  const ownerHistory = await getBuddyHistory(owner);
  const kitchenHistory = await getBuddyHistory(kitchen);
  assert.ok(ownerHistory.some((m) => m.content === "who are my regulars?"));
  assert.equal(kitchenHistory.some((m) => m.content === "who are my regulars?"), false);
  assert.match(kitchenHistory.find((m) => m.role === "buddy")!.content, /Your role doesn't include orders and sales/);

  // B's owner sees none of A's.
  assert.deepEqual(await getBuddyHistory(await as(B.ownerToken)), []);
});

test("chat: a pre-per-person shared chat is shown to owners only", async () => {
  const legacy = await prisma.assistantConversation.create({ data: { businessId: B.id }, select: { id: true } });
  await prisma.assistantMessage.create({ data: { conversationId: legacy.id, role: "owner", content: "old shared question" } });
  const managerB = await as(B.managerToken);
  assert.equal((await getBuddyHistory(managerB)).some((m) => m.content === "old shared question"), false);
  assert.ok((await getBuddyHistory(await as(B.ownerToken))).some((m) => m.content === "old shared question"));
});
