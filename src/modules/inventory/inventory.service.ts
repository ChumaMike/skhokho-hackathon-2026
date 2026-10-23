/**
 * Inventory Service
 *
 * Stock levels live on `InventoryItem` (one row per product). Every change
 * writes an immutable `StockMovement` row so stock is always auditable —
 * you can replay movements to explain any current quantity.
 *
 * `StockMovement` has no `businessId` of its own; it inherits isolation from
 * `InventoryItem.businessId`. Every lookup below therefore filters the parent
 * by businessId before touching movements.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
/* Business-scoped: `businessId` filters every inventory query. Stock changes are
   append-only StockMovement rows; balances live on InventoryItem.quantity. */

type PrismaOrTx = typeof prisma | Prisma.TransactionClient

export type StockMovementType =
  | 'PURCHASE'
  | 'SALE'
  | 'ADJUSTMENT'
  | 'RETURN'
  | 'WASTE'
  | 'TRANSFER'

export interface AdjustStockInput {
  productId: string
  /** Positive = stock in, negative = stock out. */
  quantity: number
  type: StockMovementType
  staffId?: string
  unitCost?: number
  note?: string
  referenceId?: string
  referenceType?: string
  /** Allow the resulting quantity to go below zero. Default false. */
  allowNegative?: boolean
}

export class InsufficientStockError extends Error {
  constructor(
    public readonly productId: string,
    public readonly available: number,
    public readonly requested: number,
  ) {
    super(`Insufficient stock: ${available} available, ${requested} requested`)
    this.name = 'InsufficientStockError'
  }
}

// ---------------------------------------------------------------------------
// Adjust stock
// ---------------------------------------------------------------------------

/**
 * Apply a stock delta and record the movement atomically.
 * Returns the updated inventory item plus the movement that was written.
 *
 * Accepts an optional `client` — pass the `tx` from a caller's own
 * `prisma.$transaction` (e.g. order.service.ts's `completeOrder`, which
 * calls this once per line item) so everything runs on that one
 * transaction's connection. Calling `prisma.$transaction` a second time
 * from inside an already-open transaction (the original shape of this
 * function) opens a second connection while the first is still held —
 * Prisma's interactive transactions don't nest safely, and for an order
 * with several line items this multiplied both the connection pressure
 * and the total time the outer transaction stayed open, well past the
 * default 5s timeout. Reproduced live via the same P2028 error as the
 * other transactions fixed in this pass (see tenant.service.ts's
 * createBusiness comment) before this was traced to the actual cause.
 */
export async function adjustStock(
  businessId: string,
  input: AdjustStockInput,
  client: PrismaOrTx = prisma,
) {
  const { productId, quantity, type, allowNegative = false } = input

  if (!Number.isInteger(quantity)) {
    throw new Error('Stock quantity must be a whole number')
  }
  if (quantity === 0) {
    throw new Error('Stock adjustment cannot be zero')
  }

  const run = async (tx: PrismaOrTx) => {
    const item = await tx.inventoryItem.findFirst({
      where: { productId, businessId },
    })

    if (!item) {
      throw new Error(`No inventory record for product ${productId}`)
    }

    const previousQty = item.quantity
    const newQty = previousQty + quantity

    if (newQty < 0 && !allowNegative) {
      throw new InsufficientStockError(productId, previousQty, Math.abs(quantity))
    }

    const updated = await tx.inventoryItem.update({
      where: { id: item.id },
      data: {
        quantity: newQty,
        ...(quantity > 0 && type === 'PURCHASE' ? { lastRestockedAt: new Date() } : {}),
      },
    })

    const movement = await tx.stockMovement.create({
      data: {
        inventoryItemId: item.id,
        staffId: input.staffId,
        type,
        quantity,
        previousQty,
        newQty,
        unitCost: input.unitCost,
        note: input.note,
        referenceId: input.referenceId,
        referenceType: input.referenceType,
      },
    })

    // Warn the business when a movement drops them to/below their threshold.
    if (newQty <= updated.minQuantity && previousQty > updated.minQuantity) {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { name: true },
      })

      await tx.businessNotification.create({
        data: {
          businessId,
          type: 'low_stock',
          title: 'Low stock',
          message: `${product?.name ?? 'A product'} is down to ${newQty} — reorder level is ${updated.minQuantity}.`,
          data: { productId, quantity: newQty, minQuantity: updated.minQuantity },
        },
      })
    }

    return { item: updated, movement }
  }

  // Already inside a caller-provided transaction — run directly on it
  // rather than opening a second, nested one.
  if (client !== prisma) return run(client)

  return prisma.$transaction(run, { timeout: 15_000, maxWait: 10_000 })
}

// ---------------------------------------------------------------------------
// Counts and queries
// ---------------------------------------------------------------------------

/** Overwrite the on-hand quantity after a physical stock count. */
export async function setStockLevel(
  businessId: string,
  productId: string,
  countedQuantity: number,
  staffId?: string,
  note?: string,
) {
  if (!Number.isInteger(countedQuantity) || countedQuantity < 0) {
    throw new Error('Counted quantity must be a non-negative whole number')
  }

  const item = await prisma.inventoryItem.findFirst({ where: { productId, businessId } })
  if (!item) throw new Error(`No inventory record for product ${productId}`)

  const delta = countedQuantity - item.quantity
  if (delta === 0) {
    return prisma.inventoryItem.update({
      where: { id: item.id },
      data: { lastCountAt: new Date() },
    })
  }

  const { item: updated } = await adjustStock(businessId, {
    productId,
    quantity: delta,
    type: 'ADJUSTMENT',
    staffId,
    note: note ?? 'Physical stock count',
    referenceType: 'manual_adjustment',
    allowNegative: true,
  })

  return prisma.inventoryItem.update({
    where: { id: updated.id },
    data: { lastCountAt: new Date() },
  })
}

/** Products at or below their reorder threshold. */
export async function getLowStockItems(businessId: string) {
  const items = await prisma.inventoryItem.findMany({
    where: { businessId },
    include: { product: { select: { id: true, name: true, sku: true } } },
    orderBy: { quantity: 'asc' },
  })

  // `quantity <= minQuantity` compares two columns, which Prisma can't express
  // in a `where` clause without raw SQL — filter in memory instead.
  return items.filter((i) => i.quantity <= i.minQuantity)
}

/** Movement history for one product, newest first. */
export async function getStockHistory(
  businessId: string,
  productId: string,
  opts: { page?: number; perPage?: number } = {},
) {
  const page = Math.max(1, opts.page ?? 1)
  const perPage = Math.min(100, opts.perPage ?? 50)

  const item = await prisma.inventoryItem.findFirst({
    where: { productId, businessId },
    select: { id: true },
  })
  if (!item) return { movements: [], total: 0, page, perPage, totalPages: 0 }

  const [movements, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { inventoryItemId: item.id },
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { createdAt: 'desc' },
      include: { staff: { select: { firstName: true, lastName: true } } },
    }),
    prisma.stockMovement.count({ where: { inventoryItemId: item.id } }),
  ])

  return { movements, total, page, perPage, totalPages: Math.ceil(total / perPage) }
}
