import { existsSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'prisma/config'
import { decideDatabaseGuard, refusalMessage } from './src/lib/prisma/production-guard'

// schema.prisma reads POSTGRES_PRISMA_URL / POSTGRES_URL_NON_POOLING via
// env(). Vercel/CI set those as real env vars, but local dev keeps them in
// .env.local (gitignored) — the Prisma CLI only auto-loads .env, not
// .env.local, so `prisma validate` / `migrate status` used to report a false
// "variable not found" for a value that was right there. Load it explicitly
// so that result is deterministic regardless of how the command is invoked.
const envLocal = path.join(process.cwd(), '.env.local')
if (existsSync(envLocal)) {
  process.loadEnvFile(envLocal)
}

// Production guard. .env.local's POSTGRES_* point at production on developer
// machines, so a bare `prisma migrate deploy` / `db push` would land there.
// Database-touching commands run only against the TEST host, on Vercel, or
// with PRISMA_ALLOW_PRODUCTION=1. See src/lib/prisma/production-guard.ts.
const guard = decideDatabaseGuard({ argv: process.argv, env: process.env })
if (guard.kind === 'refuse') {
  console.error(refusalMessage(guard))
  process.exit(2)
} else if (guard.kind === 'allow') {
  console.error(`Prisma guard: allowed — ${guard.reason}; host ${guard.host}`)
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
})
