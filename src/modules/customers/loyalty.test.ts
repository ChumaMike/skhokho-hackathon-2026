import test from "node:test";
import assert from "node:assert/strict";
import { testDb, resetTestDb } from "@/lib/testing/db";

/**
 * Calls the log_visit / register_customer RPCs directly via testDb,
 * mirroring exactly what customer.service.ts does against the app's own
 * prisma client — these tests exercise the real Postgres functions
 * (idempotency, the advisory lock), not a mock of them.
 */

interface RegisterResult {
  public_id: string;
  short_code: string;
  display_name: string | null;
  created: boolean;
}

interface VisitCounts {
  public_id: string;
  stamps: number;
  redeems: number;
  required?: number;
}

async function makeBusiness(slug: string, loyaltyStampsRequired = 3) {
  return testDb.business.create({
    data: { name: `Test Business ${slug}`, slug, config: { loyalty_stamps_required: loyaltyStampsRequired } },
  });
}

async function registerMember(businessId: string, phone: string): Promise<RegisterResult> {
  const rows = await testDb.$queryRaw<{ result: RegisterResult }[]>`
    SELECT register_customer(${businessId}::uuid, ${phone}, NULL, 'test', NULL, NULL) AS result`;
  return rows[0].result;
}

async function logVisit(
  businessId: string,
  publicId: string,
  idempotencyKey?: string,
): Promise<VisitCounts> {
  const rows = await testDb.$queryRaw<{ result: VisitCounts }[]>`
    SELECT log_visit(${businessId}::uuid, ${publicId}::uuid, 'stamp', NULL, ${idempotencyKey ?? null}) AS result`;
  return rows[0].result;
}

async function redeemReward(
  businessId: string,
  publicId: string,
  idempotencyKey?: string,
): Promise<VisitCounts> {
  const rows = await testDb.$queryRaw<{ result: VisitCounts }[]>`
    SELECT redeem_reward(${businessId}::uuid, ${publicId}::uuid, NULL, ${idempotencyKey ?? null}) AS result`;
  return rows[0].result;
}

test.before(resetTestDb);
test.after(async () => {
  await resetTestDb();
  await testDb.$disconnect();
});

test("log_visit: the same idempotency key submitted twice produces exactly one Visit row", async () => {
  const business = await makeBusiness("loyalty-idem-1");
  const member = await registerMember(business.id, "+27821000001");
  const key = "test-key-double-tap-1";

  const first = await logVisit(business.id, member.public_id, key);
  const second = await logVisit(business.id, member.public_id, key);

  assert.equal(first.stamps, 1);
  assert.equal(second.stamps, 1, "second call with the same key must not add a second stamp");

  const count = await testDb.visit.count({ where: { businessId: business.id, idempotencyKey: key } });
  assert.equal(count, 1, "exactly one Visit row must exist for this idempotency key");
});

test("log_visit: two DIFFERENT keys (or two omitted keys) both count as real, separate stamps", async () => {
  const business = await makeBusiness("loyalty-idem-2");
  const member = await registerMember(business.id, "+27821000002");

  const first = await logVisit(business.id, member.public_id, "key-a");
  const second = await logVisit(business.id, member.public_id, "key-b");

  assert.equal(first.stamps, 1);
  assert.equal(second.stamps, 2, "a genuinely different key must count as a new stamp, not a replay");
});

test("redeem_reward: concurrent calls for the same membership — exactly one succeeds", async () => {
  const business = await makeBusiness("loyalty-concurrent-redeem", 3);
  const member = await registerMember(business.id, "+27821000003");

  // Exactly enough stamps for ONE redemption, no more.
  await logVisit(business.id, member.public_id, "stamp-1");
  await logVisit(business.id, member.public_id, "stamp-2");
  await logVisit(business.id, member.public_id, "stamp-3");

  const results = await Promise.allSettled([
    redeemReward(business.id, member.public_id),
    redeemReward(business.id, member.public_id),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");

  assert.equal(fulfilled.length, 1, "exactly one of the two concurrent redeems must succeed");
  assert.equal(rejected.length, 1, "the other must fail (not enough stamps left)");

  const rejection = rejected[0] as PromiseRejectedResult;
  assert.match(String(rejection.reason), /not_enough_stamps/);

  const redeemCount = await testDb.visit.count({
    where: { membershipId: (await testDb.membership.findFirstOrThrow({ where: { publicId: member.public_id } })).id, kind: "redeem" },
  });
  assert.equal(redeemCount, 1, "exactly one redeem row must exist, not two");
});

test("redeem_reward: the same idempotency key submitted twice does not double-redeem", async () => {
  const business = await makeBusiness("loyalty-idem-redeem", 3);
  const member = await registerMember(business.id, "+27821000004");
  await logVisit(business.id, member.public_id, "s1");
  await logVisit(business.id, member.public_id, "s2");
  await logVisit(business.id, member.public_id, "s3");

  const key = "redeem-replay-key";
  const first = await redeemReward(business.id, member.public_id, key);
  const second = await redeemReward(business.id, member.public_id, key);

  assert.equal(first.redeems, 1);
  assert.equal(second.redeems, 1, "replaying the same redeem request must not redeem twice");
});
