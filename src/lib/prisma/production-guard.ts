/**
 * Guard for the Prisma CLI: refuse database-touching commands against any
 * host other than the test database unless the run is clearly deliberate.
 *
 * Why: prisma.config.ts loads .env.local, and on a developer machine that file
 * points POSTGRES_* at production. A bare `prisma migrate deploy` in a worktree
 * therefore reached production once (2026-10-23). The decision here is pure —
 * no Prisma, no network — so it can be unit-tested with a fake env and argv.
 *
 * Allowed through:
 *   - commands that never open a connection (generate, validate, format, …)
 *   - any command when VERCEL is set (the production build runs migrate deploy)
 *   - any command when PRISMA_ALLOW_PRODUCTION=1 is set explicitly
 *   - a database command whose target host is the TEST host (TEST_DIRECT_URL)
 */

/**
 * Top-level CLI commands that read or write a database through the datasource.
 * 'all' = every subcommand; 'self' = the command has no subcommands; a set = only those.
 */
export const DATABASE_COMMANDS: Readonly<Record<string, ReadonlySet<string> | 'all' | 'self'>> = {
  migrate: 'all',
  db: new Set(['push', 'execute', 'seed']),
  studio: 'self', // Studio edits rows through the same datasource
}

export type GuardDecision =
  | { kind: 'skip'; reason: string }
  | { kind: 'allow'; host: string; reason: string }
  | { kind: 'refuse'; host: string; reason: string }

export type GuardInput = {
  argv: readonly string[]
  env: Readonly<Record<string, string | undefined>>
}

/** The `migrate deploy` / `db push` part of a Prisma CLI argv, or null when the command never touches a database. */
export function databaseCommand(argv: readonly string[]): string | null {
  // argv is `node …/prisma/build/index.js <command> [subcommand] [flags]`; find the first
  // word that is a known top-level command, skipping the binary, the script and any flags.
  const words = argv.filter((a) => !a.startsWith('-'))
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    const rule = DATABASE_COMMANDS[word]
    if (!rule) continue
    if (rule === 'self') return word
    const sub = words[i + 1]
    if (rule === 'all') return sub ? `${word} ${sub}` : word
    if (sub && rule.has(sub)) return `${word} ${sub}`
    return null
  }
  return null
}

/**
 * Host of a Postgres URL, with Neon's `-pooler` label removed so a pooled and a
 * direct URL to the same compute compare equal. Null when the URL is missing or malformed.
 */
export function databaseHost(url: string | undefined): string | null {
  if (!url) return null
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (!host) return null
    const [first, ...rest] = host.split('.')
    return [first!.replace(/-pooler$/, ''), ...rest].join('.')
  } catch {
    return null
  }
}

export function decideDatabaseGuard({ argv, env }: GuardInput): GuardDecision {
  const command = databaseCommand(argv)
  if (!command) return { kind: 'skip', reason: 'command does not touch a database' }

  const host = databaseHost(env.POSTGRES_URL_NON_POOLING) ?? databaseHost(env.POSTGRES_PRISMA_URL)
  if (!host) return { kind: 'skip', reason: `${command}: no POSTGRES_URL_NON_POOLING / POSTGRES_PRISMA_URL to check` }

  if (env.VERCEL) return { kind: 'allow', host, reason: `${command}: VERCEL is set (platform build)` }
  if (env.PRISMA_ALLOW_PRODUCTION === '1') return { kind: 'allow', host, reason: `${command}: PRISMA_ALLOW_PRODUCTION=1 set explicitly` }

  const testHost = databaseHost(env.TEST_DIRECT_URL) ?? databaseHost(env.TEST_DATABASE_URL)
  if (testHost && host === testHost) return { kind: 'allow', host, reason: `${command}: target is the test host` }

  const why = testHost ? `it is not the test host ${testHost}` : 'TEST_DIRECT_URL is not set, so it cannot be proven to be a test database'
  return { kind: 'refuse', host, reason: `${command}: refusing to run against ${host} because ${why}` }
}

/** The message a refused developer sees. Plain words; says exactly how to proceed on purpose. */
export function refusalMessage(d: Extract<GuardDecision, { kind: 'refuse' }>): string {
  return [
    `Prisma guard: ${d.reason}.`,
    'This is most likely production (.env.local points POSTGRES_* there).',
    'To run against the test database, re-point POSTGRES_PRISMA_URL and POSTGRES_URL_NON_POOLING at TEST_* first.',
    'To run against this host on purpose, set PRISMA_ALLOW_PRODUCTION=1 for this one command.',
  ].join('\n')
}
