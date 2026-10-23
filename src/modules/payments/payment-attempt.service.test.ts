import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import {
  createAttempt,
  markAttemptSubmitted,
  resolveAttemptByReference,
  settleAttempt,
  closeAttempt,
  REFUND_REASONS,
  ATTEMPT_TTL_MS,
  expireStaleAttemptsForOrder,
  closeOpenAttemptsForOrder,
} from "./payment-attempt.service";
import {
  saveConnection,
  getConnection,
  markConnectionVerified,
  loadCredentials,
} from "./payment-connection.service";

/**
 * The retry, replay and rotation cases — the ones where money is either taken
 * twice, attributed to the wrong attempt, or lost because a credential
 * changed while a customer was mid-payment.
 */

const SUFFIX = Date.now();
let bizA = "";
let bizB = "";
/** Created inside the rotation test, cleaned up with the rest. */
let rotationBusiness = "";

async function makeBusiness(label: string): Promise<string> {
  const b = await prisma.business.create({
    data: {
      name: `Attempt Test ${label}`,
      slug: `attempt-test-${label}-${SUFFIX}`,
      category: "FOOD_VENDOR",
      status: "ACTIVE",
    },
    select: { id: true },
  });
  return b.id;
}

async function makeOrder(businessId: string, label: string, total = "100.00") {
  return prisma.order.create({
    data: { businessId, orderNumber: `ORD-${label}-${SUFFIX}`, subtotal: total, total },
    select: { id: true },
  });
}

/** A business with a verified live account, ready to receive. */
async function connectAndVerify(businessId: string, merchantId: string) {
  await saveConnection(businessId, {
    environment: "LIVE",
    merchantId,
    merchantKey: "46f0cd694581a",
    passphrase: "test-passphrase",
  });
  const view = await getConnection(businessId, "LIVE");
  await markConnectionVerified(view!.id, "bootstrap");
  return view!.id;
}

test.before(async () => {
  bizA = await makeBusiness("a");
  bizB = await makeBusiness("b");
  await connectAndVerify(bizA, `4000${SUFFIX}`.slice(0, 12));
  await connectAndVerify(bizB, `5000${SUFFIX}`.slice(0, 12));
});

test.after(async () => {
  for (const id of [bizA, bizB, rotationBusiness].filter(Boolean)) {
    await prisma.businessPaymentAttempt.deleteMany({ where: { businessId: id } });
    await prisma.order.deleteMany({ where: { businessId: id } });
    await prisma.businessPaymentConnection.deleteMany({ where: { businessId: id } });
    await prisma.business.deleteMany({ where: { id } });
  }
});

// --- creation ---------------------------------------------------------------


/** Settle with a matching amount and return just the outcome — the common case. */
async function settle(attemptId: string, providerPaymentId: string) {
  return (await settleAttempt(attemptId, providerPaymentId, { amountMatches: true })).outcome;
}

test("each attempt gets its own reference, so one order can be retried unambiguously", async () => {
  const order = await makeOrder(bizA, "retry");
  const first = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });
  const second = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });

  assert.notEqual(first.reference, second.reference);
  assert.match(first.reference, /^skh_[0-9a-f]{32}$/);
});

test("an attempt snapshots the merchant it was actually submitted to", async () => {
  const order = await makeOrder(bizA, "snapshot");
  const attempt = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });
  const resolved = await resolveAttemptByReference(attempt.reference);
  assert.equal(resolved!.merchantIdSnapshot, attempt.credentials.merchantId);
});

test("an unverified connection cannot take a customer's money", async () => {
  // Saving credentials is not proof; the attempt layer refuses too, behind
  // resolveCheckoutPayment.
  const biz = await makeBusiness("unverified");
  await saveConnection(biz, {
    environment: "LIVE",
    merchantId: `6000${SUFFIX}`.slice(0, 12),
    merchantKey: "46f0cd694581a",
    passphrase: "test-passphrase",
  });
  const order = await makeOrder(biz, "unverified");
  await assert.rejects(
    createAttempt(biz, "LIVE", { orderId: order.id, amount: 50 }),
    /not been verified/,
  );
  await prisma.order.deleteMany({ where: { businessId: biz } });
  await prisma.businessPaymentConnection.deleteMany({ where: { businessId: biz } });
  await prisma.business.deleteMany({ where: { id: biz } });
});

// --- settlement -------------------------------------------------------------

test("settling marks the attempt and the order together, and records the provider reference", async () => {
  const order = await makeOrder(bizA, "settle");
  const attempt = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });
  await markAttemptSubmitted(attempt.id);

  assert.equal(await settle(attempt.id, "pf-settle-001"), "settled");

  const after = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    select: { paymentStatus: true, paidAt: true, paymentRef: true },
  });
  assert.equal(after.paymentStatus, "PAID");
  assert.ok(after.paidAt);
  // The column existed for a year and was never written — without it there is
  // no queryable link from a provider payment back to an order.
  assert.equal(after.paymentRef, "pf-settle-001");
});

test("a replayed notification settles nothing a second time", async () => {
  const order = await makeOrder(bizA, "replay");
  const attempt = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });
  assert.equal(await settle(attempt.id, "pf-replay-001"), "settled");
  assert.equal(
    await settle(attempt.id, "pf-replay-001"),
    "already-settled",
    "a gateway retry is a success, not a second settlement",
  );
});

test("two simultaneous notifications cannot both settle the same attempt", async () => {
  // The race the old read-then-write allowed: both read PENDING, both act.
  const order = await makeOrder(bizA, "concurrent");
  const attempt = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });

  const results = await Promise.all([
    settle(attempt.id, "pf-concurrent-001"),
    settle(attempt.id, "pf-concurrent-001"),
  ]);

  assert.equal(results.filter((r) => r === "settled").length, 1, "exactly one may settle");
  assert.equal(results.filter((r) => r === "already-settled").length, 1);
});

test("an order with several attempts is paid exactly once", async () => {
  const order = await makeOrder(bizA, "many");
  const abandoned = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });
  const cancelled = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });
  const successful = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });

  await closeAttempt(abandoned.id, "EXPIRED");
  await closeAttempt(cancelled.id, "CANCELLED", "customer went back");
  assert.equal(await settle(successful.id, "pf-many-001"), "settled");

  const paid = await prisma.order.findUniqueOrThrow({
    where: { id: order.id },
    select: { paymentStatus: true, paymentRef: true },
  });
  assert.equal(paid.paymentStatus, "PAID");
  assert.equal(paid.paymentRef, "pf-many-001");

  const kept = await prisma.businessPaymentAttempt.count({ where: { orderId: order.id } });
  assert.equal(kept, 3, "the abandoned and cancelled attempts are retained as history");
});

test("a late real payment on an abandoned attempt is kept as refund-due, never a second PAID", async () => {
  // Exactly why the reference is per-attempt. With one reference per order,
  // this notification would have been indistinguishable from the real one.
  // And because it is a VERIFIED payment, the money really moved: it must be
  // recorded for a refund, not ignored because we'd given up on that attempt.
  const order = await makeOrder(bizA, "late");
  const abandoned = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });
  const real = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });

  assert.equal(await settle(real.id, "pf-late-real"), "settled");
  await closeAttempt(abandoned.id, "EXPIRED");

  const late = await settleAttempt(abandoned.id, "pf-late-abandoned", { amountMatches: true });
  assert.deepEqual(late, { outcome: "refund-due", reason: REFUND_REASONS.alreadyPaid });

  const row = await prisma.businessPaymentAttempt.findUniqueOrThrow({
    where: { id: abandoned.id },
    select: { status: true, providerPaymentId: true },
  });
  assert.equal(row.status, "REFUND_DUE");
  assert.equal(row.providerPaymentId, "pf-late-abandoned", "the second charge is traceable");

  const stillOne = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { paymentRef: true } });
  assert.equal(stillOne.paymentRef, "pf-late-real", "the real payment's reference stands");
});

test("a late payment on an expired attempt still pays an order that is still waiting", async () => {
  const order = await makeOrder(bizA, "late-only");
  const attempt = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });
  await closeAttempt(attempt.id, "EXPIRED");

  assert.equal(await settle(attempt.id, "pf-late-only"), "settled");
  const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { paymentStatus: true } });
  assert.equal(paid.paymentStatus, "PAID");
});

test("an amount mismatch is never applied to the order — it is refund-due", async () => {
  const order = await makeOrder(bizA, "amount");
  const attempt = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });
  const result = await settleAttempt(attempt.id, "pf-amount-001", { amountMatches: false });
  assert.deepEqual(result, { outcome: "refund-due", reason: REFUND_REASONS.amount });
  const unpaid = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { paymentStatus: true } });
  assert.equal(unpaid.paymentStatus, "PENDING");
});

test("a payment for a cancelled order is refund-due and never revives the order", async () => {
  const order = await makeOrder(bizA, "cancelled");
  const attempt = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });
  await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });

  const result = await settleAttempt(attempt.id, "pf-cancelled-001", { amountMatches: true });
  assert.deepEqual(result, { outcome: "refund-due", reason: REFUND_REASONS.cancelled });
  const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, paymentStatus: true } });
  assert.equal(after.status, "CANCELLED");
  assert.equal(after.paymentStatus, "PENDING");
});

test("two different attempts paying one order at once: exactly one applies, the other is refund-due", async () => {
  const order = await makeOrder(bizA, "race-two");
  const first = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });
  const second = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });

  const outcomes = (await Promise.all([
    settle(first.id, "pf-race-two-1"),
    settle(second.id, "pf-race-two-2"),
  ])).sort();
  assert.deepEqual(outcomes, ["refund-due", "settled"]);
  assert.equal(await prisma.businessPaymentAttempt.count({ where: { orderId: order.id, status: "COMPLETE" } }), 1);
  assert.equal(await prisma.businessPaymentAttempt.count({ where: { orderId: order.id, status: "REFUND_DUE" } }), 1);
});

test("expireStaleAttemptsForOrder expires only old open attempts, and counts what's still open", async () => {
  const order = await makeOrder(bizA, "expire");
  const old = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });
  await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });
  await prisma.businessPaymentAttempt.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - ATTEMPT_TTL_MS - 60_000) } });

  assert.equal(await expireStaleAttemptsForOrder(bizA, order.id), 1);
  const oldRow = await prisma.businessPaymentAttempt.findUniqueOrThrow({ where: { id: old.id }, select: { status: true } });
  assert.equal(oldRow.status, "EXPIRED");
});

test("expiry and closing are scoped to the business: B's attempts are untouched", async () => {
  const orderB = await makeOrder(bizB, "scope-b");
  const attemptB = await createAttempt(bizB, "LIVE", { orderId: orderB.id, amount: 100 });
  await prisma.businessPaymentAttempt.update({ where: { id: attemptB.id }, data: { createdAt: new Date(Date.now() - ATTEMPT_TTL_MS - 60_000) } });

  // A passes B's order id — nothing happens to B's attempt.
  await expireStaleAttemptsForOrder(bizA, orderB.id);
  await prisma.$transaction((tx) => closeOpenAttemptsForOrder(tx, bizA, orderB.id, "not yours"));
  const row = await prisma.businessPaymentAttempt.findUniqueOrThrow({ where: { id: attemptB.id }, select: { status: true } });
  assert.equal(row.status, "CREATED");
});

test("closing never reopens or overwrites a settled attempt", async () => {
  const order = await makeOrder(bizA, "noreopen");
  const attempt = await createAttempt(bizA, "LIVE", { orderId: order.id, amount: 100 });
  await settle(attempt.id, "pf-noreopen-001");

  await closeAttempt(attempt.id, "FAILED", "should be ignored");

  const row = await prisma.businessPaymentAttempt.findUniqueOrThrow({
    where: { id: attempt.id },
    select: { status: true, providerPaymentId: true },
  });
  assert.equal(row.status, "COMPLETE");
  assert.equal(row.providerPaymentId, "pf-noreopen-001");
});

// --- rotation mid-flight ----------------------------------------------------

test("a payment in flight survives the merchant rotating their credentials", async () => {
  // The customer has already been sent to PayFast under the old key. If
  // rotation invalidated the in-flight attempt, that payment would be
  // unverifiable — money gone from the customer, order never marked paid.
  //
  // Its own business, because rotating supersedes the connection and would
  // otherwise leave the shared fixtures unverified for every later test.
  const bizR = await makeBusiness("rotate");
  await connectAndVerify(bizR, `8000${SUFFIX}`.slice(0, 12));
  rotationBusiness = bizR;

  const order = await makeOrder(bizR, "rotate");
  const attempt = await createAttempt(bizR, "LIVE", { orderId: order.id, amount: 100 });
  await markAttemptSubmitted(attempt.id);
  const originalKey = attempt.credentials.merchantKey;

  await saveConnection(bizR, {
    environment: "LIVE",
    merchantId: `7000${SUFFIX}`.slice(0, 12),
    merchantKey: "brandnewkey99",
    passphrase: "a-new-passphrase",
  });

  const resolved = await resolveAttemptByReference(attempt.reference);
  const credsForVerification = await loadCredentials(resolved!.connectionId);

  assert.equal(
    credsForVerification.merchantKey,
    originalKey,
    "verification must use the credentials the payment was submitted under",
  );
  assert.equal(await settle(attempt.id, "pf-rotate-001"), "settled");
});

// --- tenant isolation -------------------------------------------------------

test("an attempt belongs to exactly one business, and names it", async () => {
  const orderA = await makeOrder(bizA, "iso-a");
  const attemptA = await createAttempt(bizA, "LIVE", { orderId: orderA.id, amount: 100 });

  const resolved = await resolveAttemptByReference(attemptA.reference);
  assert.equal(resolved!.businessId, bizA);
  assert.notEqual(resolved!.businessId, bizB);
});

test("two businesses' attempts never share a connection or a merchant", async () => {
  const orderA = await makeOrder(bizA, "iso-conn-a");
  const orderB = await makeOrder(bizB, "iso-conn-b");
  const a = await createAttempt(bizA, "LIVE", { orderId: orderA.id, amount: 100 });
  const b = await createAttempt(bizB, "LIVE", { orderId: orderB.id, amount: 100 });

  const ra = await resolveAttemptByReference(a.reference);
  const rb = await resolveAttemptByReference(b.reference);

  assert.notEqual(ra!.connectionId, rb!.connectionId);
  assert.notEqual(ra!.merchantIdSnapshot, rb!.merchantIdSnapshot);
  assert.notEqual(a.credentials.merchantId, b.credentials.merchantId);
});

test("settling one business's attempt leaves the other's order untouched", async () => {
  const orderA = await makeOrder(bizA, "cross-a");
  const orderB = await makeOrder(bizB, "cross-b");
  const a = await createAttempt(bizA, "LIVE", { orderId: orderA.id, amount: 100 });

  await settle(a.id, "pf-cross-001");

  const untouched = await prisma.order.findUniqueOrThrow({
    where: { id: orderB.id },
    select: { paymentStatus: true, paymentRef: true },
  });
  assert.equal(untouched.paymentStatus, "PENDING");
  assert.equal(untouched.paymentRef, null);
});
