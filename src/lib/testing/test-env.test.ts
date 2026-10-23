import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma/client";
import { testDb } from "@/lib/testing/db";

/**
 * Guard: the app's own Prisma client — which most DB tests use — must be
 * connected to the dedicated test database during a test run, never the
 * app's database (see test-env.ts).
 */
test("the app's Prisma client is pointed at the test database, not the app's", async () => {
  const [app] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const [tst] = await testDb.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  assert.equal(app.db, tst.db);
  assert.equal(new URL(process.env.POSTGRES_PRISMA_URL!).hostname, new URL(process.env.TEST_DATABASE_URL!).hostname);
  await testDb.$disconnect();
});

test("tests never have a live AI key", () => {
  assert.equal(process.env.ANTHROPIC_API_KEY, undefined);
});
