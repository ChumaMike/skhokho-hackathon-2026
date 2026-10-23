import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import {
  saveConnection,
  getConnection,
  listConnections,
  getReceivingConnection,
  setConnectionEnabled,
  disconnect,
  markConnectionVerified,
  loadCredentials,
  SaveConnectionSchema,
} from "./payment-connection.service";

/**
 * Runs against the development database through the app's Prisma singleton,
 * because the service layer hardcodes it and isn't injectable — the same
 * compromise (and the same cleanup discipline) as tenant-isolation.test.ts.
 *
 * Two businesses throughout, because most of what matters here is that one
 * merchant can never reach another's receiving account.
 */

const SUFFIX = Date.now();
let bizA = "";
let bizB = "";

async function makeBusiness(label: string): Promise<string> {
  const b = await prisma.business.create({
    data: {
      name: `Conn Test ${label}`,
      slug: `conn-test-${label}-${SUFFIX}`,
      category: "FOOD_VENDOR",
      status: "ACTIVE",
    },
    select: { id: true },
  });
  return b.id;
}

const LIVE_INPUT = {
  environment: "LIVE" as const,
  merchantId: "10000100",
  merchantKey: "46f0cd694581a",
  passphrase: "a-real-passphrase",
};

test.before(async () => {
  bizA = await makeBusiness("a");
  bizB = await makeBusiness("b");
});

test.after(async () => {
  for (const id of [bizA, bizB]) {
    await prisma.businessPaymentAttempt.deleteMany({ where: { businessId: id } });
    await prisma.businessPaymentConnection.deleteMany({ where: { businessId: id } });
    await prisma.business.deleteMany({ where: { id } });
  }
});

// --- validation -------------------------------------------------------------

test("a live connection without a passphrase is refused before it reaches the database", async () => {
  const parsed = SaveConnectionSchema.safeParse({ ...LIVE_INPUT, passphrase: undefined });
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues[0]?.message ?? "", /passphrase is required/i);
});

test("whitespace copied in from the PayFast dashboard is trimmed, not rejected", async () => {
  // A trailing space produces a signature mismatch that reads as a code fault
  // rather than as a typo, so it is stripped rather than surfaced.
  const parsed = SaveConnectionSchema.safeParse({
    ...LIVE_INPUT,
    merchantId: "  10000100 ",
    merchantKey: " 46f0cd694581a  ",
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.data?.merchantId, "10000100");
  assert.equal(parsed.data?.merchantKey, "46f0cd694581a");
});

test("a malformed merchant id is rejected with something an owner can act on", async () => {
  const parsed = SaveConnectionSchema.safeParse({ ...LIVE_INPUT, merchantId: "not-a-number" });
  assert.equal(parsed.success, false);
  assert.match(parsed.error?.issues[0]?.message ?? "", /PayFast account/i);
});

// --- storage ----------------------------------------------------------------

test("credentials are encrypted at rest, and the plaintext appears nowhere", async () => {
  await saveConnection(bizA, { ...LIVE_INPUT, merchantId: `1000${SUFFIX}`.slice(0, 12) });

  const raw = await prisma.businessPaymentConnection.findFirstOrThrow({
    where: { businessId: bizA, environment: "LIVE", retiredAt: null },
    select: { merchantKeyCipher: true, passphraseCipher: true, keyVersion: true, status: true },
  });

  assert.ok(!raw.merchantKeyCipher.includes(LIVE_INPUT.merchantKey), "merchant key must not be readable");
  assert.ok(!raw.passphraseCipher?.includes(LIVE_INPUT.passphrase), "passphrase must not be readable");
  assert.ok(raw.merchantKeyCipher.startsWith("v"), "stored value should be a versioned sealed payload");
  assert.equal(raw.keyVersion, 1);
  // Saving is not proof of anything.
  assert.equal(raw.status, "PENDING_VERIFICATION");
});

test("the view model exposes no secret, and masks the merchant id", async () => {
  const view = await getConnection(bizA, "LIVE");
  assert.ok(view);
  const serialised = JSON.stringify(view);
  assert.ok(!serialised.includes(LIVE_INPUT.merchantKey), "view must not carry the merchant key");
  assert.ok(!serialised.includes(LIVE_INPUT.passphrase), "view must not carry the passphrase");
  assert.match(view!.merchantIdMasked, /^•+\d{4}$/);
  assert.equal(view!.hasPassphrase, true, "whether one exists is shown; what it is, never");
});

test("credentials can be decrypted back for a signing call", async () => {
  const view = await getConnection(bizA, "LIVE");
  const creds = await loadCredentials(view!.id);
  assert.equal(creds.merchantKey, LIVE_INPUT.merchantKey);
  assert.equal(creds.passphrase, LIVE_INPUT.passphrase);
  assert.equal(creds.environment, "LIVE");
});

// --- rotation ---------------------------------------------------------------

test("rotating retires the old connection instead of overwriting it", async () => {
  // The in-flight case: a payment already submitted under the old credentials
  // must still be verifiable, so the row it used cannot be mutated away.
  const before = await getConnection(bizA, "LIVE");
  await saveConnection(bizA, { ...LIVE_INPUT, merchantKey: "rotatedkey123", merchantId: `2000${SUFFIX}`.slice(0, 12) });
  const after = await getConnection(bizA, "LIVE");

  assert.notEqual(after!.id, before!.id, "a new row, not an edit");

  const old = await prisma.businessPaymentConnection.findUniqueOrThrow({
    where: { id: before!.id },
    select: { status: true, retiredAt: true },
  });
  assert.equal(old.status, "SUPERSEDED");
  assert.ok(old.retiredAt, "retired, and kept");

  // And the superseded row's credentials still decrypt — this is the whole point.
  const oldCreds = await loadCredentials(before!.id);
  assert.equal(oldCreds.merchantKey, LIVE_INPUT.merchantKey);

  const active = await listConnections(bizA);
  assert.equal(active.filter((c) => c.environment === "LIVE").length, 1, "only one live connection is active");
});

// --- lifecycle --------------------------------------------------------------

test("only a verified live connection is offered as the receiving account", async () => {
  const pending = await getReceivingConnection(bizA);
  assert.equal(pending?.status, "PENDING_VERIFICATION", "saved but unproven");

  const view = await getConnection(bizA, "LIVE");
  await markConnectionVerified(view!.id, "attempt-under-test");

  const verified = await getReceivingConnection(bizA);
  assert.equal(verified?.status, "VERIFIED");
  assert.equal(verified?.environment, "LIVE");
});

test("disabling and re-enabling does not lose a verification", async () => {
  await setConnectionEnabled(bizA, "LIVE", false);
  assert.equal((await getConnection(bizA, "LIVE"))!.status, "DISABLED");

  await setConnectionEnabled(bizA, "LIVE", true);
  assert.equal(
    (await getConnection(bizA, "LIVE"))!.status,
    "VERIFIED",
    "it had already proven itself; turning it off is not a reset",
  );
});

test("a sandbox connection is never offered as the receiving account", async () => {
  await saveConnection(bizB, {
    environment: "SANDBOX",
    merchantId: "10000100",
    merchantKey: "46f0cd694581a",
  });
  const sandbox = await getConnection(bizB, "SANDBOX");
  await markConnectionVerified(sandbox!.id, "sandbox-attempt");

  // Verified — but sandbox, so it cannot take a real customer's money.
  assert.equal(await getReceivingConnection(bizB), null);
});

test("disconnecting retires the row rather than deleting the payment record", async () => {
  await disconnect(bizB, "SANDBOX");
  assert.equal(await getConnection(bizB, "SANDBOX"), null, "no longer active");

  const retained = await prisma.businessPaymentConnection.count({
    where: { businessId: bizB, environment: "SANDBOX" },
  });
  assert.equal(retained, 1, "the row survives — it is the receiving identity for past payments");
});

// --- tenant isolation -------------------------------------------------------

test("one business's connection is invisible to another", async () => {
  await saveConnection(bizB, { ...LIVE_INPUT, merchantId: `3000${SUFFIX}`.slice(0, 12) });

  const aSees = await listConnections(bizA);
  const bSees = await listConnections(bizB);
  const aIds = new Set(aSees.map((c) => c.id));
  for (const c of bSees) {
    assert.ok(!aIds.has(c.id), "A must not see B's connection");
  }
});

test("changing one business's connection cannot touch another's", async () => {
  const bBefore = await getConnection(bizB, "LIVE");

  await disconnect(bizA, "LIVE");
  await setConnectionEnabled(bizB, "LIVE", true); // acting on B explicitly

  const bAfter = await getConnection(bizB, "LIVE");
  assert.equal(bAfter!.id, bBefore!.id, "B's connection is the same row");
  assert.notEqual(bAfter!.status, "SUPERSEDED", "A's disconnect must not have retired B's");
});

test("a business cannot disconnect an account it does not own", async () => {
  // disconnect is scoped by businessId, so aiming it at the wrong tenant is a
  // no-op rather than a cross-tenant write.
  const bBefore = await getConnection(bizB, "LIVE");
  await disconnect(bizA, "LIVE"); // A has nothing live now; B is untouched
  const bAfter = await getConnection(bizB, "LIVE");
  assert.deepEqual(bAfter, bBefore, "B's connection must be byte-for-byte unchanged");
});
