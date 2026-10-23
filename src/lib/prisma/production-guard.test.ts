import test from "node:test";
import assert from "node:assert/strict";
import { databaseCommand, databaseHost, decideDatabaseGuard, refusalMessage } from "./production-guard";

/** The Prisma CLI guard: pure decision over argv + env, no database. */

const PROD = "postgres://u:p@ep-odd-bird-abc123-pooler.c-2.us-east-1.aws.neon.tech/skhokho?sslmode=require";
const PROD_DIRECT = "postgres://u:p@ep-odd-bird-abc123.c-2.us-east-1.aws.neon.tech/skhokho?sslmode=require";
const TEST = "postgres://u:p@ep-shy-wave-awcpshrh-pooler.c-12.us-east-1.aws.neon.tech/skhokho_platform_test_console";
const TEST_DIRECT = "postgres://u:p@ep-shy-wave-awcpshrh.c-12.us-east-1.aws.neon.tech/skhokho_platform_test_console";

const cli = (...words: string[]) => ["node", "C:\\x\\node_modules\\prisma\\build\\index.js", ...words];

test("only database-touching commands are recognised", () => {
  assert.equal(databaseCommand(cli("migrate", "deploy")), "migrate deploy");
  assert.equal(databaseCommand(cli("migrate", "dev", "--name", "x")), "migrate dev");
  assert.equal(databaseCommand(cli("migrate", "status")), "migrate status");
  assert.equal(databaseCommand(cli("migrate", "reset", "--force")), "migrate reset");
  assert.equal(databaseCommand(cli("db", "push", "--accept-data-loss")), "db push");
  assert.equal(databaseCommand(cli("db", "execute", "--file", "x.sql")), "db execute");
  assert.equal(databaseCommand(cli("db", "seed")), "db seed");
  assert.equal(databaseCommand(cli("studio")), "studio", "Studio can write rows");
  assert.equal(databaseCommand(cli("studio", "--port", "5556")), "studio");
  assert.equal(databaseCommand(cli("--config", "prisma.config.ts", "migrate", "deploy")), "migrate deploy", "leading flags are skipped");
  for (const words of [["generate"], ["validate"], ["format"], ["db", "pull"], ["version"], ["--version"], []]) {
    assert.equal(databaseCommand(cli(...words)), null, words.join(" ") || "(no command)");
  }
});

test("host comparison ignores Neon's pooler label and case, and tolerates junk", () => {
  assert.equal(databaseHost(PROD), "ep-odd-bird-abc123.c-2.us-east-1.aws.neon.tech");
  assert.equal(databaseHost(PROD_DIRECT), databaseHost(PROD));
  assert.equal(databaseHost("postgres://u:p@LOCALHOST:5432/x"), "localhost");
  assert.equal(databaseHost(undefined), null);
  assert.equal(databaseHost(""), null);
  assert.equal(databaseHost("not a url"), null);
});

test("refuses a bare migrate deploy whose target is production, naming the host", () => {
  const d = decideDatabaseGuard({ argv: cli("migrate", "deploy"), env: { POSTGRES_PRISMA_URL: PROD, POSTGRES_URL_NON_POOLING: PROD_DIRECT, TEST_DIRECT_URL: TEST_DIRECT } });
  assert.equal(d.kind, "refuse");
  assert.equal(d.host, "ep-odd-bird-abc123.c-2.us-east-1.aws.neon.tech");
  assert.match(d.reason, /migrate deploy/);
  assert.match(d.reason, /ep-shy-wave-awcpshrh\.c-12/);
  const msg = refusalMessage(d);
  assert.match(msg, /ep-odd-bird-abc123/);
  assert.match(msg, /PRISMA_ALLOW_PRODUCTION=1/);
});

test("refuses Studio against production like any other database command", () => {
  const d = decideDatabaseGuard({ argv: cli("studio"), env: { POSTGRES_URL_NON_POOLING: PROD_DIRECT, TEST_DIRECT_URL: TEST_DIRECT } });
  assert.equal(d.kind, "refuse");
  assert.match(d.reason, /^studio:/);
  assert.equal(decideDatabaseGuard({ argv: cli("studio"), env: { POSTGRES_URL_NON_POOLING: TEST_DIRECT, TEST_DIRECT_URL: TEST_DIRECT } }).kind, "allow");
});

test("refuses when no TEST_DIRECT_URL exists to prove the target is a test database", () => {
  const d = decideDatabaseGuard({ argv: cli("db", "push"), env: { POSTGRES_PRISMA_URL: PROD } });
  assert.equal(d.kind, "refuse");
  assert.match(d.reason, /TEST_DIRECT_URL is not set/);
});

test("allows a database command whose target is the test host, pooled or direct", () => {
  const base = { TEST_DIRECT_URL: TEST_DIRECT };
  for (const env of [
    { ...base, POSTGRES_PRISMA_URL: TEST, POSTGRES_URL_NON_POOLING: TEST_DIRECT },
    { ...base, POSTGRES_PRISMA_URL: TEST }, // pooled only: the -pooler label must not break the match
    { TEST_DATABASE_URL: TEST, POSTGRES_PRISMA_URL: TEST }, // falls back to TEST_DATABASE_URL
  ]) {
    const d = decideDatabaseGuard({ argv: cli("migrate", "deploy"), env });
    assert.equal(d.kind, "allow", JSON.stringify(env));
    assert.equal(d.host, "ep-shy-wave-awcpshrh.c-12.us-east-1.aws.neon.tech");
  }
});

test("the direct URL decides the host when both are set", () => {
  // A re-pointed direct URL with a stale pooled one still names the direct host.
  const d = decideDatabaseGuard({ argv: cli("migrate", "deploy"), env: { POSTGRES_PRISMA_URL: PROD, POSTGRES_URL_NON_POOLING: TEST_DIRECT, TEST_DIRECT_URL: TEST_DIRECT } });
  assert.equal(d.kind, "allow");
});

test("VERCEL and PRISMA_ALLOW_PRODUCTION=1 open the gate explicitly and still report the host", () => {
  const prod = { POSTGRES_URL_NON_POOLING: PROD_DIRECT, TEST_DIRECT_URL: TEST_DIRECT };
  const onVercel = decideDatabaseGuard({ argv: cli("migrate", "deploy"), env: { ...prod, VERCEL: "1" } });
  assert.equal(onVercel.kind, "allow");
  assert.match(onVercel.reason, /VERCEL/);
  assert.equal(onVercel.host, "ep-odd-bird-abc123.c-2.us-east-1.aws.neon.tech");
  const deliberate = decideDatabaseGuard({ argv: cli("migrate", "deploy"), env: { ...prod, PRISMA_ALLOW_PRODUCTION: "1" } });
  assert.equal(deliberate.kind, "allow");
  assert.match(deliberate.reason, /PRISMA_ALLOW_PRODUCTION=1/);
  // Only the exact value "1" counts; "true" or "yes" is a typo, not consent.
  assert.equal(decideDatabaseGuard({ argv: cli("migrate", "deploy"), env: { ...prod, PRISMA_ALLOW_PRODUCTION: "true" } }).kind, "refuse");
});

test("non-database commands and missing URLs are skipped, never refused", () => {
  assert.equal(decideDatabaseGuard({ argv: cli("generate"), env: { POSTGRES_PRISMA_URL: PROD } }).kind, "skip");
  assert.equal(decideDatabaseGuard({ argv: cli("validate"), env: { POSTGRES_PRISMA_URL: PROD } }).kind, "skip");
  assert.equal(decideDatabaseGuard({ argv: cli("migrate", "deploy"), env: {} }).kind, "skip", "no URL: Prisma reports its own error");
});
