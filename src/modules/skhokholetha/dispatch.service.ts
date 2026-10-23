/**
 * Dispatch V1 — simple and correct, no optimisation.
 *
 *   SEARCHING → nearest eligible ONLINE drivers (fresh location, within their
 *   radius and the platform radius) → up to OFFERS_PER_ROUND time-limited
 *   offers → OFFERED → one ACCEPT wins → ASSIGNED.
 *   Offers expire; when none are left the delivery goes back to SEARCHING and
 *   the next round skips everyone already offered.
 *
 * Progress is driven by `tickDispatch` — there is no queue in this stack.
 * Request paths (driver offer polling, the shop's deliveries page) call
 * `maybeTickDispatch`, which runs at most one tick per DISPATCH_TICK_SECONDS
 * across ALL instances (a shared counter in Postgres), so a thousand polling
 * drivers still cause one tick every few seconds, not a thousand. The daily
 * cron calls `tickDispatch` directly as a backstop. A SEARCHING delivery with
 * nobody nearby is retried at most every REDISPATCH_BACKOFF_MS. Every offer
 * is kept, so dispatch can be reconstructed afterwards.
 * See docs/skhokholetha.md "Dispatch load" for the path to job-driven dispatch.
 *
 * Before assignment a driver sees only what they need to decide: the shop's
 * name and area, distances and the earning — never the customer's address
 * or phone.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { TX_OPTIONS } from './tx'
import { checkRateLimits } from '@/lib/rate-limit'
import { recordDeliveryEvent } from './events'
import { operatingEligibility, STALE_LOCATION_MS } from './driver.service'
import { lethaEnabled, requireLetha } from './flags'
import { notifyCustomerOrderStatus } from '@/modules/orders/customer-notifications'
import { driverLegalConfig } from './legal'
import { haversineMeters, NETWORK_PRICING } from './pricing'
import { transitionFor } from './state-machine'
import { log, errorFields } from '@/lib/log'
import { systemEvent } from '@/modules/platform-admin/audit'

export const OFFER_TTL_MS = 90 * 1000
export const OFFERS_PER_ROUND = 3
/** A searching delivery that found nobody isn't re-scanned more often than this. */
export const REDISPATCH_BACKOFF_MS = 15 * 1000
/** Request-triggered ticks run at most once per this many seconds, platform-wide. */
export const DISPATCH_TICK_SECONDS = 5
const LEGAL_FIELDS = { agreementVersion: true, agreementAcceptedAt: true, privacyVersion: true, privacyAcceptedAt: true } as const

export class OfferUnavailableError extends Error {
  constructor(message = 'This delivery has already been taken or the offer has ended.') {
    super(message)
    this.name = 'OfferUnavailableError'
  }
}

/** One dispatch round for a SEARCHING delivery. Returns how many offers went out. */
export async function runDispatch(deliveryId: string, now: Date = new Date()): Promise<number> {
  // Switched off: nothing new is offered (accepted deliveries carry on).
  if (!lethaEnabled('network')) return 0
  // Claim this round (and record it for the backoff) — a concurrent caller
  // that loses this conditional update skips the candidate scan entirely.
  const claimed = await prisma.networkDelivery.updateMany({
    where: { id: deliveryId, status: 'SEARCHING', OR: [{ dispatchAttemptAt: null }, { dispatchAttemptAt: { lt: new Date(now.getTime() - 1000) } }] },
    data: { dispatchAttemptAt: now },
  })
  if (claimed.count === 0) return 0
  const d = await prisma.networkDelivery.findUnique({
    where: { id: deliveryId },
    select: { id: true, businessId: true, status: true, pickupLat: true, pickupLng: true, offers: { select: { driverId: true } } },
  })
  if (!d || d.status !== 'SEARCHING') return 0
  const alreadyOffered = d.offers.map((o) => o.driverId)

  const candidates = await prisma.driverProfile.findMany({
    where: {
      verificationStatus: 'APPROVED',
      availability: 'ONLINE',
      locationConsentAt: { not: null },
      lastLocationAt: { gte: new Date(now.getTime() - STALE_LOCATION_MS) },
      lastLat: { not: null },
      lastLng: { not: null },
      id: { notIn: alreadyOffered },
      user: { isActive: true },
    },
    take: 200,
    select: {
      id: true,
      serviceRadiusKm: true,
      lastLat: true,
      lastLng: true,
      verificationStatus: true,
      locationConsentAt: true,
      ...LEGAL_FIELDS,
      vehicles: { select: { type: true, isActive: true } },
      documents: { select: { kind: true, status: true, expiresOn: true, uploadedAt: true } },
    },
  })

  const legal = driverLegalConfig()
  const ranked = candidates
    .filter((c) => operatingEligibility(c, c.vehicles, c.documents, now, legal).eligible)
    .map((c) => ({ id: c.id, meters: haversineMeters({ lat: c.lastLat!, lng: c.lastLng! }, { lat: d.pickupLat, lng: d.pickupLng }), radiusKm: c.serviceRadiusKm }))
    .filter((c) => c.meters <= Math.min(c.radiusKm, NETWORK_PRICING.maxRadiusKm) * 1000)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, OFFERS_PER_ROUND)

  if (ranked.length === 0) return 0

  try {
    await prisma.$transaction(async (tx) => {
      const rule = transitionFor('OFFERS_SENT', 'SEARCHING', 'SYSTEM')
      const moved = await tx.networkDelivery.updateMany({ where: { id: d.id, status: 'SEARCHING' }, data: { status: rule.to } })
      if (moved.count === 0) throw new OfferUnavailableError('Delivery is no longer searching.')
      const expiresAt = new Date(now.getTime() + OFFER_TTL_MS)
      for (const c of ranked) {
        await tx.deliveryOffer.create({ data: { networkDeliveryId: d.id, driverId: c.id, distanceMeters: c.meters, expiresAt } })
        await recordDeliveryEvent(tx, { networkDeliveryId: d.id, businessId: d.businessId, type: 'offer_created', actorType: 'SYSTEM', data: { driverId: c.id, distanceMeters: c.meters, expiresAt: expiresAt.toISOString() } })
      }
      await recordDeliveryEvent(tx, { networkDeliveryId: d.id, businessId: d.businessId, type: rule.event, fromStatus: 'SEARCHING', toStatus: rule.to, actorType: 'SYSTEM', data: { offers: ranked.length } })
    }, TX_OPTIONS)
  } catch (e) {
    // A concurrent round already moved it on — nothing to do.
    if (e instanceof OfferUnavailableError || (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) return 0
    throw e
  }
  return ranked.length
}

/**
 * Housekeeping: expire offers past their time, put deliveries whose offers
 * all ended back to SEARCHING, and run a dispatch round for searching
 * deliveries. Bounded per call; safe to call concurrently (every change is
 * conditional).
 */
export async function tickDispatch(now: Date = new Date(), limit = 25): Promise<{ expired: number; lapsed: number; offered: number }> {
  // 1. Expire due offers in ONE statement. SKIP LOCKED: a concurrent tick (or
  //    an accept holding a row) is simply skipped, never waited on; RETURNING
  //    gives exactly the rows this call changed, so each gets one event.
  const expiredRows = await prisma.$queryRaw<{ id: string; driver_id: string; network_delivery_id: string }[]>`
    UPDATE "delivery_offers" SET "status" = 'EXPIRED'::"DeliveryOfferStatus", "responded_at" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "delivery_offers"
      WHERE "status" = 'PENDING'::"DeliveryOfferStatus" AND "expires_at" <= ${now}
      ORDER BY "expires_at" LIMIT 500
      FOR UPDATE SKIP LOCKED
    ) AND "status" = 'PENDING'::"DeliveryOfferStatus"
    RETURNING "id", "driver_id", "network_delivery_id"`
  if (expiredRows.length) {
    const owners = await prisma.networkDelivery.findMany({ where: { id: { in: [...new Set(expiredRows.map((r) => r.network_delivery_id))] } }, select: { id: true, businessId: true } })
    const businessOf = new Map(owners.map((o) => [o.id, o.businessId]))
    await prisma.deliveryEvent.createMany({
      data: expiredRows.map((r) => ({ networkDeliveryId: r.network_delivery_id, businessId: businessOf.get(r.network_delivery_id)!, type: 'offer_expired', actorType: 'SYSTEM', data: { driverId: r.driver_id } })),
    })
  }

  // 2. OFFERED with no live offer left → back to SEARCHING.
  const stuck = await prisma.networkDelivery.findMany({
    where: { status: 'OFFERED', offers: { none: { status: 'PENDING' } } },
    take: limit,
    select: { id: true, businessId: true },
  })
  let lapsed = 0
  for (const s of stuck) {
    const rule = transitionFor('OFFERS_LAPSED', 'OFFERED', 'SYSTEM')
    const moved = await prisma.$transaction(async (tx) => {
      const r = await tx.networkDelivery.updateMany({ where: { id: s.id, status: 'OFFERED', offers: { none: { status: 'PENDING' } } }, data: { status: rule.to } })
      if (r.count) await recordDeliveryEvent(tx, { networkDeliveryId: s.id, businessId: s.businessId, type: rule.event, fromStatus: 'OFFERED', toStatus: rule.to, actorType: 'SYSTEM' })
      return r.count
    }, TX_OPTIONS)
    lapsed += moved
  }

  // 3. A round for searching deliveries not tried in the last REDISPATCH_BACKOFF_MS
  //    (a delivery that just lapsed is due straight away: its attempt is older).
  let offered = 0
  if (lethaEnabled('network')) {
    const searching = await prisma.networkDelivery.findMany({
      where: { status: 'SEARCHING', OR: [{ dispatchAttemptAt: null }, { dispatchAttemptAt: { lte: new Date(now.getTime() - REDISPATCH_BACKOFF_MS) } }] },
      orderBy: { dispatchAttemptAt: { sort: 'asc', nulls: 'first' } },
      take: limit,
      select: { id: true },
    })
    for (const s of searching) offered += await runDispatch(s.id, now)
  }
  return { expired: expiredRows.length, lapsed, offered }
}

/**
 * The request-path entry point: runs a tick only if no other request (on any
 * instance) ran one in the current DISPATCH_TICK_SECONDS window. Never throws —
 * a failed tick must not break the page or poll that triggered it.
 */
export async function maybeTickDispatch(now: Date = new Date()): Promise<boolean> {
  try {
    const slot = await checkRateLimits([['dispatchTick', 'platform']], now)
    if (!slot.allowed) return false
    await tickDispatch(now, 10)
    return true
  } catch (e) {
    // Must be visible: a tick that keeps failing means no offers go out, and nothing else would say so.
    log('error', 'dispatch.tick_failed', errorFields(e))
    await systemEvent('dispatch_tick_failed', { outcome: 'FAILURE', metadata: errorFields(e) }).catch(() => undefined)
    return false
  }
}

/**
 * ACCEPT — the double-acceptance guard. In ONE transaction, each step a
 * conditional update that must match exactly one row:
 *   1. the offer: PENDING, this driver's, not expired       → ACCEPTED
 *   2. the delivery: SEARCHING/OFFERED with no driver         → ASSIGNED to this driver
 *   3. the driver: APPROVED and ONLINE                        → BUSY
 * If any step matches nothing the whole transaction rolls back. Concurrent
 * accepts serialise on the delivery row: the first commits, every other one
 * re-evaluates the WHERE clause, matches nothing and is cleanly refused.
 * The partial unique index (one active delivery per driver) is a second,
 * database-level guarantee.
 */
export async function acceptOffer(driverId: string, offerId: string, now: Date = new Date()) {
  requireLetha('network')
  // Fast refusal without a transaction when the outcome is already decided.
  const pre = await prisma.deliveryOffer.findFirst({
    where: { id: offerId, driverId },
    select: { status: true, expiresAt: true, networkDelivery: { select: { driverId: true, status: true } } },
  })
  if (!pre || pre.status !== 'PENDING' || pre.expiresAt <= now || pre.networkDelivery.driverId !== null) throw new OfferUnavailableError()

  try {
    return await prisma.$transaction(
      async (tx) => {
        const offer = await tx.deliveryOffer.findFirst({
          where: { id: offerId, driverId },
          select: { id: true, networkDeliveryId: true, networkDelivery: { select: { businessId: true, status: true, orderId: true } } },
        })
        if (!offer) throw new OfferUnavailableError()

        // Every accept for this delivery queues on its row FIRST, so concurrent
        // accepts never take locks in different orders (no deadlocks).
        // NOWAIT: if another driver is mid-accept, this one is refused at once
        // (a clean "taken") instead of queueing behind them.
        await tx.$queryRaw`SELECT "id" FROM "network_deliveries" WHERE "id" = ${offer.networkDeliveryId} FOR UPDATE NOWAIT`
        const current = await tx.networkDelivery.findUniqueOrThrow({ where: { id: offer.networkDeliveryId }, select: { status: true, driverId: true } })
        if (current.driverId !== null || (current.status !== 'SEARCHING' && current.status !== 'OFFERED')) throw new OfferUnavailableError()

        const claimedOffer = await tx.deliveryOffer.updateMany({
          where: { id: offerId, driverId, status: 'PENDING', expiresAt: { gt: now } },
          data: { status: 'ACCEPTED', respondedAt: now },
        })
        if (claimedOffer.count !== 1) throw new OfferUnavailableError()

        // Eligibility re-checked at the moment of acceptance.
        const driver = await tx.driverProfile.findUniqueOrThrow({
          where: { id: driverId },
          select: {
            verificationStatus: true,
            locationConsentAt: true,
            availability: true,
            ...LEGAL_FIELDS,
            user: { select: { isActive: true } },
            vehicles: { select: { type: true, isActive: true } },
            documents: { select: { kind: true, status: true, expiresOn: true, uploadedAt: true } },
          },
        })
        if (!driver.user.isActive || !operatingEligibility(driver, driver.vehicles, driver.documents, now).eligible) {
          throw new OfferUnavailableError("You're not able to take deliveries right now.")
        }

        const rule = transitionFor('ACCEPT', current.status, 'DRIVER')
        const claimedDelivery = await tx.networkDelivery.updateMany({
          where: { id: offer.networkDeliveryId, status: { in: ['SEARCHING', 'OFFERED'] }, driverId: null },
          data: { status: rule.to, driverId, assignedAt: now },
        })
        if (claimedDelivery.count !== 1) throw new OfferUnavailableError()

        const busy = await tx.driverProfile.updateMany({
          where: { id: driverId, verificationStatus: 'APPROVED', availability: 'ONLINE' },
          data: { availability: 'BUSY' },
        })
        if (busy.count !== 1) throw new OfferUnavailableError("You're not online.")

        // Everyone else's offers for this delivery, and this driver's other offers, end now.
        await tx.deliveryOffer.updateMany({ where: { networkDeliveryId: offer.networkDeliveryId, status: 'PENDING' }, data: { status: 'WITHDRAWN', respondedAt: now } })
        await tx.deliveryOffer.updateMany({ where: { driverId, status: 'PENDING' }, data: { status: 'WITHDRAWN', respondedAt: now } })

        await recordDeliveryEvent(tx, { networkDeliveryId: offer.networkDeliveryId, businessId: offer.networkDelivery.businessId, type: 'offer_accepted', actorType: 'DRIVER', actorId: driverId, data: { offerId } })
        await recordDeliveryEvent(tx, {
          networkDeliveryId: offer.networkDeliveryId,
          businessId: offer.networkDelivery.businessId,
          type: rule.event,
          fromStatus: current.status,
          toStatus: rule.to,
          actorType: 'DRIVER',
          actorId: driverId,
        })
        return { networkDeliveryId: offer.networkDeliveryId, businessId: offer.networkDelivery.businessId, orderId: offer.networkDelivery.orderId }
      },
      { timeout: 15_000, maxWait: 10_000 },
    ).then((r) => {
      // Shop and customer learn a driver is on the way — after the commit, never inside it.
      void prisma.businessNotification.create({ data: { businessId: r.businessId, type: 'delivery_assigned', title: 'Skhokholetha driver assigned', message: 'A network driver accepted the delivery and is heading to you.', data: { orderId: r.orderId } } }).catch(() => undefined)
      void notifyCustomerOrderStatus(r.orderId, 'DRIVER_ASSIGNED')
      return { networkDeliveryId: r.networkDeliveryId, businessId: r.businessId }
    })
  } catch (e) {
    // Unique index (driver already busy), a lock held by another accept (55P03,
    // surfaced as P2010), a serialisation abort, or no connection free in time
    // (P2028): all are clean refusals — the delivery is someone else's or busy.
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002' || e.code === 'P2034') throw new OfferUnavailableError()
      if (e.code === 'P2010' && JSON.stringify(e.meta ?? {}).includes('55P03')) throw new OfferUnavailableError()
      if (e.code === 'P2028') throw new OfferUnavailableError('Lots of drivers are responding right now — try again in a moment.')
    }
    if (e instanceof Error && e.name === 'InvalidTransitionError') throw new OfferUnavailableError()
    throw e
  }
}

export async function declineOffer(driverId: string, offerId: string, now: Date = new Date()): Promise<void> {
  const offer = await prisma.deliveryOffer.findFirst({ where: { id: offerId, driverId }, select: { networkDeliveryId: true, networkDelivery: { select: { businessId: true } } } })
  if (!offer) throw new OfferUnavailableError()
  const done = await prisma.deliveryOffer.updateMany({ where: { id: offerId, driverId, status: 'PENDING' }, data: { status: 'DECLINED', respondedAt: now } })
  if (done.count) {
    await prisma.deliveryEvent.create({ data: { networkDeliveryId: offer.networkDeliveryId, businessId: offer.networkDelivery.businessId, type: 'offer_declined', actorType: 'DRIVER', actorId: driverId } })
  }
}

/** A driver's live offers — enough to decide, nothing about the customer. */
export async function listDriverOffers(driverId: string, now: Date = new Date()) {
  const offers = await prisma.deliveryOffer.findMany({
    where: { driverId, status: 'PENDING', expiresAt: { gt: now } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      expiresAt: true,
      distanceMeters: true,
      networkDelivery: {
        select: {
          distanceMeters: true,
          driverEarningCents: true,
          business: { select: { name: true, suburb: true, city: true } },
        },
      },
    },
  })
  return offers.map((o) => ({
    id: o.id,
    expiresAt: o.expiresAt,
    toPickupMeters: o.distanceMeters,
    tripMeters: o.networkDelivery.distanceMeters,
    earningCents: o.networkDelivery.driverEarningCents,
    shopName: o.networkDelivery.business.name,
    shopArea: o.networkDelivery.business.suburb ?? o.networkDelivery.business.city ?? null,
  }))
}
