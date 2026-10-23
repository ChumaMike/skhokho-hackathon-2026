import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { formatZAR } from '@/lib/utils'
import { sendEmail, newOrderEmail } from '@/lib/email'
import { verifyItnSignature, validateWithPayfast } from '@/lib/payfast'
import { securityEvent, systemEvent } from '@/modules/platform-admin/audit'
import { log, errorFields } from '@/lib/log'
import { clientIp } from '@/lib/rate-limit'
import { verifyPayfastSource } from '@/lib/payfast-source'
import {
  resolveAttemptByReference,
  settleAttempt,
  closeAttempt,
  recordPaymentEvent,
  notifyRefundDue,
  type ResolvedAttempt,
} from '@/modules/payments/payment-attempt.service'
import { loadCredentials, markConnectionVerified } from '@/modules/payments/payment-connection.service'

export const runtime = 'nodejs'

/** PayFast settles in rand only; an attempt in anything else can never match a notification. */
const PAYFAST_CURRENCY = 'ZAR'

/**
 * PayFast's server-to-server payment notification (ITN) for MERCHANT-DIRECT
 * payments — a customer paying a business into that business's own PayFast
 * account. (Skhokho's own SaaS billing is a separate flow and never comes
 * through here.)
 *
 * This, and never the customer's browser returning to /store/pay, is what
 * marks an order paid. A browser return proves only that a browser came back.
 *
 * Every notification is resolved through its own immutable payment attempt:
 *
 *   m_payment_id -> attempt -> connection (the account we actually submitted
 *                                          to, even if since rotated/disconnected)
 *                           -> order -> business
 *
 * The connection is NEVER looked up from the notification's own merchant_id.
 * Doing that would let anyone holding one merchant's credentials sign a
 * notification that settles another merchant's order.
 *
 * Verify first, then decide. Nothing is written for a notification that
 * hasn't passed merchant, signature and PayFast's own postback. Once it has,
 * a COMPLETE means money really moved, so it is ALWAYS recorded: applied to
 * the order, or — when it can't be (order already paid, cancelled, wrong
 * amount) — kept as REFUND_DUE with the merchant told to refund. Never
 * silently dropped.
 *
 * Answers:
 *   200  We reached a verdict: settled, refund-due, duplicate, or refused
 *        for good (bad signature, wrong merchant, PayFast says INVALID…).
 *        A retry could not change these, so PayFast must not retry.
 *   503  PayFast's own check-back couldn't be completed (timeout / network).
 *   500  Something on our side failed before the payment was recorded.
 * PayFast retries non-200 answers, so a database hiccup or a slow check-back
 * means "try again" — never a paid order silently left unpaid. Retries are
 * safe: settling is idempotent (one COMPLETE per attempt and per provider
 * payment id). Once the payment IS recorded, a failure in what follows
 * (emails, notifications) is logged and still answered 200 — the money is
 * safe and the reconciliation sweep (reconcileUnconfirmedAttempts) covers
 * anything PayFast stops retrying.
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const params = new URLSearchParams(rawBody)
  // Order is preserved from the wire, and is part of the signature.
  const ordered: [string, string][] = [...params.entries()]
  const get = (key: string) => params.get(key) ?? ''

  const reference = get('m_payment_id')
  // A rejected notification is a security signal (forged, replayed or misrouted): record
  // the reason and our own reference only — never the payload or its signature.
  const reject = (reason: string) => {
    void securityEvent('payment_webhook_rejected', {
      outcome: 'DENIED',
      actor: { type: 'anonymous' },
      resource: { type: 'payment_attempt', id: reference || null },
      metadata: { provider: 'PAYFAST', reason },
      ip: clientIp(req),
      requestId: req.headers.get('x-request-id'),
    })
    return reply(false, reason)
  }
  if (!reference || !get('signature')) {
    return reject('missing fields')
  }

  // 0. Source (Tab 5): the caller must be one of PayFast's own hosts
  //    (payfast-source.ts). Before any database read, so a flood from
  //    elsewhere costs nothing. DNS unavailable → retry, never a refusal.
  const source = await verifyPayfastSource(clientIp(req))
  if (source === 'UNAVAILABLE') return retryLater(503, 'source check unavailable')
  if (source === 'UNTRUSTED') return reject('untrusted source')

  try {
    // 1. Resolve through the attempt — the only entry point.
    const attempt = await resolveAttemptByReference(reference)
    if (!attempt) {
      console.error('[payfast/notify] no attempt for reference', reference)
      return reject('unknown reference')
    }

    // 2. The receiving account must be the one this attempt was submitted to.
    if (get('merchant_id') !== attempt.merchantIdSnapshot) {
      console.error('[payfast/notify] merchant mismatch for', reference, '- notification names a different account than this attempt was sent to')
      return reject('merchant mismatch')
    }

    // 3. Signature, against THIS attempt's connection — including one already
    //    superseded by a rotation or disconnect, which keeps in-flight payments valid.
    const credentials = await loadCredentials(attempt.connectionId)
    if (!verifyItnSignature(ordered, credentials)) {
      console.error('[payfast/notify] signature mismatch for', reference)
      return reject('bad signature')
    }

    // 4. Ask PayFast whether it really sent this, on the host belonging to the
    //    attempt's own environment (sandbox vs live). Fails closed — and an
    //    unanswered check-back is a retry, not a refusal.
    const validation = await validateWithPayfast(rawBody, attempt.environment)
    if (validation === 'UNAVAILABLE') {
      console.error('[payfast/notify] PayFast validate unavailable — asking PayFast to retry', reference)
      return retryLater(503, 'validation unavailable')
    }
    if (validation !== 'VALID') {
      console.error('[payfast/notify] PayFast validate rejected', reference)
      return reject('not validated')
    }

    // 5. Currency. PayFast only settles ZAR, so an attempt in any other
    //    currency can't be the payment this notification describes.
    if (attempt.currency !== PAYFAST_CURRENCY) {
      console.error('[payfast/notify] attempt', reference, 'is in', attempt.currency, '- PayFast settles ZAR only')
      return reject('currency mismatch')
    }

    // 6. Provider transaction identity — what makes a replay recognisable.
    const providerPaymentId = get('pf_payment_id')
    if (!providerPaymentId) {
      return reject('no provider payment id')
    }

    // ---- Verified from here on: record what PayFast told us. ----
    const paymentStatus = get('payment_status')
    const grossRaw = get('amount_gross') || null
    const event = { attempt, providerPaymentId, providerStatus: paymentStatus || 'UNKNOWN', amountGross: grossRaw }

    // 7. This attempt already has its money recorded.
    if (attempt.moneyReceived) {
      if (paymentStatus === 'COMPLETE' && providerPaymentId !== attempt.providerPaymentId) {
        // The SAME reference paid twice — a resubmitted payment form. The
        // first payment stays applied; this second one has to go back.
        const reason = 'A second payment arrived for the same checkout.'
        console.error('[payfast/notify] SECOND PAYMENT on reference', reference, 'provider payment', providerPaymentId)
        await recordPaymentEvent({ ...event, outcome: 'REFUND_DUE', detail: reason })
        await notifyRefundDue(attempt.businessId, { orderId: attempt.orderId, providerPaymentId, amountGross: grossRaw, reason })
        return reply(true, 'refund due')
      }
      // A verification payment whose first notification settled but failed
      // before promoting the connection gets promoted on the retry.
      if (attempt.purpose === 'LIVE_VERIFICATION' && attempt.status === 'COMPLETE' && providerPaymentId === attempt.providerPaymentId) {
        const verified = await markConnectionVerified(attempt.connectionId, attempt.id)
        await recordPaymentEvent({ ...event, outcome: verified ? 'CONNECTION_VERIFIED' : 'DUPLICATE_NOTIFICATION' })
        return NextResponse.json({ ok: true, verified }, { status: 200 })
      }
      await recordPaymentEvent({ ...event, outcome: 'DUPLICATE_NOTIFICATION' })
      return reply(true, 'already processed')
    }

    // 8. Outcome. FAILED and CANCELLED close a still-open attempt without
    //    paying anything; the order stays unpaid and can be retried.
    if (paymentStatus !== 'COMPLETE') {
      if (paymentStatus === 'FAILED' || paymentStatus === 'CANCELLED') {
        await closeAttempt(attempt.id, paymentStatus, `PayFast reported ${paymentStatus}`)
        await recordPaymentEvent({ ...event, outcome: 'CLOSED' })
      } else {
        await recordPaymentEvent({ ...event, outcome: 'IGNORED' })
      }
      return NextResponse.json({ ok: true, ignored: paymentStatus || 'unknown' }, { status: 200 })
    }

    // 9. Amount. A verified COMPLETE with a missing or different amount is
    //    still money that moved — it becomes refund-due, never paid.
    const amountMatches = grossRaw !== null && Number(grossRaw).toFixed(2) === Number(attempt.expectedAmount).toFixed(2)
    if (!amountMatches) {
      console.error('[payfast/notify] amount mismatch', reference, grossRaw, attempt.expectedAmount)
    }

    // 10. Apply to the order, or record as refund-due — one transaction.
    const result = await settleAttempt(attempt.id, providerPaymentId, { amountMatches })

    if (result.outcome === 'already-settled') {
      await recordPaymentEvent({ ...event, outcome: 'DUPLICATE_NOTIFICATION' })
      return reply(true, 'already processed')
    }

    // ---- The money is recorded from here on. ----

    if (result.outcome === 'refund-due') {
      console.error('[payfast/notify] REFUND DUE for', reference, 'provider payment', providerPaymentId, '-', result.reason)
      await afterRecorded(reference, async () => {
        await recordPaymentEvent({ ...event, outcome: 'REFUND_DUE', detail: result.reason })
        await notifyRefundDue(attempt.businessId, { orderId: attempt.orderId, providerPaymentId, amountGross: grossRaw, reason: result.reason })
      })
      return reply(true, 'refund due')
    }

    // A verification attempt proves the account can actually receive money.
    // This is the ONLY thing that promotes a connection to VERIFIED — never
    // the owner having filled in the fields. Part of processing (not a side
    // effect): if it fails, the 500 makes PayFast retry, and the retry
    // promotes the connection via the already-settled branch above.
    if (attempt.purpose === 'LIVE_VERIFICATION') {
      const verified = await markConnectionVerified(attempt.connectionId, attempt.id)
      await afterRecorded(reference, () => recordPaymentEvent({ ...event, outcome: verified ? 'CONNECTION_VERIFIED' : 'SETTLED' }))
      return NextResponse.json({ ok: true, verified }, { status: 200 })
    }

    await afterRecorded(reference, async () => {
      await recordPaymentEvent({ ...event, outcome: 'SETTLED' })
      await notifyOwner(attempt)
    })
    return reply(true)
  } catch (e) {
    // Nothing was recorded (or we can't be sure it was): make PayFast retry.
    // Logged without the error object (Prisma errors can carry query values) and
    // recorded as a SYSTEM event so the health page and alerts can see it.
    log('error', 'payfast.notify.processing_failed', { reference, ...errorFields(e) })
    await systemEvent('payment_notification_processing_failed', { outcome: 'FAILURE', resource: { type: 'payment_attempt_reference', id: reference }, metadata: errorFields(e) }).catch(() => undefined)
    return retryLater(500, 'processing failed')
  }
}

function reply(ok: boolean, reason?: string) {
  return NextResponse.json(reason ? { ok, reason } : { ok }, { status: 200 })
}

/** A non-200 answer: PayFast will send this notification again. */
function retryLater(status: 500 | 503, reason: string) {
  return NextResponse.json({ ok: false, retry: true, reason }, { status })
}

/**
 * Work after the payment is safely recorded (the event trail entry, the
 * owner's notification). Its failure must not turn into a retry request —
 * the money is already applied — so it is logged, not thrown.
 */
async function afterRecorded(reference: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work()
  } catch (e) {
    console.error('[payfast/notify] payment recorded, but follow-up work failed for', reference, e)
  }
}

/**
 * Best-effort. A failed email must never turn a successfully processed
 * payment into a failed webhook response — PayFast would simply retry a call
 * that already did its job.
 */
/** Dashboard notification for a settled online payment — the in-app counterpart of the owner email. Never throws. */
async function notifyPaymentReceived(businessId: string, orderId: string, orderNumber: string, amountFormatted: string) {
  await prisma.businessNotification
    .create({ data: { businessId, type: 'payment_received', title: 'Payment received', message: `Order ${orderNumber} paid online — ${amountFormatted}.`, data: { orderId } } })
    .catch(() => undefined)
}

async function notifyOwner(attempt: Pick<ResolvedAttempt, 'businessId' | 'orderId'>): Promise<void> {
  if (!attempt.orderId) return
  const order = await prisma.order.findFirst({
    where: { id: attempt.orderId, businessId: attempt.businessId },
    select: {
      orderNumber: true,
      total: true,
      business: { select: { name: true, owner: { select: { email: true } } } },
    },
  })
  if (!order) return
  await notifyPaymentReceived(attempt.businessId, attempt.orderId, order.orderNumber, formatZAR(Number(order.total)))
  if (!order.business.owner?.email) return

  const { subject, html } = newOrderEmail({
    businessName: order.business.name,
    orderNumber: order.orderNumber,
    totalFormatted: formatZAR(Number(order.total)),
  })
  sendEmail({ to: order.business.owner.email, subject, html, kind: 'owner_payment_issue' }).catch((e) =>
    console.error('[payfast/notify] owner notification failed:', e),
  )
}
