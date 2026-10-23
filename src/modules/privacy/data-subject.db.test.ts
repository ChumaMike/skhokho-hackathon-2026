import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { hashPassword } from "@/modules/auth/auth.service";
import { createBusiness } from "@/modules/tenant/tenant.service";
import { registerCustomer, logVisit } from "@/modules/customers/customer.service";
import { createOrder } from "@/modules/orders/order.service";
import {
  findMembershipsByPhone,
  exportCustomerData,
  eraseCustomer,
  exportBusinessData,
  eraseBusinessData,
  DataSubjectError,
} from "./data-subject.service";

/**
 * Data-subject requests against the database: lookup by phone, export shape
 * (no global customer id, no secrets), customer erasure through the identity
 * RPC plus snapshot scrub, and whole-business de-identification that keeps
 * financial history.
 */

const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const actor = { type: "platform_admin" as const, id: "admin-test" };
const businesses: string[] = [];
let seq = 0;
const phone = () => `0831${String((Date.now() + seq++) % 1_000_000).padStart(6, "0")}`;

async function shop(label: string) {
  const { business } = await createBusiness({
    name: `DSR ${label}`,
    category: "FOOD_VENDOR",
    owner: { firstName: "Owner", lastName: label, email: `dsr-owner-${label}-${run}@example.test`, passwordHash: await hashPassword("SomePassword123") },
  });
  businesses.push(business.id);
  // The join route links the owner's sign-in account; createBusiness alone does not.
  const owner = await prisma.appUser.create({
    data: { email: `dsr-owner-${label}-${run}@example.test`, passwordHash: await hashPassword("SomePassword123"), role: "OWNER", emailVerifiedAt: new Date() },
    select: { id: true },
  });
  await prisma.business.update({ where: { id: business.id }, data: { ownerUserId: owner.id } });
  const product = await prisma.product.create({ data: { businessId: business.id, name: "Kota", price: 45, trackStock: false }, select: { id: true } });
  return { id: business.id, productId: product.id };
}

async function customerWithOrder(businessId: string, productId: string, mobile: string, name: string) {
  const reg = await registerCustomer(businessId, mobile, name, "test", undefined, undefined, `${name.toLowerCase()}-${run}@example.test`, true);
  const membership = await prisma.membership.findUniqueOrThrow({ where: { publicId: reg.public_id }, select: { id: true } });
  await logVisit(businessId, reg.public_id, "stamp");
  const order = await createOrder(businessId, {
    source: "online",
    membershipId: membership.id,
    items: [{ productId, name: "Kota", quantity: 1, unitPrice: 45, discount: 0 }],
    discount: 0,
    paymentStatus: "PENDING",
    fulfilmentMethod: "COLLECTION",
    deliveryFee: 0,
    notes: "No onions please — allergic",
    notifyEmail: `${name.toLowerCase()}-${run}@example.test`,
  });
  return { publicId: reg.public_id, membershipId: membership.id, orderId: order!.id };
}

test.after(async () => {
  for (const id of businesses) {
    // data_subject_requests is append-only (trigger) — the evidence rows stay, like the identity core's own audit rows.
    await prisma.orderItem.deleteMany({ where: { order: { businessId: id } } });
    await prisma.order.deleteMany({ where: { businessId: id } });
    await prisma.product.deleteMany({ where: { businessId: id } });
    await prisma.businessNotification.deleteMany({ where: { businessId: id } });
    await prisma.businessStaff.deleteMany({ where: { businessId: id } });
    await prisma.businessRole.deleteMany({ where: { businessId: id } });
    await prisma.businessSubscription.deleteMany({ where: { businessId: id } });
  }
  // Business rows and identity-core rows (append-only visits) stay; nothing personal is left on them after erasure.
});

test("lookup by phone lists pairwise relationships only; export carries the person's data and never the global id or a secret", async () => {
  const a = await shop("lookup-a");
  const b = await shop("lookup-b");
  const mobile = phone();
  const atA = await customerWithOrder(a.id, a.productId, mobile, "Thandi");
  await registerCustomer(b.id, mobile, "Thandi", "test");

  const found = await findMembershipsByPhone(mobile);
  assert.equal(found.memberships.length, 2);
  assert.ok(found.memberships.some((m) => m.businessId === a.id && m.publicId === atA.publicId));
  assert.equal(JSON.stringify(found).includes("customerId"), false);

  const data = await exportCustomerData(a.id, atA.publicId, actor, mobile);
  assert.ok(data);
  const text = JSON.stringify(data);
  assert.ok(data!.identifiers.some((i) => i.type === "phone"), "phone identifier included");
  assert.ok(data!.consents.some((c) => c.purpose === "loyalty_program"));
  assert.equal(data!.visits.length, 1);
  assert.equal(data!.orders.length, 1);
  assert.equal(data!.orders[0].notes, "No onions please — allergic");
  assert.equal(text.includes("customer_id") || text.includes("customerId"), false, "global id never exported");
  assert.equal(text.includes("passwordHash"), false);
  const recorded = await prisma.dataSubjectRequest.findFirst({ where: { businessId: a.id, kind: "EXPORT", subject: "CUSTOMER" } });
  assert.ok(recorded?.phoneHash && !recorded.phoneHash.includes(mobile.slice(-4)), "phone stored as a hash only");
});

test("erasing a customer at one business keeps their other relationship; erasing the last one removes their identifiers", async () => {
  const a = await shop("erase-a");
  const b = await shop("erase-b");
  const mobile = phone();
  const atA = await customerWithOrder(a.id, a.productId, mobile, "Sipho");
  const atB = await customerWithOrder(b.id, b.productId, mobile, "Sipho");

  await assert.rejects(eraseCustomer(a.id, atA.publicId, actor, "no"), DataSubjectError, "reason required");

  // Unverified phones never link customers across businesses (identity design): A and B each hold
  // their own customer row for this person, so erasing at A fully erases A's row — B is untouched.
  const first = await eraseCustomer(a.id, atA.publicId, actor, "Request by email on 21 Oct", mobile);
  assert.equal(first.customer_fully_erased, true, "A's own customer row had no other live membership");
  assert.ok(first.identifiers_removed >= 1);
  const mA = await prisma.membership.findUniqueOrThrow({ where: { publicId: atA.publicId }, select: { displayName: true, status: true } });
  assert.deepEqual(mA, { displayName: null, status: "revoked" });
  const orderA = await prisma.order.findUniqueOrThrow({ where: { id: atA.orderId }, select: { notes: true, metadata: true } });
  assert.equal(orderA.notes, null);
  assert.equal((orderA.metadata as { notifyEmail?: unknown }).notifyEmail, undefined);
  assert.equal((await findMembershipsByPhone(mobile)).memberships.length, 1, "the phone still resolves to B");
  assert.equal(await prisma.visit.count({ where: { membershipId: atA.membershipId } }), 1, "visits stay as counts");

  const second = await eraseCustomer(b.id, atB.publicId, actor, "Same request, second shop", mobile);
  assert.equal(second.customer_fully_erased, true);
  assert.ok(second.identifiers_removed >= 1);
  assert.equal((await findMembershipsByPhone(mobile)).memberships.length, 0, "the phone no longer resolves to anyone");
  assert.equal(await prisma.dataSubjectRequest.count({ where: { kind: "ERASE", subject: "CUSTOMER", membershipPublicId: { in: [atA.publicId, atB.publicId] } } }), 2);
});

test("a business is erased only once closed; erasure de-identifies everything personal and keeps payment history", async () => {
  const s = await shop("erase-biz");
  const mobile = phone();
  const c = await customerWithOrder(s.id, s.productId, mobile, "Lerato");
  await prisma.business.update({ where: { id: s.id }, data: { email: `shop-${run}@example.test`, phone: "0111234567", address: "1 Main Rd" } });

  await assert.rejects(eraseBusinessData(s.id, actor, "Owner asked to close"), /Suspend or deactivate/);
  await prisma.business.update({ where: { id: s.id }, data: { status: "SUSPENDED" } });

  const exportBefore = await exportBusinessData(s.id, actor);
  assert.ok(exportBefore && exportBefore.customers.length === 1 && exportBefore.staff.length >= 1);

  const summary = await eraseBusinessData(s.id, actor, "Owner asked to close the account on 21 Oct");
  assert.equal(summary.membershipsErased, 1);
  assert.ok(Number(summary.staffScrubbed) >= 1);
  assert.equal(summary.ownerAccountErased, true);

  const biz = await prisma.business.findUniqueOrThrow({ where: { id: s.id }, select: { status: true, email: true, phone: true, address: true, name: true, owner: { select: { email: true, isActive: true, passwordHash: true } }, staff: { select: { email: true, isActive: true, firstName: true } } } });
  assert.equal(biz.status, "DEACTIVATED");
  assert.equal(biz.email, null);
  assert.equal(biz.phone, null);
  assert.equal(biz.address, null);
  assert.match(biz.name, /^DSR erase-biz/, "the name stays so history resolves");
  assert.match(biz.owner?.email ?? "", /^erased\+/);
  assert.equal(biz.owner?.isActive, false);
  assert.equal(biz.owner?.passwordHash, null);
  for (const st of biz.staff) {
    assert.match(st.email, /^erased\+/);
    assert.equal(st.isActive, false);
    assert.equal(st.firstName, "Erased");
  }
  assert.equal((await findMembershipsByPhone(mobile)).memberships.length, 0);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: c.orderId }, select: { notes: true } })).notes, null);
  assert.equal(await prisma.dataSubjectRequest.count({ where: { businessId: s.id, kind: "ERASE", subject: "BUSINESS" } }), 1);

  // Re-running is safe.
  const again = await eraseBusinessData(s.id, actor, "Re-run after a partial failure");
  assert.equal(again.membershipsErased, 0);
});
