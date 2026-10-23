import test from "node:test";
import assert from "node:assert/strict";
import { testDb, resetTestDb } from "@/lib/testing/db";

/**
 * These assert the guarantees that live in the DATABASE rather than in
 * application code, because they are the ones that still hold when a future
 * caller forgets, or when two requests race. Everything here protects real
 * money:
 *
 *  - a LIVE connection cannot exist without a passphrase
 *  - a business cannot have two active connections for one environment
 *  - one provider account cannot be the active destination for two businesses
 *  - an order cannot have two settled payment attempts
 *
 * They are written against the constraints in
 * prisma/migrations/20260920120000_merchant_direct_payments, none of which
 * Prisma's schema language can express.
 */

async function makeBusiness(label: string) {
  return testDb.business.create({
    data: {
      name: `Payment Test ${label}`,
      slug: `payment-test-${label}-${Date.now()}`,
      category: "FOOD_VENDOR",
      status: "ACTIVE",
    },
    select: { id: true },
  });
}

function connectionData(businessId: string, over: Record<string, unknown> = {}) {
  return {
    businessId,
    provider: "PAYFAST" as const,
    environment: "SANDBOX" as const,
    merchantId: "10000100",
    merchantKeyCipher: "v1.aa.bb.cc",
    passphraseCipher: "v1.dd.ee.ff",
    keyVersion: 1,
    ...over,
  };
}

test.before(resetTestDb);
test.after(async () => {
  await resetTestDb();
  await testDb.$disconnect();
});

// --- amendment 2: LIVE requires a passphrase --------------------------------

test("a LIVE connection cannot be stored without a passphrase", async () => {
  const biz = await makeBusiness("live-no-pass");
  await assert.rejects(
    testDb.businessPaymentConnection.create({
      data: connectionData(biz.id, { environment: "LIVE", passphraseCipher: null }),
    }),
    /live_requires_passphrase/,
    "the database must refuse a live connection with no passphrase",
  );
});

test("a LIVE connection with a passphrase is accepted", async () => {
  const biz = await makeBusiness("live-with-pass");
  const created = await testDb.businessPaymentConnection.create({
    data: connectionData(biz.id, { environment: "LIVE", merchantId: "live-ok-1" }),
    select: { id: true, status: true },
  });
  // Saved credentials are never enough on their own.
  assert.equal(created.status, "PENDING_VERIFICATION");
});

test("a SANDBOX connection may omit the passphrase", async () => {
  // PayFast sandbox accounts can be used without one; only live is constrained.
  const biz = await makeBusiness("sandbox-no-pass");
  const created = await testDb.businessPaymentConnection.create({
    data: connectionData(biz.id, { passphraseCipher: null, merchantId: "sandbox-ok-1" }),
    select: { id: true },
  });
  assert.ok(created.id);
});

// --- one active connection per business/provider/environment ----------------

test("a business cannot hold two active connections for the same environment", async () => {
  const biz = await makeBusiness("two-active");
  await testDb.businessPaymentConnection.create({
    data: connectionData(biz.id, { merchantId: "dup-env-1" }),
  });
  await assert.rejects(
    testDb.businessPaymentConnection.create({
      data: connectionData(biz.id, { merchantId: "dup-env-2" }),
    }),
    // Prisma reports the indexed columns, not the index name.
    /Unique constraint failed[\s\S]*business_id/,
    "'which account is this business using' must have exactly one answer",
  );
});

test("retiring a connection frees the slot for its replacement", async () => {
  // This is rotation: retire, then insert. The old row is kept, not deleted,
  // so a notification still in flight can be validated against it.
  const biz = await makeBusiness("rotate");
  const first = await testDb.businessPaymentConnection.create({
    data: connectionData(biz.id, { merchantId: "rotate-1" }),
    select: { id: true },
  });
  await testDb.businessPaymentConnection.update({
    where: { id: first.id },
    data: { status: "SUPERSEDED", retiredAt: new Date() },
  });

  const second = await testDb.businessPaymentConnection.create({
    data: connectionData(biz.id, { merchantId: "rotate-2" }),
    select: { id: true },
  });
  assert.notEqual(second.id, first.id);

  const still = await testDb.businessPaymentConnection.findUnique({ where: { id: first.id } });
  assert.ok(still, "the superseded connection must be retained, not deleted");
  assert.equal(still?.status, "SUPERSEDED");
});

// --- one provider account cannot serve two businesses -----------------------

test("two different businesses cannot both point at the same merchant account", async () => {
  // Without this, pasting someone else's merchant ID would quietly aim their
  // customers' money at that account.
  const a = await makeBusiness("shared-a");
  const b = await makeBusiness("shared-b");
  await testDb.businessPaymentConnection.create({
    data: connectionData(a.id, { merchantId: "shared-merchant-id" }),
  });
  await assert.rejects(
    testDb.businessPaymentConnection.create({
      data: connectionData(b.id, { merchantId: "shared-merchant-id" }),
    }),
    /Unique constraint failed[\s\S]*merchant_id/,
  );
});

test("the same merchant id is allowed in a different environment", async () => {
  // Sandbox and live are genuinely separate accounts that may share an id.
  const biz = await makeBusiness("same-id-both-envs");
  await testDb.businessPaymentConnection.create({
    data: connectionData(biz.id, { merchantId: "both-envs" }),
  });
  const live = await testDb.businessPaymentConnection.create({
    data: connectionData(biz.id, { environment: "LIVE", merchantId: "both-envs" }),
    select: { id: true },
  });
  assert.ok(live.id);
});

// --- one settled attempt per order ------------------------------------------

async function makeOrderAndConnection(label: string) {
  const biz = await makeBusiness(label);
  const connection = await testDb.businessPaymentConnection.create({
    data: connectionData(biz.id, { merchantId: `att-${label}` }),
    select: { id: true },
  });
  const order = await testDb.order.create({
    data: {
      businessId: biz.id,
      orderNumber: `ORD-${label}`,
      subtotal: "100.00",
      total: "100.00",
    },
    select: { id: true },
  });
  return { biz, connection, order };
}

function attemptData(ctx: { biz: { id: string }; connection: { id: string }; order: { id: string } }, over: Record<string, unknown> = {}) {
  return {
    reference: `ref-${Math.random().toString(36).slice(2)}`,
    orderId: ctx.order.id,
    businessId: ctx.biz.id,
    connectionId: ctx.connection.id,
    provider: "PAYFAST" as const,
    environment: "SANDBOX" as const,
    merchantIdSnapshot: "10000100",
    expectedAmount: "100.00",
    ...over,
  };
}

test("an order may have many attempts, but only one may settle", async () => {
  // The retry case: a customer abandons, comes back, pays. Several attempts,
  // one settlement.
  const ctx = await makeOrderAndConnection("many-attempts");

  await testDb.businessPaymentAttempt.create({ data: attemptData(ctx, { status: "CANCELLED" }) });
  await testDb.businessPaymentAttempt.create({ data: attemptData(ctx, { status: "FAILED" }) });
  await testDb.businessPaymentAttempt.create({
    data: attemptData(ctx, { status: "COMPLETE", providerPaymentId: "pf-settle-1" }),
  });

  await assert.rejects(
    testDb.businessPaymentAttempt.create({
      data: attemptData(ctx, { status: "COMPLETE", providerPaymentId: "pf-settle-2" }),
    }),
    /Unique constraint failed[\s\S]*order_id/,
    "a second settlement on one order must be impossible at the database level",
  );

  const all = await testDb.businessPaymentAttempt.count({ where: { orderId: ctx.order.id } });
  assert.equal(all, 3, "the failed and cancelled attempts are retained as history");
});

test("a replayed provider payment id cannot create a second attempt", async () => {
  const ctx = await makeOrderAndConnection("replay");
  await testDb.businessPaymentAttempt.create({
    data: attemptData(ctx, { status: "SUBMITTED", providerPaymentId: "pf-replay-1" }),
  });
  await assert.rejects(
    testDb.businessPaymentAttempt.create({
      data: attemptData(ctx, { status: "SUBMITTED", providerPaymentId: "pf-replay-1" }),
    }),
    /provider_payment_id/,
  );
});

test("unsubmitted attempts do not collide on a null provider payment id", async () => {
  // Postgres treats NULLs as distinct in a unique index — relied upon, so pin it.
  const ctx = await makeOrderAndConnection("null-refs");
  await testDb.businessPaymentAttempt.create({ data: attemptData(ctx) });
  const second = await testDb.businessPaymentAttempt.create({ data: attemptData(ctx), select: { id: true } });
  assert.ok(second.id);
});

// --- amendment 7: history survives ------------------------------------------

test("a business with payment history cannot be deleted out from under it", async () => {
  const ctx = await makeOrderAndConnection("no-cascade");
  await testDb.businessPaymentAttempt.create({ data: attemptData(ctx, { status: "COMPLETE", providerPaymentId: "pf-keep-1" }) });

  await assert.rejects(
    testDb.business.delete({ where: { id: ctx.biz.id } }),
    /Foreign key|constraint|violat/i,
    "deleting a business must not be able to destroy evidence that money moved",
  );

  const survives = await testDb.businessPaymentAttempt.count({ where: { businessId: ctx.biz.id } });
  assert.equal(survives, 1);
});

test("a connection in use cannot be deleted, so an in-flight notification stays verifiable", async () => {
  const ctx = await makeOrderAndConnection("conn-in-use");
  await testDb.businessPaymentAttempt.create({ data: attemptData(ctx, { status: "SUBMITTED" }) });
  await assert.rejects(
    testDb.businessPaymentConnection.delete({ where: { id: ctx.connection.id } }),
    /Foreign key|constraint|violat/i,
  );
});
