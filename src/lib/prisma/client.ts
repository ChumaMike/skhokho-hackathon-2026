/**
 * Prisma Client Singleton
 *
 * Next.js dev mode hot-reloads modules on every edit. Without a global cache
 * that would open a brand-new connection pool on each reload and exhaust
 * Postgres `max_connections` within a few minutes.
 *
 * Use this client for platform-level tables (Platform, PlatformAdmin,
 * PlatformUser, Tenant, AdCampaign) and for `$transaction` blocks.
 *
 * For anything tenant-scoped, prefer `getTenantClient(tenantId)` from
 * ./tenant-client so `tenantId` is enforced automatically.
 */

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export default prisma
