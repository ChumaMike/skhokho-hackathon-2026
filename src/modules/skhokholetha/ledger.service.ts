/**
 * Driver earnings ledger — append-only and reconcilable. There is no balance
 * field anywhere: a balance is the SUM of entries. Every entry has a unique
 * `sourceKey`, so the same event can never be paid twice (a retried delivery
 * completion hits the unique constraint and changes nothing).
 *
 *   DELIVERY_EARNING  PENDING (hold window) → AVAILABLE → PAID (via a payout)
 *   ADJUSTMENT        admin correction, positive or negative
 *   Payouts are admin-controlled: REQUESTED → PAID | FAILED.
 */

import { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { TX_OPTIONS } from './tx'

/** Earnings wait this long before they can be paid out (time to raise a dispute). */
export const EARNING_HOLD_MS = 24 * 60 * 60 * 1000

export class LedgerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LedgerError'
  }
}

export function earningSourceKey(networkDeliveryId: string): string {
  return `delivery-earning:${networkDeliveryId}`
}

/**
 * Records a delivery's earning, inside the completion transaction. Uses
 * ON CONFLICT DO NOTHING on the unique source key: exactly one earning per
 * delivery however many times completion is retried. Returns whether this
 * call created it.
 */
export async function recordDeliveryEarning(
  tx: Prisma.TransactionClient,
  input: { driverId: string; networkDeliveryId: string; amountCents: number; now: Date },
): Promise<boolean> {
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0) throw new LedgerError('Earning must be whole, non-negative cents.')
  const inserted = await tx.$executeRaw`
    INSERT INTO "driver_ledger_entries"
      ("id", "driver_id", "network_delivery_id", "type", "status", "amount_cents", "source_key", "available_at", "created_at")
    VALUES
      (${`dle_${randomUUID()}`}, ${input.driverId}, ${input.networkDeliveryId}, 'DELIVERY_EARNING'::"DriverLedgerType",
       'PENDING'::"DriverLedgerStatus", ${input.amountCents}, ${earningSourceKey(input.networkDeliveryId)},
       ${new Date(input.now.getTime() + EARNING_HOLD_MS)}, ${input.now})
    ON CONFLICT ("source_key") DO NOTHING`
  return inserted === 1
}

/**
 * Moves earnings past their hold window to AVAILABLE. The daily cron sweeps
 * everyone; the driver's own page releases just theirs so a balance never
 * shows "pending" for longer than the hold.
 */
export async function releaseDueEarnings(now: Date = new Date(), driverId?: string): Promise<number> {
  const released = await prisma.driverLedgerEntry.updateMany({
    where: { status: 'PENDING', availableAt: { lte: now }, ...(driverId ? { driverId } : {}) },
    data: { status: 'AVAILABLE' },
  })
  return released.count
}

export interface DriverBalance {
  pendingCents: number
  availableCents: number
  inPayoutCents: number
  paidCents: number
}

export async function getDriverBalance(driverId: string): Promise<DriverBalance> {
  const rows = await prisma.driverLedgerEntry.groupBy({ by: ['status'], where: { driverId, payoutId: null }, _sum: { amountCents: true } })
  const sum = (s: string) => rows.find((r) => r.status === s)?._sum.amountCents ?? 0
  const inPayout = await prisma.driverLedgerEntry.aggregate({ where: { driverId, payoutId: { not: null }, status: 'AVAILABLE' }, _sum: { amountCents: true } })
  const paid = await prisma.driverLedgerEntry.aggregate({ where: { driverId, status: 'PAID' }, _sum: { amountCents: true } })
  return {
    pendingCents: sum('PENDING'),
    availableCents: sum('AVAILABLE'),
    inPayoutCents: inPayout._sum.amountCents ?? 0,
    paidCents: paid._sum.amountCents ?? 0,
  }
}

export async function listDriverLedger(driverId: string, take = 50) {
  return prisma.driverLedgerEntry.findMany({
    where: { driverId },
    orderBy: { createdAt: 'desc' },
    take,
    select: { id: true, type: true, status: true, amountCents: true, createdAt: true, availableAt: true, networkDeliveryId: true },
  })
}

/**
 * Admin correction — the ONLY way to change a driver's balance by hand: a new
 * ledger entry (never an edit), carrying who, why and an external reference.
 * Its own unique source key, so a double-submitted form adds it once.
 */
export async function addLedgerAdjustment(
  adminId: string,
  driverId: string,
  input: { amountCents: number; reason: string; reference: string; idempotencyKey: string },
) {
  if (!Number.isInteger(input.amountCents) || input.amountCents === 0) throw new LedgerError('Adjustment must be a non-zero whole number of cents.')
  if (Math.abs(input.amountCents) > 500_000) throw new LedgerError('Adjustments over R 5 000 need a second process — not allowed here.')
  if (input.reason.trim().length < 5) throw new LedgerError('Explain the adjustment.')
  if (!input.reference.trim()) throw new LedgerError('Give a reference (ticket or bank reference).')
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.idempotencyKey)) throw new LedgerError('Invalid request.')
  const driver = await prisma.driverProfile.findUnique({ where: { id: driverId }, select: { id: true } })
  if (!driver) throw new LedgerError('Driver not found.')
  const sourceKey = `adjustment:${input.idempotencyKey}`
  return prisma.driverLedgerEntry.upsert({
    where: { sourceKey },
    update: {},
    create: {
      driverId,
      type: 'ADJUSTMENT',
      status: 'AVAILABLE',
      amountCents: input.amountCents,
      sourceKey,
      availableAt: new Date(),
      createdBy: adminId,
      reason: input.reason.trim().slice(0, 500),
      reference: input.reference.trim().slice(0, 100),
    },
  })
}

/**
 * Admin creates a payout of everything AVAILABLE and not yet in a payout.
 * Entries are claimed with a conditional update, so two simultaneous payout
 * requests can never include the same entry.
 */
export async function createDriverPayout(adminId: string, driverId: string) {
  return prisma.$transaction(
    async (tx) => {
      const candidates = await tx.driverLedgerEntry.findMany({ where: { driverId, status: 'AVAILABLE', payoutId: null }, select: { id: true, amountCents: true } })
      const total = candidates.reduce((s, e) => s + e.amountCents, 0)
      if (candidates.length === 0 || total <= 0) throw new LedgerError('Nothing available to pay out.')
      const payout = await tx.driverPayout.create({ data: { driverId, amountCents: total, createdBy: adminId } })
      const claimed = await tx.driverLedgerEntry.updateMany({
        where: { id: { in: candidates.map((c) => c.id) }, status: 'AVAILABLE', payoutId: null },
        data: { payoutId: payout.id },
      })
      if (claimed.count !== candidates.length) throw new LedgerError('Earnings changed while preparing the payout — try again.')
      return payout
    },
    { timeout: 15_000, maxWait: 10_000 },
  )
}

export async function markPayoutPaid(adminId: string, payoutId: string, reference: string, now: Date = new Date()) {
  if (!reference.trim()) throw new LedgerError('Enter the bank payment reference.')
  await prisma.$transaction(async (tx) => {
    const updated = await tx.driverPayout.updateMany({ where: { id: payoutId, status: 'REQUESTED' }, data: { status: 'PAID', paidAt: now, reference: reference.slice(0, 100) } })
    if (updated.count === 0) throw new LedgerError('Only a requested payout can be marked paid.')
    await tx.driverLedgerEntry.updateMany({ where: { payoutId, status: 'AVAILABLE' }, data: { status: 'PAID' } })
  }, TX_OPTIONS)
}

/** A failed bank payment releases the entries back to AVAILABLE for the next payout. */
export async function markPayoutFailed(adminId: string, payoutId: string, reason: string) {
  await prisma.$transaction(async (tx) => {
    const updated = await tx.driverPayout.updateMany({ where: { id: payoutId, status: 'REQUESTED' }, data: { status: 'FAILED', reference: reason.slice(0, 100) } })
    if (updated.count === 0) throw new LedgerError('Only a requested payout can be marked failed.')
    await tx.driverLedgerEntry.updateMany({ where: { payoutId, status: 'AVAILABLE' }, data: { payoutId: null } })
  }, TX_OPTIONS)
}

export async function listPayouts(status?: 'REQUESTED' | 'PAID' | 'FAILED') {
  return prisma.driverPayout.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, amountCents: true, status: true, reference: true, createdAt: true, paidAt: true, driver: { select: { id: true, displayName: true, payoutBankName: true, payoutAccountLast4: true } } },
  })
}
