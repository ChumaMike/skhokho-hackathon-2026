/**
 * Network deliveries — the shop request, every driver step, completion and
 * the customer's view. Every status change goes through `transitionFor`
 * (state-machine.ts) and is applied as a conditional UPDATE plus one
 * delivery event, in one transaction.
 *
 * Who sees what:
 *   shop      its own deliveries; the pickup code; the driver's name, vehicle
 *             and phone once assigned; a STATUS tracking link it may share.
 *             NEVER the drop-off code — not in any view, link or event.
 *   driver    only deliveries assigned to them; the drop-off address and the
 *             customer's contact number only after assignment. Never a code.
 *   customer  their own delivery page, opened with the customer key that only
 *             they were given at checkout (customer-key.ts): status, ETA, the
 *             driver's first name and vehicle, the driver's position between
 *             pickup and arrival, and the drop-off code to hand over.
 * Proof of delivery therefore needs something only the customer holds: a shop
 * and a driver working together still can't complete a delivery.
 */

import { randomUUID } from 'node:crypto'
import type { NetworkDeliveryStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { TX_OPTIONS } from './tx'
import { allowsNetworkDrivers, getDeliverySettings } from '@/modules/tenant/capabilities'
import { completeDeliveredOrder } from '@/modules/orders/order.service'
import { checkRateLimits } from '@/lib/rate-limit'
import { recordDeliveryEvent } from './events'
import { quoteNetworkDelivery, haversineMeters, type NetworkQuote } from './pricing'
import { codeMatches, deriveCode, deriveTrackingToken, hashTrackingToken, MAX_CODE_FAILURES, newCodeNonce, type CodePurpose } from './codes'
import { CUSTOMER_LIVE_STATUSES, DRIVER_ACTIVE_STATUSES, NOT_YET_COLLECTED, TERMINAL_STATUSES, transitionFor, type DeliveryAction, type DeliveryActorType, type DriverStepAction } from './state-machine'
import { recordDeliveryEarning } from './ledger.service'
import { runDispatch } from './dispatch.service'
import { requireLetha } from './flags'
import { notifyCustomerOrderStatus } from '@/modules/orders/customer-notifications'
import { securityEvent, systemEvent } from '@/modules/platform-admin/audit'
import { log, errorFields } from '@/lib/log'

export const TRACKING_GRACE_MS = 24 * 60 * 60 * 1000
const ELIGIBLE_ORDER_STATUSES = ['CONFIRMED', 'PROCESSING', 'READY'] as const

export class NetworkDeliveryError extends Error {
  constructor(message: string, readonly code: string = 'DELIVERY_ERROR') {
    super(message)
    this.name = 'NetworkDeliveryError'
  }
}

// ---------------------------------------------------------------------------
// Shop: eligibility, quote, request
// ---------------------------------------------------------------------------

interface EligibleOrder {
  orderId: string
  orderNumber: string
  orderDeliveryId: string
  pickup: { lat: number; lng: number }
  dropoff: { lat: number; lng: number }
  quote: NetworkQuote
}

/**
 * Everything that must be true before a network driver can be requested.
 * Always scoped by the caller's own business id.
 */
export async function checkOrderEligibility(businessId: string, orderId: string): Promise<{ ok: true; order: EligibleOrder } | { ok: false; reason: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, businessId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      fulfilmentMethod: true,
      deliveryFee: true,
      delivery: { select: { id: true, status: true, driverStaffId: true, deliveryLat: true, deliveryLng: true, customerKeyHash: true, deliveryFeeCents: true } },
      business: { select: { latitude: true, longitude: true, settings: true, status: true } },
    },
  })
  if (!order) return { ok: false, reason: 'Order not found.' }
  if (order.business.status !== 'ACTIVE') return { ok: false, reason: 'Your shop is not live.' }
  // The shop's own fulfilment setting: "own drivers only" means no network requests.
  if (!allowsNetworkDrivers(order.business)) return { ok: false, reason: 'Skhokholetha is switched off in your fulfilment settings.' }
  if (order.fulfilmentMethod !== 'DELIVERY' || !order.delivery) return { ok: false, reason: 'This is not a delivery order.' }
  if (!(ELIGIBLE_ORDER_STATUSES as readonly string[]).includes(order.status)) return { ok: false, reason: 'Accept the order first — a driver can be requested once it is confirmed.' }
  if (order.paymentStatus !== 'PAID') return { ok: false, reason: 'Only paid orders can go with a Skhokholetha driver.' }
  if (order.delivery.driverStaffId || order.delivery.status !== 'UNASSIGNED') return { ok: false, reason: 'This order already has a driver.' }
  // The customer must hold their own delivery key (online checkout) — it's how
  // they receive the drop-off code without it ever passing through the shop.
  if (!order.delivery.customerKeyHash) return { ok: false, reason: 'Skhokholetha can only deliver online orders, where the customer gets their own delivery code.' }

  const open = await prisma.networkDelivery.findFirst({
    where: { orderDeliveryId: order.delivery.id, status: { notIn: [...TERMINAL_STATUSES] } },
    select: { id: true },
  })
  if (open) return { ok: false, reason: 'A Skhokholetha driver has already been requested for this order.' }

  const pickup = { lat: order.business.latitude as number, lng: order.business.longitude as number }
  const dropoff = { lat: order.delivery.deliveryLat as number, lng: order.delivery.deliveryLng as number }
  // Quote parity: the network cost is based on the exact fee the customer paid
  // (snapshotted at checkout; older orders fall back to the order's own fee).
  const customerFeeCents = order.delivery.deliveryFeeCents ?? Math.round(Number(order.deliveryFee) * 100)
  const quoted = quoteNetworkDelivery({ deliveryEnabled: getDeliverySettings(order.business).enabled, customerFeeCents, pickup, dropoff })
  if (!quoted.ok) return { ok: false, reason: quoted.reason }
  return { ok: true, order: { orderId: order.id, orderNumber: order.orderNumber, orderDeliveryId: order.delivery.id, pickup, dropoff, quote: quoted.quote } }
}

export async function quoteForOrder(businessId: string, orderId: string) {
  const r = await checkOrderEligibility(businessId, orderId)
  if (!r.ok) return r
  const { quoteFeeCents, distanceMeters, customerFeeCents, merchantCostCents } = r.order.quote
  return { ok: true as const, quoteFeeCents, distanceMeters, customerFeeCents, merchantCostCents }
}

/**
 * Requests a driver. Idempotent per (business, requestKey): a double click
 * returns the same delivery. The fee is ALWAYS recomputed server-side; the
 * shop's confirmed amount must equal it (a changed price needs a fresh look).
 */
export async function requestNetworkDelivery(
  actor: { businessId: string; staffId: string },
  input: { orderId: string; requestKey: string; confirmedFeeCents: number },
  now: Date = new Date(),
): Promise<{ deliveryId: string; created: boolean }> {
  requireLetha('deliveryRequests')
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.requestKey)) throw new NetworkDeliveryError('Invalid request.', 'INVALID_REQUEST')
  const existing = await prisma.networkDelivery.findUnique({ where: { businessId_requestKey: { businessId: actor.businessId, requestKey: input.requestKey } }, select: { id: true } })
  if (existing) return { deliveryId: existing.id, created: false }

  const eligibility = await checkOrderEligibility(actor.businessId, input.orderId)
  if (!eligibility.ok) {
    // A double click can land here: the twin request committed between our
    // key lookup and this check, so the order now has an open delivery. If
    // that open delivery is ours (same key), this call is the duplicate —
    // return what won rather than refusing the second tap.
    const twin = await prisma.networkDelivery.findUnique({ where: { businessId_requestKey: { businessId: actor.businessId, requestKey: input.requestKey } }, select: { id: true } })
    if (twin) return { deliveryId: twin.id, created: false }
    throw new NetworkDeliveryError(eligibility.reason, 'NOT_ELIGIBLE')
  }
  const { order } = eligibility
  if (input.confirmedFeeCents !== order.quote.quoteFeeCents) {
    throw new NetworkDeliveryError('The delivery price changed — please check the new price and confirm again.', 'PRICE_CHANGED')
  }

  const id = `nd_${randomUUID()}`
  const trackingNonce = newCodeNonce()
  try {
    await prisma.$transaction(async (tx) => {
      await tx.networkDelivery.create({
        data: {
          id,
          businessId: actor.businessId,
          orderDeliveryId: order.orderDeliveryId,
          orderId: order.orderId,
          requestKey: input.requestKey,
          requestedByStaffId: actor.staffId,
          pickupLat: order.pickup.lat,
          pickupLng: order.pickup.lng,
          dropoffLat: order.dropoff.lat,
          dropoffLng: order.dropoff.lng,
          distanceMeters: order.quote.distanceMeters,
          quoteFeeCents: order.quote.quoteFeeCents,
          platformFeeCents: order.quote.platformFeeCents,
          driverEarningCents: order.quote.driverEarningCents,
          customerFeeCents: order.quote.customerFeeCents,
          merchantCostCents: order.quote.merchantCostCents,
          pricingSnapshot: order.quote.snapshot as unknown as Prisma.InputJsonValue,
          pickupCodeNonce: newCodeNonce(),
          dropoffCodeNonce: newCodeNonce(),
          trackingNonce,
          trackingTokenHash: hashTrackingToken(deriveTrackingToken(id, trackingNonce)),
        },
      })
      await recordDeliveryEvent(tx, { networkDeliveryId: id, businessId: actor.businessId, type: 'delivery_created', toStatus: 'CREATED', actorType: 'SHOP', actorId: actor.staffId, data: { orderNumber: order.orderNumber } })
      await recordDeliveryEvent(tx, { networkDeliveryId: id, businessId: actor.businessId, type: 'quote_generated', actorType: 'SYSTEM', data: { ...order.quote.snapshot, quoteFeeCents: order.quote.quoteFeeCents, distanceMeters: order.quote.distanceMeters } })
      const rule = transitionFor('START_SEARCH', 'CREATED', 'SYSTEM')
      await tx.networkDelivery.update({ where: { id }, data: { status: rule.to, searchingAt: now } })
      await recordDeliveryEvent(tx, { networkDeliveryId: id, businessId: actor.businessId, type: rule.event, fromStatus: 'CREATED', toStatus: rule.to, actorType: 'SYSTEM' })
    }, TX_OPTIONS)
  } catch (e) {
    // A concurrent duplicate (same key, or the one-open-per-order index): return what won.
    if (e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002') {
      const winner = await prisma.networkDelivery.findUnique({ where: { businessId_requestKey: { businessId: actor.businessId, requestKey: input.requestKey } }, select: { id: true } })
      if (winner) return { deliveryId: winner.id, created: false }
      throw new NetworkDeliveryError('A Skhokholetha driver has already been requested for this order.', 'DUPLICATE')
    }
    throw e
  }
  await runDispatch(id, now).catch((e) => console.error('[skhokholetha] dispatch after request failed', id, e instanceof Error ? e.message : e))
  return { deliveryId: id, created: true }
}

/** The shop's view of the network delivery for one of its orders. */
export async function getShopDeliveryView(businessId: string, orderId: string) {
  const d = await prisma.networkDelivery.findFirst({
    where: { businessId, orderId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      quoteFeeCents: true,
      distanceMeters: true,
      pickupCodeNonce: true,
      pickupCodeFailures: true,
      dropoffCodeFailures: true,
      trackingNonce: true,
      createdAt: true,
      endReason: true,
      driver: { select: { displayName: true, phone: true, vehicles: { where: { isActive: true }, select: { type: true, registration: true } } } },
      events: { orderBy: { createdAt: 'asc' }, select: { type: true, createdAt: true, toStatus: true } },
    },
  })
  if (!d) return null
  const pickupCodeVisible = (NOT_YET_COLLECTED as readonly string[]).includes(d.status) || d.status === 'RETURNING'
  return {
    id: d.id,
    status: d.status,
    quoteFeeCents: d.quoteFeeCents,
    distanceMeters: d.distanceMeters,
    pickupCode: pickupCodeVisible ? deriveCode('PICKUP', d.id, d.pickupCodeNonce) : null,
    pickupCodeLocked: d.pickupCodeFailures >= MAX_CODE_FAILURES,
    dropoffCodeLocked: d.dropoffCodeFailures >= MAX_CODE_FAILURES,
    trackingToken: deriveTrackingToken(d.id, d.trackingNonce),
    driver: d.driver
      ? { name: d.driver.displayName, phone: d.driver.phone, vehicle: d.driver.vehicles[0]?.type ?? null, registration: d.driver.vehicles[0]?.registration ?? null }
      : null,
    endReason: d.endReason,
    timeline: d.events.filter((e) => e.toStatus).map((e) => ({ type: e.type, at: e.createdAt })),
  }
}

/** The shop (or support) issues a new code after too many wrong tries. Old code stops working. */
export async function rotateDeliveryCode(businessId: string, actorId: string, deliveryId: string, purpose: CodePurpose) {
  const data = purpose === 'PICKUP' ? { pickupCodeNonce: newCodeNonce(), pickupCodeFailures: 0 } : { dropoffCodeNonce: newCodeNonce(), dropoffCodeFailures: 0 }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.networkDelivery.updateMany({ where: { id: deliveryId, businessId, status: { notIn: [...TERMINAL_STATUSES] } }, data })
    if (updated.count === 0) throw new NetworkDeliveryError('Delivery not found.', 'NOT_FOUND')
    await recordDeliveryEvent(tx, { networkDeliveryId: deliveryId, businessId, type: `${purpose.toLowerCase()}_code_reissued`, actorType: 'SHOP', actorId })
  }, TX_OPTIONS)
}

// ---------------------------------------------------------------------------
// The one transition primitive
// ---------------------------------------------------------------------------

async function loadForTransition(tx: Prisma.TransactionClient, deliveryId: string) {
  return tx.networkDelivery.findUnique({
    where: { id: deliveryId },
    select: { id: true, businessId: true, status: true, driverId: true, orderDeliveryId: true, orderId: true, driverEarningCents: true, pickupCodeNonce: true, dropoffCodeNonce: true, pickupCodeFailures: true, dropoffCodeFailures: true },
  })
}
type Loaded = NonNullable<Awaited<ReturnType<typeof loadForTransition>>>

async function applyTransition(
  tx: Prisma.TransactionClient,
  d: Loaded,
  action: DeliveryAction,
  actor: { type: DeliveryActorType; id: string },
  extra: Prisma.NetworkDeliveryUpdateManyMutationInput = {},
  eventData?: Record<string, unknown>,
): Promise<NetworkDeliveryStatus> {
  const rule = transitionFor(action, d.status, actor.type)
  if (rule.assignedDriverOnly && actor.type === 'DRIVER' && d.driverId !== actor.id) throw new NetworkDeliveryError('This delivery isn’t assigned to you.', 'NOT_YOURS')
  const updated = await tx.networkDelivery.updateMany({
    where: { id: d.id, status: d.status, ...(actor.type === 'DRIVER' && rule.assignedDriverOnly ? { driverId: actor.id } : {}) },
    data: { status: rule.to, ...extra },
  })
  if (updated.count !== 1) throw new NetworkDeliveryError('This delivery changed — refresh and try again.', 'STALE')
  await recordDeliveryEvent(tx, { networkDeliveryId: d.id, businessId: d.businessId, type: rule.event, fromStatus: d.status, toStatus: rule.to, actorType: actor.type, actorId: actor.id, data: eventData })
  return rule.to
}

/** Driver-only access: the delivery must exist AND be assigned to this driver (else "not found" — no enumeration). */
async function driverDelivery(tx: Prisma.TransactionClient, driverId: string, deliveryId: string): Promise<Loaded> {
  const d = await loadForTransition(tx, deliveryId)
  if (!d || d.driverId !== driverId) throw new NetworkDeliveryError('Delivery not found.', 'NOT_FOUND')
  return d
}

async function notifyShop(businessId: string, title: string, message: string, data: Record<string, unknown>) {
  try {
    await prisma.businessNotification.create({ data: { businessId, type: 'SKHOKHOLETHA', title, message, data: data as Prisma.InputJsonValue } })
  } catch (e) {
    // A notification must never undo or block a delivery step — but it must be visible.
    log('error', 'delivery.notification_failed', { businessId, ...errorFields(e) })
    await systemEvent('notification_failed', { outcome: 'FAILURE', businessId, metadata: { channel: 'business_notification', title } })
  }
}

// ---------------------------------------------------------------------------
// Driver steps
// ---------------------------------------------------------------------------

const STEP_TIMESTAMPS: Partial<Record<DriverStepAction, keyof Prisma.NetworkDeliveryUpdateManyMutationInput>> = {
  ARRIVE_PICKUP: 'arrivedPickupAt',
  ARRIVE_DROPOFF: 'arrivedDropoffAt',
}

/** Plain steps (no code, no reason). The action is an enum — never a target status. */
export async function driverStep(driverId: string, deliveryId: string, action: DriverStepAction, now: Date = new Date()) {
  const result = await prisma.$transaction(async (tx) => {
    const d = await driverDelivery(tx, driverId, deliveryId)
    const field = STEP_TIMESTAMPS[action]
    const to = await applyTransition(tx, d, action, { type: 'DRIVER', id: driverId }, field ? { [field]: now } : {})
    return { to, businessId: d.businessId, orderId: d.orderId }
  }, TX_OPTIONS)
  if (action === 'ARRIVE_PICKUP') await notifyShop(result.businessId, 'Your Skhokholetha driver has arrived', 'Give the driver the pickup code from the order.', { orderId: result.orderId })
  return result.to
}

/** Shared code check, OUTSIDE the transition transaction so a wrong guess is always counted. */
async function checkCode(driverId: string, d: Loaded, purpose: CodePurpose, presented: string, now: Date) {
  const limited = await checkRateLimits([['deliveryCodeDriver', driverId]], now)
  if (!limited.allowed) throw new NetworkDeliveryError('Too many code attempts. Wait a few minutes.', 'RATE_LIMITED')
  const failures = purpose === 'PICKUP' ? d.pickupCodeFailures : d.dropoffCodeFailures
  if (failures >= MAX_CODE_FAILURES) throw new NetworkDeliveryError(purpose === 'PICKUP' ? 'Too many wrong codes — ask the shop for a new pickup code.' : 'Too many wrong codes — ask the customer to contact the shop for a new code.', 'CODE_LOCKED')
  const nonce = purpose === 'PICKUP' ? d.pickupCodeNonce : d.dropoffCodeNonce
  if (codeMatches(purpose, d.id, nonce, presented)) return
  await prisma.networkDelivery.update({
    where: { id: d.id },
    data: purpose === 'PICKUP' ? { pickupCodeFailures: { increment: 1 } } : { dropoffCodeFailures: { increment: 1 } },
  })
  await prisma.deliveryEvent.create({ data: { networkDeliveryId: d.id, businessId: d.businessId, type: `${purpose.toLowerCase()}_code_rejected`, actorType: 'DRIVER', actorId: driverId, data: { attempt: failures + 1 } } })
  // The lock moment is a security signal (guessing, or a shop+driver trying to skip the customer).
  if (failures + 1 >= MAX_CODE_FAILURES) {
    await securityEvent('delivery_code_locked', { outcome: 'DENIED', actor: { type: 'driver', id: driverId }, businessId: d.businessId, resource: { type: 'network_delivery', id: d.id }, metadata: { purpose } })
  }
  throw new NetworkDeliveryError("That code isn't right. Check it with the " + (purpose === 'PICKUP' ? 'shop.' : 'customer.'), 'CODE_WRONG')
}

/** Pickup: only the assigned driver, only at ARRIVED_PICKUP, only with the shop's code. */
export async function confirmPickup(driverId: string, deliveryId: string, code: string, now: Date = new Date()) {
  const d = await driverDelivery(prisma, driverId, deliveryId)
  transitionFor('CONFIRM_PICKUP', d.status, 'DRIVER')
  await checkCode(driverId, d, 'PICKUP', code, now)
  await prisma.$transaction(async (tx) => {
    const fresh = await driverDelivery(tx, driverId, deliveryId)
    await applyTransition(tx, fresh, 'CONFIRM_PICKUP', { type: 'DRIVER', id: driverId }, { pickedUpAt: now })
    await tx.orderDelivery.updateMany({ where: { id: fresh.orderDeliveryId, status: { in: ['UNASSIGNED', 'ASSIGNED'] } }, data: { status: 'PICKED_UP', pickedUpAt: now } })
  }, TX_OPTIONS)
  await notifyShop(d.businessId, 'Order collected', 'Your Skhokholetha driver has collected the order.', { orderId: d.orderId })
  void notifyCustomerOrderStatus(d.orderId, 'OUT_FOR_DELIVERY')
}

/**
 * Delivery: only the assigned driver, only at ARRIVED_DROPOFF, only with the
 * customer's code. Idempotent — a retry after success returns success and
 * creates nothing (the earning has a unique source key; the transition is
 * conditional on ARRIVED_DROPOFF).
 */
export async function confirmDelivery(driverId: string, deliveryId: string, code: string, now: Date = new Date()): Promise<{ alreadyDelivered: boolean }> {
  const d = await driverDelivery(prisma, driverId, deliveryId)
  if (d.status === 'DELIVERED') return { alreadyDelivered: true }
  transitionFor('CONFIRM_DELIVERY', d.status, 'DRIVER')
  await checkCode(driverId, d, 'DROPOFF', code, now)
  try {
    await prisma.$transaction(
      async (tx) => {
        const fresh = await driverDelivery(tx, driverId, deliveryId)
        if (fresh.status === 'DELIVERED') return
        await applyTransition(tx, fresh, 'CONFIRM_DELIVERY', { type: 'DRIVER', id: driverId }, {
          deliveredAt: now,
          endedAt: now,
          trackingExpiresAt: new Date(now.getTime() + TRACKING_GRACE_MS),
          driverLat: null,
          driverLng: null,
          driverLocationAt: null,
        })
        const created = await recordDeliveryEarning(tx, { driverId, networkDeliveryId: fresh.id, amountCents: fresh.driverEarningCents, now })
        if (created) await recordDeliveryEvent(tx, { networkDeliveryId: fresh.id, businessId: fresh.businessId, type: 'earning_created', actorType: 'SYSTEM', data: { driverId, amountCents: fresh.driverEarningCents } })
        await tx.driverProfile.updateMany({ where: { id: driverId, availability: 'BUSY' }, data: { availability: 'ONLINE' } })
        // The order is fulfilled — same completion as an in-house delivery.
        await tx.orderDelivery.updateMany({ where: { id: fresh.orderDeliveryId }, data: { status: 'DELIVERED', deliveredAt: now } })
        const order = await tx.order.findUnique({ where: { id: fresh.orderId }, include: { items: true } })
        if (order) await completeDeliveredOrder(tx, fresh.businessId, order)
      },
      { timeout: 15_000, maxWait: 10_000 },
    )
  } catch (e) {
    // Lost a race with our own retry: if it's delivered now, that's success.
    const latest = await prisma.networkDelivery.findUnique({ where: { id: deliveryId }, select: { status: true, driverId: true } })
    if (latest?.status === 'DELIVERED' && latest.driverId === driverId) return { alreadyDelivered: true }
    throw e
  }
  await notifyShop(d.businessId, 'Order delivered', 'Your Skhokholetha driver has delivered the order.', { orderId: d.orderId })
  void notifyCustomerOrderStatus(d.orderId, 'DELIVERED')
  return { alreadyDelivered: false }
}

/** After pickup something went wrong: the goods must come back to the shop. */
export async function failDelivery(driverId: string, deliveryId: string, reason: string, now: Date = new Date()) {
  const why = reason.trim().slice(0, 300)
  if (!why) throw new NetworkDeliveryError('Say what went wrong.', 'REASON_REQUIRED')
  const d = await prisma.$transaction(async (tx) => {
    const d = await driverDelivery(tx, driverId, deliveryId)
    await applyTransition(tx, d, 'FAIL', { type: 'DRIVER', id: driverId }, { endReason: why, driverLat: null, driverLng: null, driverLocationAt: null }, { reason: why })
    await tx.orderDelivery.updateMany({ where: { id: d.orderDeliveryId }, data: { status: 'FAILED', failedAt: now, failureReason: why } })
    return d
  }, TX_OPTIONS)
  await notifyShop(d.businessId, 'Delivery failed', `The driver couldn't complete the delivery: ${why}. The order will be brought back to you.`, { orderId: d.orderId })
}

/** The goods are back at the shop: confirmed with the shop's pickup code. */
export async function confirmReturn(driverId: string, deliveryId: string, code: string, now: Date = new Date()) {
  const d = await driverDelivery(prisma, driverId, deliveryId)
  transitionFor('CONFIRM_RETURN', d.status, 'DRIVER')
  await checkCode(driverId, d, 'PICKUP', code, now)
  await prisma.$transaction(async (tx) => {
    const fresh = await driverDelivery(tx, driverId, deliveryId)
    await applyTransition(tx, fresh, 'CONFIRM_RETURN', { type: 'DRIVER', id: driverId }, { endedAt: now, trackingExpiresAt: new Date(now.getTime() + TRACKING_GRACE_MS) })
    await tx.driverProfile.updateMany({ where: { id: driverId, availability: 'BUSY' }, data: { availability: 'ONLINE' } })
  }, TX_OPTIONS)
}

// ---------------------------------------------------------------------------
// Shop / admin interventions
// ---------------------------------------------------------------------------

/** Cancel before pickup. Frees the driver and withdraws offers. */
export async function cancelNetworkDelivery(actor: { type: 'SHOP' | 'ADMIN'; id: string; businessId?: string }, deliveryId: string, reason: string, now: Date = new Date()) {
  const why = reason.trim().slice(0, 300)
  if (!why) throw new NetworkDeliveryError('Give a reason.', 'REASON_REQUIRED')
  const result = await prisma.$transaction(async (tx) => {
    const d = await loadForTransition(tx, deliveryId)
    if (!d || (actor.type === 'SHOP' && d.businessId !== actor.businessId)) throw new NetworkDeliveryError('Delivery not found.', 'NOT_FOUND')
    await applyTransition(tx, d, 'CANCEL', { type: actor.type, id: actor.id }, { endedAt: now, endReason: why, trackingExpiresAt: new Date(now.getTime() + TRACKING_GRACE_MS) }, { reason: why })
    await tx.deliveryOffer.updateMany({ where: { networkDeliveryId: d.id, status: 'PENDING' }, data: { status: 'WITHDRAWN', respondedAt: now } })
    if (d.driverId) await tx.driverProfile.updateMany({ where: { id: d.driverId, availability: 'BUSY' }, data: { availability: 'ONLINE' } })
    if (actor.type === 'ADMIN') await recordDeliveryEvent(tx, { networkDeliveryId: d.id, businessId: d.businessId, type: 'admin_intervention', actorType: 'ADMIN', actorId: actor.id, data: { action: 'CANCEL' } })
    return d
  }, TX_OPTIONS)
  if (actor.type === 'ADMIN') await notifyShop(result.businessId, 'Delivery cancelled by Skhokho', why, { orderId: result.orderId })
}

export async function openDispute(adminId: string, deliveryId: string, reason: string) {
  const why = reason.trim().slice(0, 300)
  if (!why) throw new NetworkDeliveryError('Give a reason.', 'REASON_REQUIRED')
  await prisma.$transaction(async (tx) => {
    const d = await loadForTransition(tx, deliveryId)
    if (!d) throw new NetworkDeliveryError('Delivery not found.', 'NOT_FOUND')
    await applyTransition(tx, d, 'DISPUTE', { type: 'ADMIN', id: adminId }, {}, { reason: why })
    await recordDeliveryEvent(tx, { networkDeliveryId: d.id, businessId: d.businessId, type: 'admin_intervention', actorType: 'ADMIN', actorId: adminId, data: { action: 'DISPUTE' } })
  }, TX_OPTIONS)
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** The driver's current delivery — full drop-off details only because it's assigned to them. */
export async function getDriverActiveDelivery(driverId: string) {
  const d = await prisma.networkDelivery.findFirst({
    where: { driverId, status: { in: [...DRIVER_ACTIVE_STATUSES, 'FAILED'] } },
    orderBy: { assignedAt: 'desc' },
    select: {
      id: true,
      status: true,
      driverEarningCents: true,
      distanceMeters: true,
      pickupCodeFailures: true,
      dropoffCodeFailures: true,
      business: { select: { name: true, address: true, suburb: true, city: true, phone: true, latitude: true, longitude: true } },
      orderDelivery: { select: { deliveryAddressSnapshot: true, deliveryInstructions: true, contactPhone: true, order: { select: { orderNumber: true } } } },
    },
  })
  if (!d) return null
  return {
    id: d.id,
    status: d.status,
    earningCents: d.driverEarningCents,
    tripMeters: d.distanceMeters,
    orderNumber: d.orderDelivery.order.orderNumber,
    pickup: { name: d.business.name, address: [d.business.address, d.business.suburb, d.business.city].filter(Boolean).join(', '), phone: d.business.phone },
    dropoff: { address: d.orderDelivery.deliveryAddressSnapshot, instructions: d.orderDelivery.deliveryInstructions, contactPhone: d.orderDelivery.contactPhone },
    pickupCodeLocked: d.pickupCodeFailures >= MAX_CODE_FAILURES,
    dropoffCodeLocked: d.dropoffCodeFailures >= MAX_CODE_FAILURES,
  }
}

const AVERAGE_SPEED_KMH = 25

/**
 * The STATUS tracking view, by the link the shop can share. Unknown or expired
 * tokens give null (one "not found" — never which). The shop holds this
 * token, so it carries NO secret: never the drop-off code.
 */
export async function getTrackingView(token: string, now: Date = new Date()) {
  if (!token || token.length < 20 || token.length > 100) return null
  const d = await prisma.networkDelivery.findUnique({
    where: { trackingTokenHash: hashTrackingToken(token) },
    select: {
      id: true,
      status: true,
      dropoffLat: true,
      dropoffLng: true,
      driverLat: true,
      driverLng: true,
      driverLocationAt: true,
      trackingExpiresAt: true,
      business: { select: { name: true } },
      driver: { select: { displayName: true, vehicles: { where: { isActive: true }, select: { type: true } } } },
    },
  })
  if (!d) return null
  if (d.trackingExpiresAt && d.trackingExpiresAt < now) return null

  return liveView(d, now)
}

type LiveViewInput = {
  status: NetworkDeliveryStatus
  dropoffLat: number
  dropoffLng: number
  driverLat: number | null
  driverLng: number | null
  driverLocationAt: Date | null
  business: { name: string }
  driver: { displayName: string; vehicles: { type: string }[] } | null
}

function liveView(d: LiveViewInput, now: Date) {
  const live = (CUSTOMER_LIVE_STATUSES as readonly string[]).includes(d.status)
  const fresh = d.driverLocationAt && now.getTime() - d.driverLocationAt.getTime() < 2 * 60 * 1000
  const driverPos = live && fresh && d.driverLat != null && d.driverLng != null ? { lat: d.driverLat, lng: d.driverLng } : null
  const etaMinutes = driverPos ? Math.max(1, Math.round((haversineMeters(driverPos, { lat: d.dropoffLat, lng: d.dropoffLng }) * 1.3) / 1000 / AVERAGE_SPEED_KMH * 60)) : null
  return {
    shopName: d.business.name,
    status: d.status,
    driver: d.driver ? { firstName: d.driver.displayName.split(' ')[0], vehicle: d.driver.vehicles[0]?.type ?? null } : null,
    driverPosition: driverPos,
    destination: live ? { lat: d.dropoffLat, lng: d.dropoffLng } : null,
    etaMinutes,
  }
}

/** Statuses in which the customer needs the code to hand over. */
const CODE_VISIBLE_STATUSES: readonly NetworkDeliveryStatus[] = ['ASSIGNED', 'DRIVER_TO_PICKUP', 'ARRIVED_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_DROPOFF']

/**
 * The CUSTOMER's own delivery page, by the key only the customer was given
 * (customer-key.ts). The only place the drop-off code is ever shown.
 * Unknown keys and finished-and-expired deliveries give null.
 */
export async function getCustomerDeliveryView(key: string, now: Date = new Date()) {
  if (!key || key.length < 20 || key.length > 100) return null
  const od = await prisma.orderDelivery.findUnique({
    where: { customerKeyHash: hashTrackingToken(key) },
    select: {
      id: true,
      status: true,
      order: { select: { orderNumber: true } },
      business: { select: { name: true } },
      networkDeliveries: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          status: true,
          dropoffCodeNonce: true,
          dropoffCodeFailures: true,
          dropoffLat: true,
          dropoffLng: true,
          driverLat: true,
          driverLng: true,
          driverLocationAt: true,
          trackingExpiresAt: true,
          business: { select: { name: true } },
          driver: { select: { displayName: true, vehicles: { where: { isActive: true }, select: { type: true } } } },
        },
      },
    },
  })
  if (!od) return null
  const d = od.networkDeliveries[0]
  if (!d) {
    // No Skhokholetha driver: the shop's own driver may be bringing it, with
    // their own proof-of-delivery code (modules/orders/delivery-code.ts).
    const { customerDropoffCodeView } = await import('@/modules/orders/delivery-code')
    const own = await customerDropoffCodeView(od.id)
    return {
      orderNumber: od.order.orderNumber,
      shopName: od.business.name,
      delivery: null,
      ownDelivery: own ? { status: od.status, dropoffCode: own.code, dropoffCodeLocked: own.locked } : null,
    }
  }
  if (d.trackingExpiresAt && d.trackingExpiresAt < now) return null
  const showCode = CODE_VISIBLE_STATUSES.includes(d.status)
  return {
    orderNumber: od.order.orderNumber,
    shopName: od.business.name,
    ownDelivery: null,
    delivery: {
      ...liveView(d, now),
      dropoffCode: showCode ? deriveCode('DROPOFF', d.id, d.dropoffCodeNonce) : null,
      dropoffCodeLocked: d.dropoffCodeFailures >= MAX_CODE_FAILURES,
    },
  }
}
