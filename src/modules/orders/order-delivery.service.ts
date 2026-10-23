/**
 * Order Delivery Service — the fulfilment domain associated with an Order
 * for a DELIVERY checkout (see order.service.ts's createOrder, which
 * creates the OrderDelivery row atomically; a COLLECTION order never gets
 * one). Deliberately NOT another meaning for Order.staffId, which keeps
 * meaning "who processed the order."
 *
 * Authorization here is ALWAYS from BusinessRole.permissions
 * (canPerformDeliveries / canManageDeliveries), never from jobTitle,
 * jobPreset, presetRole, or primaryWorkspace — those are presentation
 * only. canActOnDelivery is the one place that decision is made, kept as
 * a small pure function (mirroring order.service.ts's
 * canAdvanceOrderFromStatus) so it's directly unit-testable without a
 * Next.js request context.
 */

import { prisma } from '@/lib/prisma/client'
import { notifyCustomerOrderStatus } from './customer-notifications'
import { allowsOwnDrivers } from '@/modules/tenant/capabilities'
import { completeDeliveredOrder } from '@/modules/orders/order.service'
import { requireAnyStaffPermission } from '@/lib/auth/guards'
import type { StaffPermissions } from '@/types'
import { issueDropoffCode, verifyDropoffCode, MAX_CODE_FAILURES } from './delivery-code'

// ---------------------------------------------------------------------------
// Authorization decision (pure, no I/O)
// ---------------------------------------------------------------------------

export interface DeliveryActor {
  isOwner: boolean
  staffId: string
  canPerformDeliveries: boolean
  canManageDeliveries: boolean
}

/**
 * Owner or canManageDeliveries: full authority over any delivery in the
 * business (dispatch, reassign, intervene). Otherwise: canPerformDeliveries
 * AND the delivery is actually assigned to THIS staff member — never a
 * broader "any driver" grant. Re-derive `delivery` fresh from the DB on
 * every call (never cache it across requests) so a delivery reassigned
 * away from a driver mid-session can't be acted on by their next stale tap.
 */
export function canActOnDelivery(actor: DeliveryActor, delivery: { driverStaffId: string | null }): boolean {
  if (actor.isOwner || actor.canManageDeliveries) return true
  return actor.canPerformDeliveries && delivery.driverStaffId === actor.staffId
}

/**
 * Shared entry check for every driver-facing write: gets the caller in the
 * door (canPerformDeliveries OR canManageDeliveries — the manager-override
 * path), then re-fetches the delivery fresh and confirms canActOnDelivery
 * (never cached — a delivery reassigned away from this driver mid-session
 * must reject their next tap/location ping, not honour a stale assignment).
 *
 * Extracted from dashboard/driver/actions.ts's original private
 * authorizedDelivery() so the driver-location API route (a frequent,
 * fire-and-forget background write, not a form action) uses identical
 * authorization logic rather than a second copy that could drift. Throws
 * AuthError (401) or a plain Error — callers decide how to present that
 * (a redirect for a server action, a JSON response for a route handler).
 */
export async function assertCanActOnDelivery(
  deliveryId: string,
): Promise<{ tenantId: string; staffId: string }> {
  const { payload, permissions } = await requireAnyStaffPermission(['canPerformDeliveries', 'canManageDeliveries'])
  const delivery = await getDeliveryForActorCheck(payload.tenantId, deliveryId)
  if (!delivery) throw new Error('Delivery not found.')
  const allowed = canActOnDelivery(
    {
      isOwner: payload.isOwner,
      staffId: payload.staffId,
      canPerformDeliveries: permissions.canPerformDeliveries,
      canManageDeliveries: permissions.canManageDeliveries,
    },
    delivery,
  )
  if (!allowed) throw new Error("This delivery isn't assigned to you.")
  return { tenantId: payload.tenantId, staffId: payload.staffId }
}

// ---------------------------------------------------------------------------
// Minimal lookups
// ---------------------------------------------------------------------------

/** Minimal fetch for a permission decision — never rendered directly. */
export async function getDeliveryForActorCheck(businessId: string, deliveryId: string) {
  return prisma.orderDelivery.findFirst({
    where: { id: deliveryId, businessId },
    select: { id: true, status: true, driverStaffId: true, orderId: true },
  })
}

/**
 * Eligible staff for the assign-driver picker: active BusinessStaff whose
 * role permissions include canPerformDeliveries. Permissions are JSON, so
 * this is a fetch-then-filter-in-memory, matching every other permission
 * check's shape in this codebase (guards.ts does the same). Re-validated
 * again, independently, inside assignDriver — this list is only ever a UI
 * convenience, never itself the authorization.
 */
export async function listEligibleDrivers(businessId: string) {
  const staff = await prisma.businessStaff.findMany({
    where: { businessId, isActive: true },
    include: { role: true },
    orderBy: [{ firstName: 'asc' }],
  })
  return staff
    .filter((s) => ((s.role?.permissions ?? {}) as unknown as StaffPermissions).canPerformDeliveries)
    .map((s) => ({ id: s.id, firstName: s.firstName, lastName: s.lastName, jobTitle: s.jobTitle }))
}

// ---------------------------------------------------------------------------
// Manager dispatch
// ---------------------------------------------------------------------------

/**
 * Everything the dispatch workspace's four sections filter over, in one
 * query — manager/owner already has full business-wide visibility via
 * canManageDeliveries, so no privacy shaping is needed here the way the
 * driver's own queries below require.
 */
export async function listDeliveriesForManagement(businessId: string) {
  const rows = await prisma.orderDelivery.findMany({
    where: { businessId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      status: true,
      deliveryAddressSnapshot: true,
      deliveryInstructions: true,
      failureReason: true,
      driverStaffId: true,
      deliveredAt: true,
      driverStaff: { select: { firstName: true, lastName: true } },
      order: { select: { id: true, orderNumber: true, status: true } },
      // Proof-of-delivery state only — never the code itself (delivery-code.ts).
      customerKeyHash: true,
      dropoffCode: { select: { failures: true, confirmedAt: true, overrideReason: true } },
    },
  })
  return rows.map(({ customerKeyHash, dropoffCode, ...d }) => ({
    ...d,
    needsCode: Boolean(customerKeyHash && dropoffCode && !dropoffCode.confirmedAt),
    codeLocked: Boolean(dropoffCode && !dropoffCode.confirmedAt && dropoffCode.failures >= MAX_CODE_FAILURES),
    codeOverrideReason: dropoffCode?.overrideReason ?? null,
  }))
}

/**
 * Only READY orders with an UNASSIGNED delivery are dispatchable — this is
 * the deliberate rule (order.service.ts's own state machine is untouched;
 * this is an orthogonal check), enforced here server-side, not only by
 * whichever manager-UI section happened to list it as "needs a driver."
 */
export async function assignDriver(businessId: string, deliveryId: string, driverStaffId: string) {
  const delivery = await prisma.orderDelivery.findFirst({
    where: { id: deliveryId, businessId },
    include: { order: { select: { status: true } }, business: { select: { settings: true } } },
  })
  if (!delivery) throw new Error('Delivery not found')
  // Fulfilment setting "Skhokholetha only": no in-house assignment. Checked
  // here (the service), so no UI can route around it. A driver already on a
  // delivery keeps it — this only gates NEW assignments.
  if (!allowsOwnDrivers(delivery.business)) throw new Error('Your fulfilment settings use Skhokholetha drivers only — request a network driver instead.')
  if (delivery.status === 'PICKED_UP' || delivery.status === 'DELIVERED' || delivery.status === 'FAILED') {
    throw new Error(`Cannot assign a driver once a delivery is ${delivery.status.toLowerCase()}`)
  }
  if (delivery.order.status !== 'READY' && delivery.status === 'UNASSIGNED') {
    throw new Error('Only a READY order can be dispatched.')
  }
  // Never both: an order with a Skhokholetha driver requested can't also get a staff driver.
  const network = await prisma.networkDelivery.findFirst({
    where: { orderDeliveryId: deliveryId, status: { notIn: ['DELIVERED', 'CANCELLED', 'RETURNED'] } },
    select: { id: true },
  })
  if (network) throw new Error('A Skhokholetha driver is handling this order — cancel that request first.')

  const driver = await prisma.businessStaff.findFirst({
    where: { id: driverStaffId, businessId, isActive: true },
    include: { role: true },
  })
  if (!driver) throw new Error('That staff member was not found on this business.')
  const permissions = (driver.role?.permissions ?? {}) as unknown as StaffPermissions
  if (!permissions.canPerformDeliveries) {
    throw new Error("That staff member isn't eligible to receive deliveries.")
  }

  const assigned = await prisma.orderDelivery.update({
    where: { id: deliveryId },
    data: { status: 'ASSIGNED', driverStaffId, assignedAt: new Date() },
  })
  // Proof of delivery: a code the customer sees on their own page and the
  // driver must enter. Only when the customer HAS a page (storefront orders
  // hold a customer key); idempotent across reassignment.
  if (delivery.customerKeyHash) await issueDropoffCode(businessId, deliveryId)
  await prisma.businessNotification
    .create({ data: { businessId, type: 'delivery_assigned', title: 'Driver assigned', message: `${driver.firstName} ${driver.lastName} is taking a delivery.`, data: { orderId: delivery.orderId } } })
    .catch(() => undefined)
  void notifyCustomerOrderStatus(delivery.orderId, 'DRIVER_ASSIGNED')
  return assigned
}

// ---------------------------------------------------------------------------
// Driver actions — conditional updates for low-connectivity safety (double
// taps / retries never produce a conflicting write; the loser gets the
// current, honest state back instead of a generic failure)
// ---------------------------------------------------------------------------

export async function markPickedUp(businessId: string, deliveryId: string) {
  const current = await prisma.orderDelivery.findFirst({ where: { id: deliveryId, businessId } })
  if (!current) throw new Error('Delivery not found')
  if (current.status === 'PICKED_UP') return current // idempotent — duplicate tap, no-op

  const result = await prisma.orderDelivery.updateMany({
    where: { id: deliveryId, businessId, status: 'ASSIGNED' },
    data: { status: 'PICKED_UP', pickedUpAt: new Date() },
  })
  if (result.count === 0) {
    const latest = await prisma.orderDelivery.findUniqueOrThrow({ where: { id: deliveryId } })
    if (latest.status === 'PICKED_UP') return latest // a concurrent request already got there
    throw new Error(`This delivery must be assigned before pickup (currently ${latest.status.toLowerCase()}).`)
  }
  void notifyCustomerOrderStatus(current.orderId, 'OUT_FOR_DELIVERY')
  return prisma.orderDelivery.findUniqueOrThrow({ where: { id: deliveryId } })
}

/**
 * One transaction: flips the delivery to DELIVERED, then — only if the
 * order isn't already CANCELLED or COMPLETED — completes the order and
 * deducts stock via the shared helper (order.service.ts's
 * completeDeliveredOrder). Duplicate "Delivered" taps are safe: the
 * idempotency check happens before either write, so a second tap never
 * re-runs stock deduction or re-fires anything.
 */
export interface MarkDeliveredOptions {
  /** The 6-digit code the customer gave the driver (delivery-code.ts). */
  code?: string | null
  /** A manager completing WITHOUT the code — the reason goes on the record. */
  override?: { reason: string; byStaffId: string }
}

/**
 * Proof of delivery first (outside the transaction, so a wrong code is always
 * counted), then the atomic completion. A delivery whose customer holds a
 * code can't be marked delivered without it, unless a manager overrides
 * with a reason. A delivery with no code issued completes as before.
 */
export async function markDelivered(businessId: string, deliveryId: string, staffId?: string, opts: MarkDeliveredOptions = {}) {
  const current = await prisma.orderDelivery.findFirst({
    where: { id: deliveryId, businessId },
    select: { status: true, dropoffCode: { select: { confirmedAt: true } } },
  })
  if (!current) throw new Error('Delivery not found')
  let confirmation: { confirmedAt: Date; overrideReason?: string; overrideByStaffId?: string } | null = null
  if (current.status === 'PICKED_UP' && current.dropoffCode && !current.dropoffCode.confirmedAt) {
    if (opts.override) {
      const reason = opts.override.reason.trim()
      if (reason.length < 5) throw new Error('Give a reason for completing without the code (at least 5 characters).')
      confirmation = { confirmedAt: new Date(), overrideReason: reason.slice(0, 300), overrideByStaffId: opts.override.byStaffId }
    } else {
      await verifyDropoffCode(businessId, deliveryId, opts.code, staffId ?? 'unknown')
      confirmation = { confirmedAt: new Date() }
    }
  }
  const delivered = await markDeliveredTx(businessId, deliveryId, staffId, confirmation)
  if (delivered.status === 'DELIVERED') void notifyCustomerOrderStatus(delivered.orderId, 'DELIVERED')
  return delivered
}

async function markDeliveredTx(
  businessId: string,
  deliveryId: string,
  staffId?: string,
  confirmation: { confirmedAt: Date; overrideReason?: string; overrideByStaffId?: string } | null = null,
) {
  return prisma.$transaction(
    async (tx) => {
      const delivery = await tx.orderDelivery.findFirst({ where: { id: deliveryId, businessId } })
      if (!delivery) throw new Error('Delivery not found')
      if (delivery.status === 'DELIVERED') return delivery // idempotent — no duplicate side effects

      const updateResult = await tx.orderDelivery.updateMany({
        where: { id: deliveryId, businessId, status: 'PICKED_UP' },
        // Driver location is cleared the moment the delivery concludes —
        // no reason to retain a driver's personal location after the fact.
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          driverLat: null,
          driverLng: null,
          driverLocationUpdatedAt: null,
        },
      })
      if (updateResult.count === 0) {
        const latest = await tx.orderDelivery.findUniqueOrThrow({ where: { id: deliveryId } })
        if (latest.status === 'DELIVERED') return latest
        throw new Error(`This delivery must be picked up first (currently ${latest.status.toLowerCase()}).`)
      }

      const order = await tx.order.findUnique({ where: { id: delivery.orderId }, include: { items: true } })
      if (order) {
        await completeDeliveredOrder(tx, businessId, order, staffId)
      }
      if (confirmation) {
        await tx.orderDeliveryCode.updateMany({ where: { orderDeliveryId: deliveryId, businessId }, data: confirmation })
      }

      return tx.orderDelivery.findUniqueOrThrow({ where: { id: deliveryId } })
    },
    { timeout: 15_000, maxWait: 10_000 },
  )
}

/**
 * Records the driver's current position — only while the delivery is
 * actually PICKED_UP (an ASSIGNED-but-not-yet-collected or already-finished
 * delivery has no business receiving location pings). Throws
 * DELIVERY_NOT_ACTIVE when the conditional update matches nothing, which
 * the caller (the location-ping API route) uses to tell the driver's
 * browser to stop polling rather than retrying forever.
 */
export async function recordDriverLocation(
  businessId: string,
  deliveryId: string,
  lat: number,
  lng: number,
): Promise<void> {
  const result = await prisma.orderDelivery.updateMany({
    where: { id: deliveryId, businessId, status: 'PICKED_UP' },
    data: { driverLat: lat, driverLng: lng, driverLocationUpdatedAt: new Date() },
  })
  if (result.count === 0) throw new Error('DELIVERY_NOT_ACTIVE')
}

const FAILURE_ELIGIBLE_STATUSES = ['ASSIGNED', 'PICKED_UP']

export async function reportFailure(businessId: string, deliveryId: string, reason: string) {
  const trimmedReason = reason.trim()
  if (!trimmedReason) throw new Error('A failure reason is required.')

  const current = await prisma.orderDelivery.findFirst({ where: { id: deliveryId, businessId } })
  if (!current) throw new Error('Delivery not found')
  if (!FAILURE_ELIGIBLE_STATUSES.includes(current.status)) {
    throw new Error(`Cannot report a failure once a delivery is ${current.status.toLowerCase()}.`)
  }

  // Never touches Order.status — a failed delivery is a manager-visible
  // exception (the Problems section), not an automatic cancellation. What
  // happens next is an explicit, separate manual decision.
  const failed = await prisma.orderDelivery.update({
    where: { id: deliveryId },
    // Driver location is cleared the moment the delivery concludes — same
    // reasoning as markDelivered.
    data: {
      status: 'FAILED',
      failedAt: new Date(),
      failureReason: trimmedReason,
      driverLat: null,
      driverLng: null,
      driverLocationUpdatedAt: null,
    },
  })
  await prisma.businessNotification
    .create({ data: { businessId, type: 'delivery_failed', title: 'Delivery problem', message: `A delivery could not be completed: ${trimmedReason}`, data: { orderId: current.orderId } } })
    .catch(() => undefined)
  return failed
}

// ---------------------------------------------------------------------------
// Driver's own view — privacy-shaped, never a full Order/Membership fetch
// trimmed in the component
// ---------------------------------------------------------------------------

/** Active deliveries assigned to this driver only — never another driver's, never business-wide. */
export async function listMyDeliveries(businessId: string, driverStaffId: string) {
  const rows = await prisma.orderDelivery.findMany({
    where: { businessId, driverStaffId, status: { in: ['ASSIGNED', 'PICKED_UP'] } },
    orderBy: { assignedAt: 'asc' },
    select: {
      id: true,
      status: true,
      deliveryAddressSnapshot: true,
      deliveryInstructions: true,
      contactPhone: true,
      // Whether "Delivered" needs the customer's code — the code itself is never selected.
      customerKeyHash: true,
      dropoffCode: { select: { failures: true, confirmedAt: true } },
      order: {
        select: {
          orderNumber: true,
          status: true,
          items: { select: { name: true, quantity: true } },
          membership: { select: { displayName: true } },
        },
      },
    },
  })
  return rows.map(({ customerKeyHash, dropoffCode, ...d }) => ({
    ...d,
    needsCode: Boolean(customerKeyHash && dropoffCode && !dropoffCode.confirmedAt),
    codeLocked: Boolean(dropoffCode && !dropoffCode.confirmedAt && dropoffCode.failures >= MAX_CODE_FAILURES),
  }))
}

/**
 * Completed history — deliberately returns LESS than the active view:
 * nothing here needs to re-contact a customer about a finished delivery,
 * so contactPhone/deliveryInstructions/items are never selected at all.
 */
export async function listMyCompletedDeliveries(businessId: string, driverStaffId: string, limit = 20) {
  return prisma.orderDelivery.findMany({
    where: { businessId, driverStaffId, status: { in: ['DELIVERED', 'FAILED'] } },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      status: true,
      deliveredAt: true,
      failedAt: true,
      failureReason: true,
      order: { select: { orderNumber: true } },
    },
  })
}
