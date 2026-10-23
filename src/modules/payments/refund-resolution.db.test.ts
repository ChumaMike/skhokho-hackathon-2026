import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { saveConnection, getConnection, markConnectionVerified } from "./payment-connection.service";
import { createAttempt, settleAttempt, REFUND_REASONS } from "./payment-attempt.service";
import { countOpenRefunds, listOpenRefunds, markRefundResolved, RefundResolutionError } from "./refund-resolution.service";

/**
 * Closing REFUND_DUE rows: a resolution needs a reason, is recorded once,
 * never touches the attempt itself, and is scoped to the attempt's business.
 */

const SUFFIX = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
let bizA = "";
let bizB = "";

async function makeBusiness(label: string) {
  const b = await prisma.business.create({
    data: { name: `Refund Test ${label}`, slug: `refund-test-${label}-${SUFFIX}`, category: "FOOD_VENDOR", status: "ACTIVE" },
    select: { id: true },
  });
  const merchantId = `${label === "a" ? "61" : "62"}${Date.now()}`.slice(0, 12);
  await saveConnection(b.id, { environment: "LIVE", merchantId, merchantKey: "46f0cd694581a", passphrase: "test-passphrase" });
  const view = await getConnection(b.id, "LIVE");
  await markConnectionVerified(view!.id, "bootstrap");
  return b.id;
}

/** A verified payment that could not be applied: the amount differs. */
async function refundDueAttempt(businessId: string, label: string) {
  const order = await prisma.order.create({
    data: { businessId, orderNumber: `ORD-${label}-${SUFFIX}`, subtotal: "100.00", total: "100.00" },
    select: { id: true },
  });
  const attempt = await createAttempt(businessId, "LIVE", { orderId: order.id, amount: 100 });
  const result = await settleAttempt(attempt.id, `pf-${label}-${SUFFIX}`, { amountMatches: false });
  assert.equal(result.outcome, "refund-due");
  if (result.outcome === "refund-due") assert.equal(result.reason, REFUND_REASONS.amount);
  return attempt.id;
}

test.before(async () => {
  bizA = await makeBusiness("a");
  bizB = await makeBusiness("b");
});

test.after(async () => {
  for (const id of [bizA, bizB].filter(Boolean)) {
    await prisma.paymentRefundResolution.deleteMany({ where: { businessId: id } });
    await prisma.businessPaymentAttempt.deleteMany({ where: { businessId: id } });
    await prisma.order.deleteMany({ where: { businessId: id } });
    await prisma.businessPaymentConnection.deleteMany({ where: { businessId: id } });
    await prisma.business.deleteMany({ where: { id } });
  }
});

test("a refund-due attempt is listed as owed until the merchant marks it done, with a reason, once", async () => {
  const attemptId = await refundDueAttempt(bizA, "owed");
  const open = await listOpenRefunds(bizA);
  assert.ok(open.some((r) => r.attemptId === attemptId && r.reason === REFUND_REASONS.amount && r.expectedAmount === "100.00"));
  assert.equal(await countOpenRefunds(bizA), open.length);

  await assert.rejects(markRefundResolved(bizA, attemptId, { reason: "ok", actor: { type: "staff", id: "owner-1" } }), RefundResolutionError);

  const done = await markRefundResolved(bizA, attemptId, {
    reason: "Refunded in PayFast on the original transaction.",
    providerRefundRef: " RF-123 ",
    actor: { type: "staff", id: "owner-1" },
  });
  assert.equal(done.attemptId, attemptId);
  assert.equal((await listOpenRefunds(bizA)).some((r) => r.attemptId === attemptId), false);

  // The attempt itself is untouched: still REFUND_DUE, still the same provider id.
  const attempt = await prisma.businessPaymentAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { refundResolution: true } });
  assert.equal(attempt.status, "REFUND_DUE");
  assert.equal(attempt.providerPaymentId, `pf-owed-${SUFFIX}`);
  assert.equal(attempt.refundResolution?.providerRefundRef, "RF-123");
  assert.equal(attempt.refundResolution?.resolvedByType, "staff");

  await assert.rejects(
    markRefundResolved(bizA, attemptId, { reason: "Doing it again by mistake", actor: { type: "staff", id: "owner-1" } }),
    /already marked/,
  );
});

test("business B cannot resolve business A's refund; a settled payment cannot be 'resolved' at all", async () => {
  const attemptId = await refundDueAttempt(bizA, "scope");
  await assert.rejects(markRefundResolved(bizB, attemptId, { reason: "Not my money to settle", actor: { type: "staff", id: "b-owner" } }), /not found/);
  assert.equal((await listOpenRefunds(bizA)).some((r) => r.attemptId === attemptId), true);

  const order = await prisma.order.create({ data: { businessId: bizA, orderNumber: `ORD-paid-${SUFFIX}`, subtotal: "50.00", total: "50.00" }, select: { id: true } });
  const paid = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 50 });
  assert.equal((await settleAttempt(paid.id, `pf-paid-${SUFFIX}`, { amountMatches: true })).outcome, "settled");
  await assert.rejects(markRefundResolved(bizA, paid.id, { reason: "There is nothing to refund here", actor: { type: "platform_admin", id: "admin-1" } }), /not waiting/);
});
