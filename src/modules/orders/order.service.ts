/**
 * Order Service (point-of-sale / online orders)
 *
 * Reconciled to the unified schema: businessId, and the customer link is the
 * per-business Membership (never a global customer). Loyalty is NOT mutated
 * here — stamps are an owner-driven action on the append-only visits ledger
 * (see customer.service). Completing an order deducts stock; recording a
 * loyalty visit/stamp is a separate, explicit step.
 */

import { z } from 'zod'
import { LEGAL_VERSION_PATTERN } from '@/lib/legal/documents'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { notifyCustomerOrderStatus } from './customer-notifications'
import { adjustStock } from '@/modules/inventory/inventory.service'
import { generateOrderNumber } from '@/lib/utils'
import { getDeliverySettings } from '@/modules/tenant/capabilities'
import { closeOpenAttemptsForOrder } from '@/modules/payments/payment-attempt.service'

/**
 * Food Menu Domain Foundation (Phase 4) §14 — one snapshot per selected
 * option, computed and validated by storefront-cart.ts's authoritative
 * quote resolver BEFORE this schema ever sees it. createOrder itself does
 * NOT re-validate group/option membership or price deltas — it's a
 * generic, trusted-input function used by POS too (see this module's own
 * doc comment); the untrusted-input boundary is entirely storefront-cart.ts
 * and the checkout route that calls it, exactly like item name/unitPrice
 * already work today.
 */
const OrderItemOptionInput = z.object({
  groupId: z.string().optional(),
  optionId: z.string().optional(),
  groupName: z.string().min(1),
  optionName: z.string().min(1),
  priceDelta: z.number().nonnegative().default(0),
})

const OrderItemInput = z
  .object({
    productId: z.string().optional(),
    serviceId: z.string().optional(),
    name: z.string().min(1),
    sku: z.string().optional(),
    quantity: z.number().int().positive(),
    unitPrice: z.number().nonnegative(),
    discount: z.number().nonnegative().default(0),
    /** Absent/empty for a simple item with no configured menu options — every pre-Phase-4 caller (POS, non-Food storefronts) is unaffected (§19). */
    options: z.array(OrderItemOptionInput).max(50).optional(),
  })
  .refine((d) => d.productId || d.serviceId, {
    message: 'Each order item must have either a productId or serviceId',
  })

export const CreateOrderSchema = z
  .object({
    membershipId: z.string().uuid().optional(),
    staffId: z.string().optional(),
    source: z.enum(['pos', 'online', 'whatsapp', 'walk_in']).default('pos'),
    items: z.array(OrderItemInput).min(1),
    discount: z.number().nonnegative().default(0),
    discountCode: z.string().optional(),
    paymentMethod: z
      .enum(['CASH', 'CARD', 'EFT', 'SNAPSCAN', 'OZOW', 'ZAPPER', 'CAPITEC_PAY', 'LOYALTY_POINTS', 'CREDIT'])
      .optional(),
    paymentStatus: z.enum(['PENDING', 'PAID', 'PARTIAL', 'REFUNDED', 'FAILED']).default('PENDING'),
    notes: z.string().optional(),
    // Delivery — fulfilmentMethod/deliveryFee/deliveryAddress are never
    // trusted from a customer's own submission; the caller (the storefront
    // route) re-derives deliveryFee from the business's own configured
    // fee before calling this, exactly like item unitPrice is already
    // re-fetched from Product rather than trusted from the form. This
    // schema's own .refine() below is the defense-in-depth layer that
    // protects every OTHER current and future caller too.
    fulfilmentMethod: z.enum(['COLLECTION', 'DELIVERY']).default('COLLECTION'),
    deliveryFee: z.number().nonnegative().default(0),
    deliveryAddress: z.string().trim().min(1).optional(),
    deliveryInstructions: z.string().optional(),
    deliveryContactPhone: z.string().optional(),
    // Geocoded from deliveryAddress by the caller (storefront-cart.ts) —
    // best-effort, may be absent even for a real delivery order if the
    // address couldn't be resolved. Used for PER_KM pricing's distance
    // calculation and the tracking map's destination pin.
    deliveryLat: z.number().optional(),
    deliveryLng: z.number().optional(),
    // Snapshot of how the delivery fee was priced (delivery-quote.ts): the
    // exact cents charged and, for ZONE pricing, the area by id and name.
    deliveryFeeCents: z.number().int().nonnegative().optional(),
    deliveryZoneId: z.string().max(64).optional(),
    deliveryZoneName: z.string().max(60).optional(),
    // Where to send THIS order's status updates (typed at checkout, consented
    // to for order communication). Kept on the order only — never attached to
    // the customer's identity (identity-core privacy boundary).
    notifyEmail: z.string().trim().toLowerCase().email().max(254).optional(),
    // Storefront checkout only (see storefront-cart.ts) — POS/internal
    // callers never set this and are completely unaffected. Not
    // authentication, not PII: a random per-checkout-attempt token.
    checkoutIdempotencyKey: z.string().min(8).max(100).optional(),
    // Storefront checkout only: the platform Terms version the customer
    // ticked (src/lib/legal/documents.ts). The route has already checked it
    // is the CURRENT version; this layer just records what was accepted.
    // POS callers never set it. Same shape rule as the driver legal gate.
    termsVersion: z.string().regex(LEGAL_VERSION_PATTERN).optional(),
  })
  .refine((d) => d.fulfilmentMethod !== 'DELIVERY' || Boolean(d.deliveryAddress), {
    message: 'A delivery address is required for delivery orders.',
    path: ['deliveryAddress'],
  })

/**
 * True once for a genuinely new checkout attempt; a duplicate submission
 * (double-tap, refresh, slow-network retry) with the SAME key returns the
 * already-created order instead — see the `checkoutIdempotencyKey` unique
 * constraint (businessId, checkoutIdempotencyKey) added for this, and
 * storefront-checkout.test.ts's concurrency test, which is the real proof:
 * a unique-constraint violation caught here is only reachable when two
 * requests raced past the pre-check below, so catching it (rather than
 * relying on the pre-check alone) is what makes this safe under real
 * concurrent duplicate submissions, not just sequential retries.
 */
async function findOrderByIdempotencyKey(businessId: string, key: string) {
  return prisma.order.findFirst({
    where: { businessId, checkoutIdempotencyKey: key },
    include: {
      items: { include: { options: { orderBy: { sortOrder: 'asc' } } } },
      membership: { select: { publicId: true, shortCode: true, displayName: true } },
    },
  })
}

export async function createOrder(businessId: string, input: z.infer<typeof CreateOrderSchema>) {
  const validated = CreateOrderSchema.parse(input)

  if (validated.checkoutIdempotencyKey) {
    const existing = await findOrderByIdempotencyKey(businessId, validated.checkoutIdempotencyKey)
    // `created: false` is the caller's signal to skip side effects
    // (notifications) it would otherwise fire only for a genuinely new
    // order — see /api/store/checkout's use of this exact field.
    if (existing) return { ...existing, created: false as const }
  }

  if (validated.fulfilmentMethod === 'DELIVERY') {
    const business = await prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { settings: true },
    })
    if (!getDeliverySettings(business).enabled) {
      throw new Error('This business does not currently offer delivery.')
    }
  }

  const subtotal = validated.items.reduce(
    (acc, item) => acc + (item.unitPrice * item.quantity - item.discount),
    0,
  )
  const total = subtotal - validated.discount + validated.deliveryFee

  try {
    return await prisma.$transaction(
      async (tx) => {
    const order = await tx.order.create({
      data: {
        businessId,
        membershipId: validated.membershipId,
        staffId: validated.staffId,
        orderNumber: generateOrderNumber(),
        status: 'PENDING',
        source: validated.source,
        subtotal,
        discount: validated.discount,
        discountCode: validated.discountCode,
        tax: 0,
        total,
        fulfilmentMethod: validated.fulfilmentMethod,
        deliveryFee: validated.deliveryFee,
        paymentMethod: validated.paymentMethod,
        paymentStatus: validated.paymentStatus,
        paidAt: validated.paymentStatus === 'PAID' ? new Date() : null,
        notes: validated.notes,
        metadata: validated.notifyEmail ? { notifyEmail: validated.notifyEmail } : undefined,
        checkoutIdempotencyKey: validated.checkoutIdempotencyKey,
        termsVersion: validated.termsVersion,
        termsAcceptedAt: validated.termsVersion ? new Date() : undefined,
      },
    })

    // Individual creates (not createMany) — a configured item's selected
    // options need the parent OrderItem's generated id before they can be
    // inserted (§14). Order sizes here are small (a basket, not a bulk
    // import), so this stays a handful of round trips, not an N+1 concern.
    for (const item of validated.items) {
      const orderItem = await tx.orderItem.create({
        data: {
          orderId: order.id,
          productId: item.productId,
          serviceId: item.serviceId,
          name: item.name,
          sku: item.sku,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          total: item.unitPrice * item.quantity - item.discount,
        },
      })
      if (item.options && item.options.length > 0) {
        await tx.orderItemOption.createMany({
          data: item.options.map((option, index) => ({
            orderItemId: orderItem.id,
            groupId: option.groupId,
            optionId: option.optionId,
            groupNameSnapshot: option.groupName,
            optionNameSnapshot: option.optionName,
            priceDeltaSnapshot: option.priceDelta,
            sortOrder: index,
          })),
        })
      }
    }

    // Created atomically with the order, in this same transaction — a
    // COLLECTION order never gets one. deliveryAddress is guaranteed
    // present here by the schema's own .refine() above.
    if (validated.fulfilmentMethod === 'DELIVERY') {
      await tx.orderDelivery.create({
        data: {
          businessId,
          orderId: order.id,
          deliveryAddressSnapshot: validated.deliveryAddress!,
          deliveryInstructions: validated.deliveryInstructions,
          contactPhone: validated.deliveryContactPhone,
          deliveryLat: validated.deliveryLat,
          deliveryLng: validated.deliveryLng,
          deliveryFeeCents: validated.deliveryFeeCents ?? Math.round(validated.deliveryFee * 100),
          deliveryZoneId: validated.deliveryZoneId,
          deliveryZoneName: validated.deliveryZoneName,
          status: 'UNASSIGNED',
        },
      })
    }

    await tx.businessNotification.create({
      data: {
        businessId,
        type: 'new_order',
        title: 'New Order',
        message: `Order ${order.orderNumber} has been placed — R${total.toFixed(2)}`,
        data: { orderId: order.id, total },
      },
    })

    const created = await tx.order.findUnique({
      where: { id: order.id },
      include: {
        items: { include: { options: { orderBy: { sortOrder: 'asc' } } } },
        // Never the full Membership row -- customers.id (the global Skhokho
        // id) must never reach a business-facing response. Same scoping as
        // listOrders/getOrder below.
        membership: { select: { publicId: true, shortCode: true, displayName: true } },
      },
    })
    return created ? { ...created, created: true as const } : created
    },
    // Same class of bug fixed in tenant.service.ts's createBusiness and
    // appointment.service.ts's createAppointment: four sequential round
    // trips against a real Neon database can exceed Prisma's default 5s
    // transaction timeout. This is the storefront checkout path — fixed
    // proactively after finding the same pattern fail twice live. Was
    // "order, items (one createMany), optional delivery, notification,
    // read-back" (5 round trips, 20s/15s). Food Menu Domain Foundation
    // (Phase 4) switched items from one createMany to a per-item create +
    // optional per-item option createMany (§14 — an OrderItemOption needs
    // its parent OrderItem's generated id), so a several-item configured
    // order can now take meaningfully more round trips; bumped further
    // ahead of that rather than waiting to hit the ceiling live again.
      { timeout: 30_000, maxWait: 15_000 },
    )
  } catch (e) {
    // P2002 on the (businessId, checkoutIdempotencyKey) unique index means
    // a concurrent duplicate submission won the race to insert first —
    // exactly the case a sequential pre-check (above) cannot catch. Return
    // that winner's order instead of failing the request; anything else
    // (a real validation/DB error) rethrows unchanged.
    if (
      validated.checkoutIdempotencyKey &&
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      (e as { code?: string }).code === 'P2002'
    ) {
      const existing = await findOrderByIdempotencyKey(businessId, validated.checkoutIdempotencyKey)
      if (existing) return { ...existing, created: false as const }
    }
    throw e
  }
}

// ---------------------------------------------------------------------------
// The order state machine — ONE table every transition is checked against.
//
//   PENDING -> CONFIRMED -> PROCESSING -> READY -> COMPLETED
//      \__________\____________\___________\__-> CANCELLED
//
// COMPLETED, CANCELLED and REFUNDED are terminal: nothing moves them again.
// Every write that changes `status` is a CONDITIONAL update on the status it
// expects to find (updateMany ... where status = from), so two staff acting
// at once, or a driver's tap racing a cancellation, can never skip a step,
// resurrect a terminal order, or apply the same transition twice. The
// pre-reads only shape the error message; the WHERE clause is the guard.
// ---------------------------------------------------------------------------

export const ORDER_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  REFUNDED: [],
}

export const TERMINAL_ORDER_STATUSES = ['COMPLETED', 'CANCELLED', 'REFUNDED'] as const

export function canTransitionOrder(from: string, to: string): boolean {
  return (ORDER_TRANSITIONS[from] ?? []).includes(to)
}

export class InvalidOrderTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
    message?: string,
  ) {
    super(message ?? `An order that is ${from.toLowerCase()} can't become ${to.toLowerCase()}.`)
    this.name = 'InvalidOrderTransitionError'
  }
}

export function assertOrderTransition(from: string, to: string, message?: string): void {
  if (!canTransitionOrder(from, to)) throw new InvalidOrderTransitionError(from, to, message)
}

/** The statuses an order may be cancelled from — everything non-terminal. */
export const CANCELLABLE_STATUSES = Object.entries(ORDER_TRANSITIONS)
  .filter(([, to]) => to.includes('CANCELLED'))
  .map(([from]) => from)

// Only the non-terminal fulfilment steps — reaching COMPLETED goes through
// completeOrder below instead, since that transition also settles payment
// and deducts stock, not just the status column. Derived from the table so
// the two can never disagree.
const NEXT_STATUS: Partial<Record<string, string>> = Object.fromEntries(
  Object.entries(ORDER_TRANSITIONS).flatMap(([from, to]) => {
    const step = to.find((t) => t !== 'CANCELLED' && t !== 'COMPLETED')
    return step ? [[from, step]] : []
  }),
)

/** Advance an order one step through PENDING -> CONFIRMED -> PROCESSING -> READY. */
export async function advanceOrderStatus(businessId: string, orderId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, businessId } })
  if (!order) throw new Error('Order not found')
  const next = NEXT_STATUS[order.status]
  if (!next) {
    if ((TERMINAL_ORDER_STATUSES as readonly string[]).includes(order.status)) {
      throw new InvalidOrderTransitionError(order.status, 'next', `Order is already ${order.status.toLowerCase()} — nothing more to do.`)
    }
    throw new Error(`Order is already ${order.status.toLowerCase()} — use "Mark complete" to finish it`)
  }
  // Conditional on the status we read, so two staff tapping at once can't skip a step.
  const moved = await prisma.order.updateMany({ where: { id: orderId, businessId, status: order.status as never }, data: { status: next as never } })
  if (moved.count !== 1) throw new Error('This order was just updated by someone else — reload and try again.')
  const updated = await prisma.order.findUniqueOrThrow({ where: { id: orderId } })
  // Customer messages: fire-and-forget, after the write, never inside it.
  if (next === 'CONFIRMED') void notifyCustomerOrderStatus(orderId, 'CONFIRMED')
  if (next === 'READY' && updated.fulfilmentMethod === 'COLLECTION') void notifyCustomerOrderStatus(orderId, 'READY_FOR_COLLECTION')
  return updated
}

// ---------------------------------------------------------------------------
// Accept with ETA — PENDING -> CONFIRMED with a promise the customer can see
// ---------------------------------------------------------------------------

/** The choices the queue offers; anything else is refused server-side. */
export const ACCEPT_ETA_MINUTES = [10, 15, 20, 30, 45, 60, 90] as const

export interface OrderEta {
  minutes: number
  /** When the order is expected to be ready (collection) or on its way (delivery) — ISO. */
  readyAt: string
}

/** Reads the ETA an acceptance stored on the order, tolerant of absence or junk. */
export function getOrderEta(metadata: unknown): OrderEta | null {
  const eta = (metadata as { eta?: { minutes?: unknown; readyAt?: unknown } } | null)?.eta
  if (!eta || !Number.isInteger(eta.minutes) || typeof eta.readyAt !== 'string' || Number.isNaN(Date.parse(eta.readyAt))) return null
  return { minutes: eta.minutes as number, readyAt: new Date(eta.readyAt).toISOString() }
}

/** "about 14:35" in South African time — what the confirmation says. */
export function formatEtaTime(readyAtIso: string): string {
  return new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit' }).format(new Date(readyAtIso))
}

/**
 * Accepts a NEW order with a time promise. Distinct from a plain Confirm
 * (advanceOrderStatus): the ETA is stored on the order's metadata and goes
 * out in the customer's confirmation. Same conditional PENDING -> CONFIRMED
 * write, so two staff tapping at once can't accept twice or skip a step.
 */
export async function acceptOrder(businessId: string, orderId: string, etaMinutes: number, now: Date = new Date()) {
  if (!(ACCEPT_ETA_MINUTES as readonly number[]).includes(etaMinutes)) {
    throw new Error('Choose one of the offered times.')
  }
  const order = await prisma.order.findFirst({ where: { id: orderId, businessId }, select: { status: true, metadata: true } })
  if (!order) throw new Error('Order not found')
  if (order.status !== 'PENDING') throw new Error(`Only a new order can be accepted — this one is ${order.status.toLowerCase()}.`)
  const existing = (order.metadata ?? {}) as Record<string, unknown>
  const eta: OrderEta = { minutes: etaMinutes, readyAt: new Date(now.getTime() + etaMinutes * 60_000).toISOString() }
  const moved = await prisma.order.updateMany({
    where: { id: orderId, businessId, status: 'PENDING' },
    data: { status: 'CONFIRMED', metadata: { ...existing, eta } as unknown as Prisma.InputJsonValue },
  })
  if (moved.count !== 1) throw new Error('This order was just updated by someone else — reload and try again.')
  void notifyCustomerOrderStatus(orderId, 'CONFIRMED')
  return prisma.order.findUniqueOrThrow({ where: { id: orderId } })
}

// ---------------------------------------------------------------------------
// Cancellation reasons — a fixed list, so the customer hears something true
// and the business can see later why orders fall through
// ---------------------------------------------------------------------------

export const ORDER_CANCELLATION_REASONS = {
  OUT_OF_STOCK: { label: 'Out of stock', customer: 'Something you ordered is out of stock.' },
  CLOSED_OR_BUSY: { label: 'Closed or too busy right now', customer: 'The shop could not take this order right now.' },
  CUSTOMER_ASKED: { label: 'Customer asked to cancel', customer: 'You asked us to cancel it.' },
  COULD_NOT_REACH: { label: "Couldn't reach the customer", customer: 'The shop could not reach you to confirm.' },
  PAYMENT_NOT_RECEIVED: { label: 'Payment not received', customer: 'Payment for this order was not received.' },
  DUPLICATE: { label: 'Duplicate order', customer: 'This was a duplicate of another order.' },
  OTHER: { label: 'Other', customer: '' },
} as const
export type OrderCancellationReason = keyof typeof ORDER_CANCELLATION_REASONS
const MAX_CANCELLATION_DETAIL = 200

export interface OrderCancellation {
  reason: OrderCancellationReason
  /** Free text, required when the reason is OTHER; shown to the customer. */
  detail: string | null
  at: string
  byStaffId: string | null
}

export function isOrderCancellationReason(value: string): value is OrderCancellationReason {
  return Object.prototype.hasOwnProperty.call(ORDER_CANCELLATION_REASONS, value)
}

/** Validates what the queue submitted; throws a message a merchant can act on. */
export function parseCancellation(reason: string, detail: string | null | undefined): Pick<OrderCancellation, 'reason' | 'detail'> {
  if (!isOrderCancellationReason(reason)) throw new Error('Choose a reason for cancelling.')
  const trimmed = detail?.trim().slice(0, MAX_CANCELLATION_DETAIL) || null
  if (reason === 'OTHER' && !trimmed) throw new Error('Say briefly why the order is cancelled — the customer will see it.')
  return { reason, detail: trimmed }
}

/** The sentence the customer gets, built only from the fixed list plus the merchant's own words. */
export function customerCancellationText(c: Pick<OrderCancellation, 'reason' | 'detail'>): string {
  const base = ORDER_CANCELLATION_REASONS[c.reason].customer
  return [base, c.detail].filter(Boolean).join(' ')
}

export function getOrderCancellation(metadata: unknown): OrderCancellation | null {
  const c = (metadata as { cancellation?: Partial<OrderCancellation> } | null)?.cancellation
  if (!c || typeof c.reason !== 'string' || !isOrderCancellationReason(c.reason)) return null
  return { reason: c.reason, detail: typeof c.detail === 'string' ? c.detail : null, at: typeof c.at === 'string' ? c.at : '', byStaffId: typeof c.byStaffId === 'string' ? c.byStaffId : null }
}

/** Minimal lookup for a permission decision — never rendered, just the status. */
export async function getOrderStatus(businessId: string, orderId: string) {
  return prisma.order.findFirst({ where: { id: orderId, businessId }, select: { status: true } })
}

/**
 * Server-side transition authority for advanceOrderStatus, deliberately
 * separate from the state machine itself (NEXT_STATUS above) so the two
 * concerns — "what's the next status" and "who's allowed to set it" — stay
 * independently readable and testable.
 *
 * PENDING -> CONFIRMED is a managerial decision (accepting a new order) and
 * requires canManageOrders regardless of canPrepareOrders. CONFIRMED ->
 * PROCESSING and PROCESSING -> READY are the actual preparation steps and
 * may be performed by EITHER canPrepareOrders or canManageOrders — a
 * Kitchen worker moving their own queue forward, or a manager/cashier doing
 * the same. Nothing here grants completing or cancelling an order — those
 * go through completeOrder/cancelOrder, gated on canManageOrders alone by
 * their own callers, and are never reachable through this function.
 */
export function canAdvanceOrderFromStatus(
  status: string,
  permissions: { canManageOrders: boolean; canPrepareOrders: boolean },
): boolean {
  if (status === 'PENDING') return permissions.canManageOrders
  if (status === 'CONFIRMED' || status === 'PROCESSING') {
    return permissions.canManageOrders || permissions.canPrepareOrders
  }
  return false
}

/**
 * Shared by completeOrder and order-delivery.service.ts's markDelivered —
 * extracted so the stock-deduction logic is never duplicated between "the
 * merchant marked this complete" and "a driver just delivered it." Always
 * runs inside the CALLER's own transaction (`tx`), never opens its own —
 * see the original inline comment this was lifted from for why a nested
 * transaction per line item was a real problem, not just a style choice.
 */
async function deductStockForOrderItems(
  tx: Prisma.TransactionClient,
  businessId: string,
  orderId: string,
  items: { productId: string | null; quantity: number }[],
  staffId?: string,
) {
  const productItems = items.filter((i) => i.productId)
  const products = await tx.product.findMany({
    where: { id: { in: productItems.map((i) => i.productId!) }, businessId },
    select: { id: true, trackStock: true },
  })
  const trackStockById = new Map(products.map((p) => [p.id, p.trackStock]))

  // Products with no InventoryItem row at all (every product created
  // before an inventory-management screen existed to seed one — see
  // catalog.service.ts's createProduct) — treated the same as
  // trackStock: false below, not queried per-item ahead of time.
  const inventoryItems = await tx.inventoryItem.findMany({
    where: { productId: { in: productItems.map((i) => i.productId!) }, businessId },
    select: { productId: true },
  })
  const hasInventoryRecord = new Set(inventoryItems.map((i) => i.productId))

  for (const item of productItems) {
    // `trackStock: false` is a real, intentional state (see
    // Product.trackStock) — a product with no InventoryItem to begin
    // with, not an error to swallow. Only call adjustStock for products
    // that actually track stock AND already have a real inventory record —
    // a trackStock: true product with no InventoryItem row was never
    // actually being tracked (no UI has ever existed to seed one), so
    // completing an order for it must not be permanently blocked.
    if (trackStockById.get(item.productId!) === false) continue
    if (!hasInventoryRecord.has(item.productId!)) continue

    // No try/catch here deliberately: an InsufficientStockError (or any
    // other adjustStock failure) must roll back the whole transaction, not
    // complete the order while silently leaving inventory wrong.
    await adjustStock(
      businessId,
      {
        productId: item.productId!,
        quantity: -item.quantity,
        type: 'SALE',
        referenceId: orderId,
        referenceType: 'order',
        staffId,
      },
      tx,
    )
  }
}

/** The only status a merchant may complete an order FROM — reaching READY is what the one-step pipeline above guarantees. */
export const COMPLETABLE_STATUSES = ['READY'] as const

/**
 * Mark an order complete — updates status and deducts stock. Server-enforced:
 * only a READY order (the end of PENDING → CONFIRMED → PROCESSING → READY)
 * can be completed by hand; a PENDING/CONFIRMED/PROCESSING order can't skip
 * the pipeline because a UI hid the button. The conditional update below is
 * the real guard — the pre-read only shapes the error message.
 * (A driver delivering an order goes through completeDeliveredOrder instead,
 * which the delivery state machines gate on their own.)
 */
export async function completeOrder(businessId: string, orderId: string, staffId?: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, businessId },
    include: { items: true },
  })

  if (!order) throw new Error('Order not found')
  if (order.status === 'COMPLETED') throw new InvalidOrderTransitionError('COMPLETED', 'COMPLETED', 'Order is already completed')
  assertOrderTransition(order.status, 'COMPLETED', `Only a ready order can be marked complete — this one is ${order.status.toLowerCase()}.`)

  return prisma.$transaction(
    async (tx) => {
    const claimed = await tx.order.updateMany({
      where: { id: orderId, businessId, status: { in: [...COMPLETABLE_STATUSES] } },
      data: { status: 'COMPLETED' },
    })
    if (claimed.count !== 1) throw new Error('This order changed while you were completing it — reload and try again.')
    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        // Fulfilment only. Completing an order says it was handed over, not
        // that it was paid for — those are genuinely different facts, and
        // conflating them silently marked online orders PAID that were still
        // waiting on a gateway notification, with nothing to reconcile
        // against. Payment is recorded ONLY by recordInPersonPayment
        // (counter, cash on collection), by the counter's own paid-at-the-
        // till order creation, or by a verified provider notification.
      },
    })

    await deductStockForOrderItems(tx, businessId, orderId, order.items, staffId)

    // NOTE: loyalty stamps are owner-driven via customer.service (append-only
    // visits ledger) — deliberately NOT auto-issued on order completion.
    return updated
    },
    // Multiple product lines each run adjustStock's own several queries on
    // this same connection now (see above) — a real order can still take a
    // while against Neon, so the same generous timeout as every other
    // multi-query transaction fixed in this pass.
    { timeout: 15_000, maxWait: 10_000 },
  )
}

/**
 * Records money actually taken in person — at the counter, or on collection
 * or delivery.
 *
 * Separate from completing an order on purpose. An owner marking an order
 * handed over is not evidence a customer paid, and an online order may be
 * handed over while its gateway notification is still in flight. Making the
 * payment its own deliberate act means "paid" always corresponds to someone
 * having taken the money or a provider having confirmed it.
 */
export async function recordInPersonPayment(
  businessId: string,
  orderId: string,
  paymentMethod: 'CASH' | 'CARD' | 'EFT' | 'SNAPSCAN' | 'OZOW' | 'ZAPPER' | 'CAPITEC_PAY',
) {
  await prisma.$transaction(
    async (tx) => {
      const updated = await tx.order.updateMany({
        // Conditional, so it can never overwrite a payment a gateway already
        // confirmed, nor double-record one — and never on a cancelled order,
        // which has nothing to pay for.
        where: { id: orderId, businessId, paymentStatus: 'PENDING', status: { not: 'CANCELLED' } },
        data: { paymentStatus: 'PAID', paidAt: new Date(), paymentMethod },
      })
      if (updated.count === 0) {
        throw new Error('That order is not awaiting payment — it may already be paid or cancelled.')
      }
      // The customer may still have an online payment open in a tab. Close
      // it so no new handoff starts; if they pay anyway, the verified
      // notification lands as refund-due instead of a second PAID.
      await closeOpenAttemptsForOrder(tx, businessId, orderId, `Paid in person (${paymentMethod}).`)
    },
    { timeout: 15_000, maxWait: 10_000 },
  )
}

/**
 * Delivery-driven completion — status COMPLETED + stock deduction, exactly
 * like completeOrder, and likewise does NOT touch paymentStatus.
 * Payment method choice for delivery orders (card upfront vs. a future
 * cash-on-delivery option) is an explicitly separate, not-yet-built
 * feature; this function has no opinion on payment at all.
 *
 * Exported for order-delivery.service.ts's markDelivered, which calls this
 * from WITHIN its own transaction (never opens a second one) so the
 * delivery-status flip and the order completion are one atomic write.
 */
export async function completeDeliveredOrder(
  tx: Prisma.TransactionClient,
  businessId: string,
  order: { id: string; status: string; items: { productId: string | null; quantity: number }[] },
  staffId?: string,
) {
  // A silent no-op for a terminal order, deliberately NOT a throw: the
  // delivery itself (a separate row, a separate physical fact — the driver
  // really did hand over the package) must still be recorded as DELIVERED
  // even if the order was cancelled out from under it mid-delivery. "Do
  // not resurrect a terminal order" means never force it back to
  // COMPLETED, not that the driver's honest tap should fail with an error.
  if ((TERMINAL_ORDER_STATUSES as readonly string[]).includes(order.status)) return

  // Conditional on the row NOT having reached a terminal state since the
  // caller read it — a cancellation landing between that read and this
  // write must win; the delivery is still recorded, the order is not revived.
  const moved = await tx.order.updateMany({
    where: { id: order.id, businessId, status: { notIn: [...TERMINAL_ORDER_STATUSES] } },
    data: { status: 'COMPLETED' },
  })
  if (moved.count !== 1) return
  await deductStockForOrderItems(tx, businessId, order.id, order.items, staffId)
}

/**
 * Kitchen workspace's own query — deliberately minimal, not `listOrders`
 * with fields hidden in the component. No membership/customer, no staff, no
 * payment fields, no product/service join (item name/quantity are already
 * denormalized on OrderItem itself). Genuinely nothing beyond what
 * preparing an order requires.
 */
/**
 * Food Menu Domain Foundation (Phase 4) §15 — selected menu options are
 * preparation-relevant ("Large", "Cheese", "No tomato") and belong on the
 * ticket, same as item name/quantity already did. Still exactly the same
 * deliberately minimal `select` this privacy shaping has always used — no
 * membership/payment/contact field is added merely because options now
 * exist, and no Kitchen station/routing concept is introduced.
 */
export async function listKitchenOrders(businessId: string) {
  return prisma.order.findMany({
    where: { businessId, status: { in: ['CONFIRMED', 'PROCESSING'] } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      createdAt: true,
      // Collection vs delivery and the customer's note are preparation facts
      // (pack it to travel; "no onions"). Still no phone, address or payment.
      fulfilmentMethod: true,
      notes: true,
      items: {
        select: {
          name: true,
          quantity: true,
          options: {
            select: { optionNameSnapshot: true },
            orderBy: { sortOrder: 'asc' },
          },
        },
      },
    },
  })
}

export async function listOrders(
  businessId: string,
  opts: {
    status?: string
    paymentStatus?: string
    membershipId?: string
    staffId?: string
    dateFrom?: Date
    dateTo?: Date
    search?: string
    page?: number
    perPage?: number
  } = {},
) {
  const page = Math.max(1, opts.page ?? 1)
  const perPage = Math.min(100, opts.perPage ?? 25)

  const where: Prisma.OrderWhereInput = {
    businessId,
    ...(opts.status ? { status: opts.status as Prisma.EnumOrderStatusFilter } : {}),
    ...(opts.paymentStatus ? { paymentStatus: opts.paymentStatus as Prisma.EnumPaymentStatusFilter } : {}),
    ...(opts.membershipId ? { membershipId: opts.membershipId } : {}),
    ...(opts.staffId ? { staffId: opts.staffId } : {}),
    ...(opts.dateFrom || opts.dateTo
      ? { createdAt: { ...(opts.dateFrom ? { gte: opts.dateFrom } : {}), ...(opts.dateTo ? { lte: opts.dateTo } : {}) } }
      : {}),
    ...(opts.search ? { orderNumber: { contains: opts.search, mode: 'insensitive' } } : {}),
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip: (page - 1) * perPage,
      take: perPage,
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: {
            product: { select: { name: true } },
            service: { select: { name: true } },
            options: { orderBy: { sortOrder: 'asc' } },
          },
        },
        membership: { select: { publicId: true, shortCode: true, displayName: true } },
        staff: { select: { firstName: true, lastName: true } },
        delivery: {
          select: {
            status: true,
            deliveryAddressSnapshot: true,
            deliveryInstructions: true,
            contactPhone: true,
            deliveryZoneName: true,
            failureReason: true,
            driverStaff: { select: { firstName: true, lastName: true } },
            networkDeliveries: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, driver: { select: { displayName: true } } } },
          },
        },
      },
    }),
    prisma.order.count({ where }),
  ])

  return { orders, total, page, perPage, totalPages: Math.ceil(total / perPage) }
}

export async function getOrder(businessId: string, orderId: string) {
  return prisma.order.findFirst({
    where: { id: orderId, businessId },
    include: {
      items: { include: { product: true, service: true, options: { orderBy: { sortOrder: 'asc' } } } },
      membership: { select: { publicId: true, shortCode: true, displayName: true } },
      staff: { select: { firstName: true, lastName: true } },
    },
  })
}

/**
 * Cancels an order from the merchant's queue. A delivery that is already
 * underway is handled first, so nobody is ever sent to collect a cancelled
 * order and nothing already with a driver is quietly un-ordered:
 *  - a Skhokholetha request still before pickup is cancelled (offers withdrawn,
 *    an assigned driver freed); once the driver has the goods the queue
 *    refuses and the driver's own "delivered" / "problem" ends it;
 *  - an own driver who hasn't collected yet loses the job (the delivery is
 *    closed as FAILED with the reason, so it leaves their screen); one who
 *    has already picked up is refused the same way.
 */
export async function cancelOrder(
  businessId: string,
  orderId: string,
  cancellation: Pick<OrderCancellation, 'reason' | 'detail'>,
  actorStaffId?: string,
  now: Date = new Date(),
) {
  const parsed = parseCancellation(cancellation.reason, cancellation.detail)
  // The queue's own words for notes/notifications; the customer gets customerCancellationText.
  const reason = [ORDER_CANCELLATION_REASONS[parsed.reason].label, parsed.detail].filter(Boolean).join(' — ')
  const order = await prisma.order.findFirst({
    where: { id: orderId, businessId },
    include: { delivery: { select: { id: true, status: true } } },
  })
  if (!order) throw new Error('Order not found')
  assertOrderTransition(order.status, 'CANCELLED', `Cannot cancel an order that is already ${order.status.toLowerCase()}.`)
  if (order.delivery?.status === 'PICKED_UP') {
    throw new Error("This order is already on its way with your driver — it can't be cancelled from the queue. The driver can report delivered or a problem.")
  }
  if (order.delivery) {
    // Lazy imports: the Skhokholetha service imports this module.
    const letha = await import('@/modules/skhokholetha/delivery.service')
    const { TERMINAL_STATUSES, CUSTOMER_LIVE_STATUSES } = await import('@/modules/skhokholetha/state-machine')
    const open = await prisma.networkDelivery.findFirst({
      where: { orderDeliveryId: order.delivery.id, status: { notIn: [...TERMINAL_STATUSES] } },
      select: { id: true, status: true },
    })
    if (open) {
      if ((CUSTOMER_LIVE_STATUSES as readonly string[]).includes(open.status)) {
        throw new Error("A Skhokholetha driver already has this order — it can't be cancelled from the queue. Contact support if something is wrong.")
      }
      await letha.cancelNetworkDelivery({ type: 'SHOP', id: actorStaffId ?? 'merchant', businessId }, open.id, reason ? `Order cancelled: ${reason}` : 'Order cancelled')
    }
  }

  const cancelled = await prisma.$transaction(
    async (tx) => {
      const existing = (order.metadata ?? {}) as Record<string, unknown>
      const record: OrderCancellation = { ...parsed, at: now.toISOString(), byStaffId: actorStaffId ?? null }
      // Conditional on the status we read: a completion (or another
      // cancellation) that landed meanwhile wins, and the error says so.
      const moved = await tx.order.updateMany({
        where: { id: orderId, businessId, status: order.status },
        data: { status: 'CANCELLED', notes: `Cancelled: ${reason}`, metadata: { ...existing, cancellation: record } as unknown as Prisma.InputJsonValue },
      })
      if (moved.count !== 1) throw new Error('This order changed while you were cancelling it — reload and try again.')
      const row = await tx.order.findUniqueOrThrow({ where: { id: orderId } })
      if (order.delivery && order.delivery.status === 'ASSIGNED') {
        await tx.orderDelivery.updateMany({
          where: { id: order.delivery.id, businessId, status: 'ASSIGNED' },
          data: { status: 'FAILED', failureReason: reason ? `Order cancelled: ${reason}` : 'Order cancelled' },
        })
      }
      await closeOpenAttemptsForOrder(tx, businessId, orderId, 'Order cancelled.')
      await tx.businessNotification.create({
        data: { businessId, type: 'order_cancelled', title: 'Order cancelled', message: `Order ${order.orderNumber} was cancelled: ${reason}.`, data: { orderId } },
      })
      return row
    },
    { timeout: 15_000, maxWait: 10_000 },
  )
  void notifyCustomerOrderStatus(orderId, 'CANCELLED')
  return cancelled
}
