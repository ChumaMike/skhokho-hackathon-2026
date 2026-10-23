import { randomBytes } from 'node:crypto'
import type { PaymentAttemptPurpose, PaymentAttemptStatus, PaymentEnvironment, PaymentEventOutcome, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { loadCredentials } from './payment-connection.service'
import type { PayfastCredentials } from '@/lib/payfast'
import { formatZAR } from '@/lib/utils'

/**
 * One handoff to the payment provider.
 *
 * An attempt is created at the moment a customer is actually sent to pay, and
 * never for an order settled in person. It is immutable in everything that
 * identifies it — reference, connection, merchant, amount — so a notification
 * arriving minutes or days later can be attributed to exactly the submission
 * that produced it, whatever has changed since.
 *
 * This is why the provider reference is per-attempt rather than per-order.
 * An order may be abandoned, retried and paid; with one reference per order
 * those are indistinguishable, and a late notification for the abandoned
 * first try would be applied to the successful third.
 */

/** Opaque and unguessable. Comfortably inside PayFast's m_payment_id length. */
function mintReference(): string {
  return `skh_${randomBytes(16).toString('hex')}`
}

export interface CreateAttemptInput {
  /** Null only for a verification attempt, which proves an account rather than paying for anything. */
  orderId: string | null
  amount: number
  purpose?: PaymentAttemptPurpose
}

export interface PreparedAttempt {
  id: string
  reference: string
  environment: PaymentEnvironment
  credentials: PayfastCredentials
}

/**
 * Creates an attempt against the business's own active connection and returns
 * it along with the credentials to sign the submission with.
 *
 * The connection is resolved from `businessId` — the order's authoritative
 * business relationship — never from anything the customer submitted. The
 * merchant id is copied onto the attempt as it is used, so the receiving
 * account stays knowable after a rotation.
 */
export async function createAttempt(
  businessId: string,
  environment: PaymentEnvironment,
  input: CreateAttemptInput,
): Promise<PreparedAttempt> {
  const connection = await prisma.businessPaymentConnection.findFirst({
    where: { businessId, provider: 'PAYFAST', environment, retiredAt: null },
    select: { id: true, merchantId: true, status: true, environment: true },
  })
  if (!connection) {
    throw new Error('This business has no payment account connected.')
  }
  // Belt and braces behind resolveCheckoutPayment: nothing unproven takes money.
  if (connection.status !== 'VERIFIED' && input.purpose !== 'LIVE_VERIFICATION') {
    throw new Error('This business\'s payment account has not been verified yet.')
  }

  const attempt = await prisma.businessPaymentAttempt.create({
    data: {
      reference: mintReference(),
      orderId: input.orderId,
      businessId,
      connectionId: connection.id,
      purpose: input.purpose ?? 'CUSTOMER_ORDER',
      provider: 'PAYFAST',
      environment: connection.environment,
      merchantIdSnapshot: connection.merchantId,
      expectedAmount: input.amount.toFixed(2),
      status: 'CREATED',
    },
    select: { id: true, reference: true, environment: true },
  })

  return {
    id: attempt.id,
    reference: attempt.reference,
    environment: attempt.environment,
    credentials: await loadCredentials(connection.id),
  }
}

export async function markAttemptSubmitted(attemptId: string): Promise<void> {
  await prisma.businessPaymentAttempt.updateMany({
    where: { id: attemptId, status: 'CREATED' },
    data: { status: 'SUBMITTED', submittedAt: new Date() },
  })
}

/** Still waiting on the provider. */
const OPEN_STATUSES = ['CREATED', 'SUBMITTED'] as const
/**
 * Closed WITHOUT money — by the provider (FAILED/CANCELLED) or by us
 * (EXPIRED, order cancelled, paid in person). A later verified COMPLETE can
 * still arrive for these: the customer may have paid in a tab we'd given up
 * on. That money is real, so it is still recorded, never dropped.
 */
const CLOSED_WITHOUT_MONEY = ['FAILED', 'CANCELLED', 'EXPIRED'] as const
/** The provider confirmed money for these — they never change again. */
const MONEY_RECEIVED = ['COMPLETE', 'REFUND_DUE'] as const

/** What a notification must be checked against. Loaded via the attempt, never via the notification. */
export interface ResolvedAttempt {
  id: string
  reference: string
  businessId: string
  connectionId: string
  environment: PaymentEnvironment
  purpose: PaymentAttemptPurpose
  merchantIdSnapshot: string
  expectedAmount: string
  currency: string
  status: PaymentAttemptStatus
  /** COMPLETE or REFUND_DUE: the provider already confirmed money for this attempt. */
  moneyReceived: boolean
  /** The provider payment already recorded on this attempt, if any. */
  providerPaymentId: string | null
  orderId: string | null
}

/**
 * Resolves a notification's reference to the attempt that produced it.
 *
 * Deliberately the only entry point for an inbound notification. Looking a
 * connection up from the notification's own merchant_id would let anyone
 * holding one merchant's credentials settle another merchant's order; going
 * through the attempt means the receiving account is decided by what we
 * submitted, not by what arrived.
 *
 * Note it resolves the connection even when SUPERSEDED, which is what keeps a
 * payment verifiable across a credential rotation or a disconnect.
 */
export async function resolveAttemptByReference(reference: string): Promise<ResolvedAttempt | null> {
  const row = await prisma.businessPaymentAttempt.findUnique({
    where: { reference },
    select: {
      id: true,
      reference: true,
      businessId: true,
      connectionId: true,
      environment: true,
      purpose: true,
      merchantIdSnapshot: true,
      expectedAmount: true,
      currency: true,
      status: true,
      providerPaymentId: true,
      orderId: true,
    },
  })
  if (!row) return null

  return {
    ...row,
    expectedAmount: row.expectedAmount.toString(),
    moneyReceived: (MONEY_RECEIVED as readonly string[]).includes(row.status),
  }
}

export type SettleResult =
  | { outcome: 'settled' }
  /** This attempt already has its money recorded — a repeat notification. */
  | { outcome: 'already-settled' }
  /**
   * Real money arrived but cannot be applied to the order. Recorded on the
   * attempt as REFUND_DUE with the reason, for the merchant to refund.
   */
  | { outcome: 'refund-due'; reason: string }

export const REFUND_REASONS = {
  amount: 'The amount paid does not match the amount due.',
  alreadyPaid: 'This order was already paid by another payment.',
  cancelled: 'This order was cancelled before the payment arrived.',
} as const

/** Internal: forces the settling transaction to roll back, then becomes refund-due. */
class NotApplicableError extends Error {}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002'
}

/**
 * The provider payment id is already recorded on some attempt: this exact
 * payment has been counted. Distinct from the one-COMPLETE-per-order race,
 * which means a DIFFERENT payment is owed back.
 */
function isProviderPaymentAlreadyRecorded(e: unknown): boolean {
  return isUniqueViolation(e) && JSON.stringify((e as { meta?: unknown }).meta ?? '').includes('provider_payment_id')
}

async function markRefundDue(
  db: Prisma.TransactionClient,
  attemptId: string,
  providerPaymentId: string,
  reason: string,
): Promise<boolean> {
  const updated = await db.businessPaymentAttempt.updateMany({
    where: { id: attemptId, status: { in: [...OPEN_STATUSES, ...CLOSED_WITHOUT_MONEY] } },
    data: { status: 'REFUND_DUE', providerPaymentId, verifiedAt: new Date(), failureReason: reason },
  })
  return updated.count > 0
}

/**
 * Applies a VERIFIED provider payment to its attempt and order together, or
 * records it as refund-due — never neither. The caller must already have
 * checked signature, merchant, provider postback and currency.
 *
 * Payment state only: fulfilment (Order.status) is never advanced here, and
 * a CANCELLED order is never revived by a late payment.
 *
 * Both writes are conditional updates inside one transaction, so two
 * notifications arriving at once cannot both decide the order was payable.
 * The partial unique index "one COMPLETE attempt per order" is the last line
 * of defence; tripping it also lands as refund-due rather than an error.
 */
export async function settleAttempt(
  attemptId: string,
  providerPaymentId: string,
  options: { amountMatches: boolean },
): Promise<SettleResult> {
  try {
    return await prisma.$transaction(
      async (tx): Promise<SettleResult> => {
        const attempt = await tx.businessPaymentAttempt.findUniqueOrThrow({
          where: { id: attemptId },
          select: { orderId: true, businessId: true, status: true },
        })
        if ((MONEY_RECEIVED as readonly string[]).includes(attempt.status)) return { outcome: 'already-settled' }

        let reason: string | null = options.amountMatches ? null : REFUND_REASONS.amount
        if (!reason && attempt.orderId) {
          const order = await tx.order.findFirst({
            where: { id: attempt.orderId, businessId: attempt.businessId },
            select: { paymentStatus: true, status: true },
          })
          if (!order || order.paymentStatus !== 'PENDING') reason = REFUND_REASONS.alreadyPaid
          else if (order.status === 'CANCELLED') reason = REFUND_REASONS.cancelled
        }
        if (reason) {
          return (await markRefundDue(tx, attemptId, providerPaymentId, reason))
            ? { outcome: 'refund-due', reason }
            : { outcome: 'already-settled' }
        }

        const claimed = await tx.businessPaymentAttempt.updateMany({
          where: { id: attemptId, status: { in: [...OPEN_STATUSES, ...CLOSED_WITHOUT_MONEY] } },
          data: { status: 'COMPLETE', providerPaymentId, verifiedAt: new Date(), failureReason: null },
        })
        if (claimed.count === 0) return { outcome: 'already-settled' }

        if (attempt.orderId) {
          const paid = await tx.order.updateMany({
            where: {
              id: attempt.orderId,
              businessId: attempt.businessId,
              paymentStatus: 'PENDING',
              status: { not: 'CANCELLED' },
            },
            data: { paymentStatus: 'PAID', paidAt: new Date(), paymentRef: providerPaymentId },
          })
          // Another payment (or a cancellation) landed between the read above
          // and this write. Roll back this attempt's COMPLETE too.
          if (paid.count === 0) throw new NotApplicableError(REFUND_REASONS.alreadyPaid)
        }

        return { outcome: 'settled' }
      },
      // Concurrent notifications for one attempt genuinely contend for this
      // row — that contention is what makes the outcome safe. Neon's pooled
      // connections need room to queue for it rather than giving up.
      { timeout: 15_000, maxWait: 10_000 },
    )
  } catch (e) {
    if (isProviderPaymentAlreadyRecorded(e)) {
      console.error('[payments] provider payment', providerPaymentId, 'is already recorded on another attempt — not counting it twice')
      return { outcome: 'already-settled' }
    }
    if (e instanceof NotApplicableError || isUniqueViolation(e)) {
      const reason = e instanceof NotApplicableError ? e.message : REFUND_REASONS.alreadyPaid
      try {
        return (await markRefundDue(prisma, attemptId, providerPaymentId, reason))
          ? { outcome: 'refund-due', reason }
          : { outcome: 'already-settled' }
      } catch (inner) {
        if (isProviderPaymentAlreadyRecorded(inner)) return { outcome: 'already-settled' }
        throw inner
      }
    }
    throw e
  }
}

/** A notification that reports a non-successful outcome, or a customer who walked away. */
export async function closeAttempt(
  attemptId: string,
  status: 'FAILED' | 'CANCELLED' | 'EXPIRED',
  reason?: string,
): Promise<void> {
  await prisma.businessPaymentAttempt.updateMany({
    // Only ever closes an attempt still waiting — never one with money recorded.
    where: { id: attemptId, status: { in: [...OPEN_STATUSES] } },
    data: { status, failureReason: reason?.slice(0, 300) },
  })
}

/**
 * Stops every still-open attempt for an order — the order was cancelled, or
 * paid another way. Changes neither the order's payment nor its fulfilment
 * state. If the customer still completes payment in an open tab, the
 * verified notification lands as refund-due.
 */
export async function closeOpenAttemptsForOrder(
  db: Prisma.TransactionClient,
  businessId: string,
  orderId: string,
  reason: string,
): Promise<number> {
  const closed = await db.businessPaymentAttempt.updateMany({
    where: { businessId, orderId, status: { in: [...OPEN_STATUSES] } },
    data: { status: 'CANCELLED', failureReason: reason.slice(0, 300) },
  })
  return closed.count
}

/** How long a payment handoff stays open before it's tidied away as EXPIRED. */
export const ATTEMPT_TTL_MS = 2 * 60 * 60 * 1000
/** Open handoffs one order may have at once — a reload loop can't mint rows without limit. */
export const MAX_OPEN_ATTEMPTS_PER_ORDER = 5

/**
 * Expires this order's open attempts older than the TTL, then reports how
 * many are still open. Expiry is bookkeeping only: a verified payment that
 * arrives later for an expired attempt is still recorded.
 */
export async function expireStaleAttemptsForOrder(businessId: string, orderId: string, now = new Date()): Promise<number> {
  await prisma.businessPaymentAttempt.updateMany({
    where: {
      businessId,
      orderId,
      status: { in: [...OPEN_STATUSES] },
      createdAt: { lt: new Date(now.getTime() - ATTEMPT_TTL_MS) },
    },
    data: { status: 'EXPIRED', failureReason: 'No payment notification within the payment window.' },
  })
  return prisma.businessPaymentAttempt.count({ where: { businessId, orderId, status: { in: [...OPEN_STATUSES] } } })
}

export interface PaymentEventInput {
  attempt: Pick<ResolvedAttempt, 'id' | 'businessId' | 'environment'>
  providerPaymentId: string
  providerStatus: string
  amountGross: string | null
  outcome: PaymentEventOutcome
  detail?: string
}

function moneyOrNull(raw: string | null): string | null {
  return raw && Number.isFinite(Number(raw)) ? Number(raw).toFixed(2) : null
}

/**
 * Appends one VERIFIED notification to the reconciliation trail. A gateway
 * retry of the same notification records nothing new (unique key). Never
 * throws: losing a log row must not turn a processed payment into a failure.
 */
export async function recordPaymentEvent(input: PaymentEventInput): Promise<void> {
  try {
    await prisma.businessPaymentEvent.createMany({
      data: [
        {
          businessId: input.attempt.businessId,
          attemptId: input.attempt.id,
          provider: 'PAYFAST',
          environment: input.attempt.environment,
          providerPaymentId: input.providerPaymentId,
          providerStatus: input.providerStatus.slice(0, 40),
          amountGross: moneyOrNull(input.amountGross),
          outcome: input.outcome,
          detail: input.detail?.slice(0, 300),
        },
      ],
      skipDuplicates: true,
    })
  } catch (e) {
    console.error('[payments] could not record payment event for attempt', input.attempt.id, e)
  }
}

/**
 * Tells the merchant, in the dashboard, that they hold a customer's money
 * that must go back. Best-effort, never throws.
 */
export async function notifyRefundDue(
  businessId: string,
  details: { orderId: string | null; providerPaymentId: string; amountGross: string | null; reason: string },
): Promise<void> {
  try {
    const order = details.orderId
      ? await prisma.order.findFirst({ where: { id: details.orderId, businessId }, select: { orderNumber: true } })
      : null
    const amount = moneyOrNull(details.amountGross)
    await prisma.businessNotification.create({
      data: {
        businessId,
        type: 'PAYMENT_REFUND_DUE',
        title: 'A customer payment needs a refund',
        message:
          `${amount ? formatZAR(Number(amount)) : 'A payment'}${order ? ` for order ${order.orderNumber}` : ''} ` +
          `reached your PayFast account but couldn't be applied. ${details.reason} ` +
          `Please refund it from PayFast (payment ${details.providerPaymentId}).`,
        data: { orderId: details.orderId, providerPaymentId: details.providerPaymentId } as Prisma.InputJsonValue,
      },
    })
  } catch (e) {
    console.error('[payments] could not create refund-due notification for business', businessId, e)
  }
}

/* ---------------------------------------------------------------------------
 * Reconciliation — payments we never heard back about
 * ------------------------------------------------------------------------ */

export interface ReconcileResult {
  expired: number
  businessesNotified: number
}

/**
 * The safety net under the notification handler. An attempt the customer was
 * sent to PayFast with, but that never got ANY notification within the
 * payment window, is uncertain: the customer may have walked away, or paid
 * while every notification failed and PayFast stopped retrying.
 *
 * Without a provider query API, the honest action is:
 *   - expire the attempt (bookkeeping only — a notification that still
 *     arrives later is verified and recorded exactly as normal, because
 *     EXPIRED attempts can still settle);
 *   - tell the merchant, once per run, which customer orders are still
 *     unpaid with an unconfirmed PayFast reference, so a customer who says
 *     "I paid" can be checked against their PayFast account.
 * Verification payments are expired but never notified as customer orders.
 */
export async function reconcileUnconfirmedAttempts(now = new Date()): Promise<ReconcileResult> {
  const cutoff = new Date(now.getTime() - ATTEMPT_TTL_MS)
  const stale = await prisma.businessPaymentAttempt.findMany({
    where: { status: 'SUBMITTED', submittedAt: { lt: cutoff }, providerPaymentId: null },
    select: {
      id: true,
      businessId: true,
      reference: true,
      purpose: true,
      expectedAmount: true,
      order: { select: { orderNumber: true, paymentStatus: true, status: true } },
    },
    orderBy: { submittedAt: 'asc' },
    take: 500,
  })

  const toCheck = new Map<string, { orderNumber: string; amount: string; reference: string }[]>()
  let expired = 0
  for (const a of stale) {
    const claimed = await prisma.businessPaymentAttempt.updateMany({
      where: { id: a.id, status: 'SUBMITTED' },
      data: { status: 'EXPIRED', failureReason: 'PayFast never confirmed this payment — check the reference in PayFast.' },
    })
    if (claimed.count === 0) continue
    expired += 1
    const stillUnpaid = a.order && a.order.paymentStatus === 'PENDING' && a.order.status !== 'CANCELLED'
    if (a.purpose === 'CUSTOMER_ORDER' && stillUnpaid) {
      const list = toCheck.get(a.businessId) ?? []
      list.push({ orderNumber: a.order!.orderNumber, amount: formatZAR(Number(a.expectedAmount)), reference: a.reference })
      toCheck.set(a.businessId, list)
    }
  }

  for (const [businessId, items] of toCheck) {
    try {
      const shown = items.slice(0, 5).map((i) => `order ${i.orderNumber} (${i.amount}, reference ${i.reference})`).join('; ')
      const more = items.length > 5 ? `, and ${items.length - 5} more` : ''
      await prisma.businessNotification.create({
        data: {
          businessId,
          type: 'PAYMENT_UNCONFIRMED',
          title: items.length === 1 ? 'An online payment to check' : `${items.length} online payments to check`,
          message:
            `PayFast never confirmed ${items.length === 1 ? 'this payment' : 'these payments'}: ${shown}${more}. ` +
            `Usually the customer just didn't finish paying. If a customer says they did pay, look up the reference in your PayFast account before handing over the order.`,
          data: { references: items.map((i) => i.reference) } as Prisma.InputJsonValue,
        },
      })
    } catch (e) {
      console.error('[payments] could not create unconfirmed-payment notification for business', businessId, e)
    }
  }

  return { expired, businessesNotified: toCheck.size }
}
