/**
 * Business-scoped Prisma client
 *
 * Defense-in-depth ON TOP of Postgres RLS (`SET LOCAL app.current_business_id`):
 * a Prisma extension that
 *  - injects `businessId` on all writes
 *  - filters by `businessId` on all reads/updates/deletes
 *
 * Usage:
 *   const db = getBusinessClient(businessId)
 *   await db.product.findMany()  // automatically scoped to this business
 */

import { prisma } from './client'

// Models that carry a `businessId` column and require row-level isolation.
// NOTE: models isolated transitively through a parent are deliberately absent —
// reach them via their parent, never directly from user input:
//   OrderItem      → Order.businessId
//   StockMovement  → InventoryItem.businessId
//   ProductVariant → Product.businessId
//   BusinessStaffSession → BusinessStaff.businessId
//   Visit is business-scoped but written only via the identity RPCs.
const BUSINESS_SCOPED_MODELS = new Set([
  'BusinessStaff',
  'BusinessRole',
  'BusinessSubscription',
  'Product',
  'ProductCategory',
  'Service',
  'InventoryItem',
  'Order',
  'Appointment',
  'BusinessMetric',
  'BusinessNotification',
])

const WRITE_OPERATIONS = new Set(['create', 'createMany', 'upsert'])

const FILTER_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
])

export function getBusinessClient(businessId: string) {
  if (!businessId) {
    throw new Error('getBusinessClient requires a valid businessId')
  }

  return prisma.$extends({
    name: 'business-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !BUSINESS_SCOPED_MODELS.has(model)) {
            return query(args)
          }

          const a = args as Record<string, unknown>
          const scoped = (v: unknown) => ({ ...(v as object | undefined), businessId })

          if (WRITE_OPERATIONS.has(operation)) {
            if (operation === 'createMany') {
              const data = Array.isArray(a.data)
                ? (a.data as object[]).map((item) => ({ ...item, businessId }))
                : scoped(a.data)
              return query({ ...a, data } as typeof args)
            }

            if (operation === 'upsert') {
              a.create = scoped(a.create)
              a.where = scoped(a.where)
              return query(a as typeof args)
            }

            a.data = scoped(a.data)
            return query(a as typeof args)
          }

          if (FILTER_OPERATIONS.has(operation)) {
            a.where = scoped(a.where)
            return query(a as typeof args)
          }

          return query(args)
        },
      },
    },
  })
}

export type BusinessPrismaClient = ReturnType<typeof getBusinessClient>
