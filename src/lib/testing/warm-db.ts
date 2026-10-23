/**
 * One-shot warm-up, run BEFORE `node --test` starts (see package.json's
 * `test` script) — not itself a test file, never matched by `**\/*.test.ts`.
 *
 * Root cause this addresses: Neon's serverless compute auto-suspends when
 * idle and pays a real cold-start cost on the next query (measured in this
 * repo: ~3s cold vs ~300-400ms once warm — see the test-infra-stability
 * investigation). The very first DB-touching test in a fresh `node --test`
 * run was intermittently losing that race against Prisma's connection-
 * acquisition timeout (10s default), because nothing had touched either
 * database yet that run. Cold-start is a property of the Neon COMPUTE, not
 * of which process/connection touches it — paying that cost once here,
 * outside any individual test's timeout budget, means the real suite's
 * first query hits an already-awake compute.
 *
 * Deliberately minimal: one query per database, generous own timeout,
 * clear failure if a database is genuinely unreachable (never swallowed —
 * an unreachable test database should stop the run, not be masked). Does
 * not touch application code, transaction timeouts, or test assertions.
 */

import { PrismaClient } from '@prisma/client'

async function warm(label: string, url: string | undefined): Promise<void> {
  if (!url) throw new Error(`${label}: connection URL is not set`)
  const client = new PrismaClient({ datasources: { db: { url } } })
  const start = Date.now()
  try {
    await client.$queryRaw`SELECT 1`
    console.log(`[warm-db] ${label} warm in ${Date.now() - start}ms`)
  } finally {
    await client.$disconnect()
  }
}

async function main(): Promise<void> {
  // test-env.ts (loaded first) has already re-pointed the app URL at the test DB.
  await warm('POSTGRES_PRISMA_URL (app client → test DB)', process.env.POSTGRES_PRISMA_URL)
  await warm('TEST_DATABASE_URL (test DB)', process.env.TEST_DATABASE_URL)
}

main().catch((err) => {
  console.error('[warm-db] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
