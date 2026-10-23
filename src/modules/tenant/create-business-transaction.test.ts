import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { createBusiness, CREATE_BUSINESS_TX_OPTIONS } from "./tenant.service";

/**
 * Registration's one interactive transaction must reach Prisma with an
 * explicit, generous timeout (Tab 5): Billing saw "Transaction already
 * closed" under Neon latency at the previous 15 s. No database here — the
 * client's $transaction is stubbed to capture what it is handed.
 */

test("createBusiness passes a single interactive transaction with a 30 s timeout and 10 s maxWait", async () => {
  const original = prisma.$transaction;
  const calls: { kind: "interactive" | "batch"; options: unknown }[] = [];
  const fake = { id: "00000000-0000-0000-0000-000000000000", slug: "stub", name: "Stub" };
  (prisma as unknown as { $transaction: unknown }).$transaction = async (arg: unknown, options?: unknown) => {
    calls.push({ kind: typeof arg === "function" ? "interactive" : "batch", options });
    return { business: fake, ownerStaff: { id: "staff" } };
  };
  try {
    await createBusiness({
      name: "Stub Shop",
      category: "RETAIL_STORE",
      owner: { firstName: "A", lastName: "B", email: "stub@example.test", passwordHash: "x".repeat(60) },
    });
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = original;
  }
  assert.equal(calls.length, 1, "exactly one transaction — registration stays atomic");
  assert.equal(calls[0].kind, "interactive");
  assert.deepEqual(calls[0].options, { timeout: 30_000, maxWait: 10_000 });
  assert.deepEqual(CREATE_BUSINESS_TX_OPTIONS, { timeout: 30_000, maxWait: 10_000 });
});
