/**
 * Refund-due workflow — closing the loop on a REFUND_DUE attempt.
 *
 * payment-attempt.service.ts records that real money arrived which could
 * not be applied to an order (REFUND_DUE) and tells the merchant. The refund
 * itself happens in the merchant's own PayFast dashboard — Skhokho never
 * held the money — so what this module records is the merchant's (or a
 * FINANCE admin's) statement that it was done: who, when, why, and the
 * PayFast refund reference. A separate row rather than a new status value,
 * so the attempt stays immutable and a rollback can still read it.
 *
 *   still owed  = status REFUND_DUE and no payment_refund_resolutions row
 *   resolved    = status REFUND_DUE with one
 */

import { prisma } from '@/lib/prisma/client'

export class RefundResolutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RefundResolutionError'
  }
}

export const MIN_REFUND_REASON_LENGTH = 5
const MAX_REASON = 500
const MAX_REF = 100

export interface RefundActor {
  type: 'staff' | 'platform_admin'
  id: string
}

export interface OpenRefund {
  attemptId: string
  reference: string
  orderId: string | null
  orderNumber: string | null
  expectedAmount: string
  providerPaymentId: string | null
  reason: string | null
  verifiedAt: Date | null
  environment: 'SANDBOX' | 'LIVE'
}

/** Money this business still owes a customer, oldest first. */
export async function listOpenRefunds(businessId: string): Promise<OpenRefund[]> {
  const rows = await prisma.businessPaymentAttempt.findMany({
    where: { businessId, status: 'REFUND_DUE', refundResolution: null },
    orderBy: { verifiedAt: 'asc' },
    select: {
      id: true,
      reference: true,
      orderId: true,
      expectedAmount: true,
      providerPaymentId: true,
      failureReason: true,
      verifiedAt: true,
      environment: true,
      order: { select: { orderNumber: true } },
    },
  })
  return rows.map((r) => ({
    attemptId: r.id,
    reference: r.reference,
    orderId: r.orderId,
    orderNumber: r.order?.orderNumber ?? null,
    // Decimal(10,2) prints "100" for R100.00 — normalise so money always carries its cents.
    expectedAmount: Number(r.expectedAmount).toFixed(2),
    providerPaymentId: r.providerPaymentId,
    reason: r.failureReason,
    verifiedAt: r.verifiedAt,
    environment: r.environment,
  }))
}

export async function countOpenRefunds(businessId: string): Promise<number> {
  return prisma.businessPaymentAttempt.count({ where: { businessId, status: 'REFUND_DUE', refundResolution: null } })
}

/**
 * Records the refund as done. The attempt must belong to `businessId` and
 * be REFUND_DUE; the primary key makes a second resolution impossible, so a
 * double submit (or two people resolving the same refund) is reported, not
 * silently absorbed. Never changes the attempt row itself.
 */
export async function markRefundResolved(
  businessId: string,
  attemptId: string,
  input: { reason: string; providerRefundRef?: string | null; actor: RefundActor },
): Promise<{ attemptId: string; resolvedAt: Date }> {
  const reason = input.reason.trim()
  if (reason.length < MIN_REFUND_REASON_LENGTH) {
    throw new RefundResolutionError(`Say what happened in at least ${MIN_REFUND_REASON_LENGTH} characters — it goes on the record.`)
  }
  const providerRefundRef = input.providerRefundRef?.trim().slice(0, MAX_REF) || null

  const attempt = await prisma.businessPaymentAttempt.findFirst({
    where: { id: attemptId, businessId },
    select: { status: true, refundResolution: { select: { resolvedAt: true } } },
  })
  if (!attempt) throw new RefundResolutionError('That payment was not found.')
  if (attempt.status !== 'REFUND_DUE') throw new RefundResolutionError('That payment is not waiting for a refund.')
  if (attempt.refundResolution) throw new RefundResolutionError('That refund was already marked as done.')

  try {
    const row = await prisma.paymentRefundResolution.create({
      data: {
        attemptId,
        businessId,
        resolvedByType: input.actor.type,
        resolvedById: input.actor.id,
        reason: reason.slice(0, MAX_REASON),
        providerRefundRef,
      },
      select: { attemptId: true, resolvedAt: true },
    })
    return row
  } catch (e) {
    if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
      throw new RefundResolutionError('That refund was already marked as done.')
    }
    throw e
  }
}
