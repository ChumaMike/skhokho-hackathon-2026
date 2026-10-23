/**
 * Test database helper — a separate `PrismaClient` pointed at
 * `TEST_DATABASE_URL` (see .env.local), a dedicated database in the same
 * Neon project, never the app's own dev database. Tests that need a real
 * database import `testDb` from here rather than the app's
 * `@/lib/prisma/client` singleton, so a test run can never touch real
 * data — this throws at import time if the env var is missing, rather
 * than silently falling back to anything.
 */

import { PrismaClient } from '@prisma/client'

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set. DB-backed tests need a dedicated test database — see .env.local, or run with --env-file=.env.local.',
  )
}

export const testDb = new PrismaClient({
  datasources: { db: { url: process.env.TEST_DATABASE_URL } },
})

/**
 * Clears every table for a clean slate between test files. Uses raw
 * TRUNCATE, not per-model `deleteMany()`, deliberately: `visits` and
 * `audit_log` have real DB triggers (`visits_append_only`,
 * `audit_append_only`) that raise an exception on UPDATE OR DELETE — the
 * append-only enforcement this schema is built around (see
 * prisma/sql/10_identity_rpcs.sql). Those triggers aren't registered for
 * TRUNCATE, so TRUNCATE is the only way to clear those two tables at all,
 * and it correctly respects the same invariant a plain `deleteMany()`
 * would violate (and fail on). CASCADE handles FK ordering, so table
 * order here doesn't matter the way it would for individual deletes.
 */
export async function resetTestDb(): Promise<void> {
  const tables = [
    'reviews', 'order_items', 'orders', 'appointments', 'stock_movements',
    'inventory_items', 'product_variants', 'products', 'product_categories',
    'services', 'business_notifications', 'business_metrics', 'visits',
    'consents', 'audit_log', 'memberships', 'customer_identifiers',
    'customers', 'customer_login_codes', 'business_staff_sessions', 'business_staff',
    'business_roles', 'business_subscriptions', 'platform_enquiries',
    'business_domains',
    // Payment rows use onDelete: Restrict precisely so real history can never
    // be cascaded away, which means they must be named here explicitly —
    // truncating `businesses` alone would fail on the restricting FK.
    'business_payment_attempts', 'business_payment_connections',
    'business_profiles',
    'businesses', 'app_users',
  ]
  await testDb.$executeRawUnsafe(
    `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`,
  )
}
