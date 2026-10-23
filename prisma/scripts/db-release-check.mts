/**
 * Read-only pre-deploy check for whatever database the current env points at.
 *
 * Exists because this project's databases were created with `prisma db push`
 * rather than `prisma migrate`, so they had no `_prisma_migrations` table and
 * `migrate deploy` had nothing to reason about. The development database was
 * baselined on 2026-09-20; any other environment needs the same treatment
 * once, and this tells you which case you are in before you touch anything.
 *
 * It writes nothing. Run it against production BEFORE deploying:
 *
 *   POSTGRES_PRISMA_URL=... POSTGRES_URL_NON_POOLING=... \
 *     node --import tsx prisma/scripts/db-release-check.mts
 */
import { PrismaClient } from '@prisma/client'
import { readdirSync } from 'node:fs'
import path from 'node:path'

const prisma = new PrismaClient()

function localMigrations(): string[] {
  const dir = path.join(process.cwd(), 'prisma', 'migrations')
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

async function main() {
  const host = (process.env.POSTGRES_PRISMA_URL ?? '').replace(/^.*@/, '').replace(/[/?].*$/, '')
  console.log(`\nDatabase: ${host || '(POSTGRES_PRISMA_URL not set)'}\n`)

  const tracked: { exists: boolean } = { exists: false }
  let applied: string[] = []
  try {
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string; finished_at: Date | null }[]>(
      'select migration_name, finished_at from _prisma_migrations order by migration_name',
    )
    tracked.exists = true
    applied = rows.filter((r) => r.finished_at).map((r) => r.migration_name)
    const unfinished = rows.filter((r) => !r.finished_at).map((r) => r.migration_name)
    if (unfinished.length) {
      console.log('FAILED/UNFINISHED migrations present — resolve these before deploying:')
      for (const u of unfinished) console.log(`  ${u}`)
      console.log('')
    }
  } catch {
    tracked.exists = false
  }

  // Does the onboarding interview table exist? Its absence is the specific
  // thing that takes /dashboard down for every owner, because InterviewGate
  // queries it on each load.
  let hasProfiles = false
  try {
    await prisma.$queryRawUnsafe('select 1 from business_profiles limit 1')
    hasProfiles = true
  } catch {
    hasProfiles = false
  }

  const local = localMigrations()
  const missing = local.filter((m) => !applied.includes(m))

  console.log(`Migration history table : ${tracked.exists ? 'present' : 'MISSING'}`)
  console.log(`Migrations in repo      : ${local.length}`)
  console.log(`Recorded as applied     : ${applied.length}`)
  console.log(`business_profiles table : ${hasProfiles ? 'present' : 'MISSING'}`)

  console.log('\nWhat to do:')
  if (!tracked.exists) {
    console.log('  This database is not tracked by prisma migrate (created with db push).')
    console.log('  1. Confirm the live schema matches the repo:')
    console.log('       npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \\')
    console.log('         --to-schema-datamodel prisma/schema.prisma --exit-code')
    console.log('  2. If it reports "No difference", baseline every migration as applied:')
    console.log('       for each name: npx prisma migrate resolve --applied <name>')
    console.log('  3. If it reports differences, DO NOT baseline. The schema is genuinely')
    console.log('     behind — apply the missing DDL first, then baseline.')
  } else if (missing.length > 0) {
    console.log('  Pending migrations to apply with `npx prisma migrate deploy`:')
    for (const m of missing) console.log(`    ${m}`)
  } else {
    console.log('  Up to date — nothing to apply.')
  }

  if (!hasProfiles) {
    console.log('\n  WARNING: business_profiles is missing. Deploying the dashboard against')
    console.log('  this database will throw on every owner page load (InterviewGate).')
  }
  console.log('')
}

main()
  .catch((e) => {
    console.error('db-release-check failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
