/**
 * Test environment bootstrap — loaded with `--import` BEFORE any test file
 * (see package.json `test`), so it runs before anything imports the app's
 * Prisma client.
 *
 * Why it exists: DB tests use the app's own `prisma` singleton, which reads
 * POSTGRES_PRISMA_URL — and in .env.local that is the APP's database. Without
 * this, `npm test` would write fixtures into whatever database the app is
 * pointed at. Here every app database variable is re-pointed at the
 * dedicated test database, and the run refuses to start if that's
 * impossible or unsafe. Fails closed: no test DB, no tests.
 *
 * It also:
 *  - removes ANTHROPIC_API_KEY, so tests never call (or pay for) a live model;
 *  - keeps the test client's pool small. On Neon, a compute restart or
 *    scale-to-zero closes every pooled connection at once; Prisma then fails
 *    one query per dead connection ("Server has closed the connection"). A
 *    small pool bounds that cascade to a couple of queries instead of a
 *    whole file of failures, without masking real errors behind retries.
 */

const testUrl = process.env.TEST_DATABASE_URL
const testDirect = process.env.TEST_DIRECT_URL ?? testUrl

function host(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname.replace('-pooler', '') : ''
  } catch {
    return ''
  }
}

// No test database configured (e.g. a CI job running unit tests only): point
// every app database variable at an address that can't connect, so DB tests
// fail fast and NOTHING can reach a real database. Pure tests still run.
const UNREACHABLE = 'postgresql://no-test-database-configured@127.0.0.1:1/none?connect_timeout=1'
if (!testUrl) {
  console.warn('[test-env] TEST_DATABASE_URL is not set — database tests will fail; no real database is reachable.')
  for (const k of ['POSTGRES_PRISMA_URL', 'DATABASE_URL', 'POSTGRES_URL_NON_POOLING', 'DIRECT_URL']) process.env[k] = UNREACHABLE
}

const appUrl = process.env.POSTGRES_PRISMA_URL ?? process.env.DATABASE_URL
if (testUrl && appUrl && appUrl !== UNREACHABLE && host(appUrl) === host(testUrl) && new URL(testUrl).pathname === new URL(appUrl).pathname) {
  throw new Error('[test-env] TEST_DATABASE_URL points at the same database as the app. Refusing to run tests against it.')
}

/** Adds pool limits unless the URL already sets them. */
function withPool(url: string): string {
  const u = new URL(url)
  if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '4')
  if (!u.searchParams.has('pool_timeout')) u.searchParams.set('pool_timeout', '30')
  if (!u.searchParams.has('connect_timeout')) u.searchParams.set('connect_timeout', '15')
  return u.toString()
}

if (testUrl) {
  const pooled = withPool(testUrl)
  process.env.TEST_DATABASE_URL = pooled
  process.env.POSTGRES_PRISMA_URL = pooled
  process.env.DATABASE_URL = pooled
  process.env.POSTGRES_URL_NON_POOLING = testDirect!
  process.env.DIRECT_URL = testDirect!
}

delete process.env.ANTHROPIC_API_KEY

// Next's request-scoped storage (what `after()`, `cookies()` and friends read)
// is created at module load from `globalThis.AsyncLocalStorage`, which Next's
// own server bootstrap sets and a bare `node --test` process does not. Set it
// here, before any test imports a route module, so tests can call handlers
// in-process inside a scope (see request-scope.ts). Same assignment Next's
// node environment makes; harmless when a real server has already set it.
import { AsyncLocalStorage } from 'node:async_hooks'
;(globalThis as { AsyncLocalStorage?: typeof AsyncLocalStorage }).AsyncLocalStorage ??= AsyncLocalStorage
