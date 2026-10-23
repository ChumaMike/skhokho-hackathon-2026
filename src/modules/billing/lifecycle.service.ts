/**
 * Trial, dunning and grace — the clock side of platform billing.
 *
 * The decision logic is deliberately PURE (`noticeStageFor`, `trialPeriod`),
 * so every state transition is unit-testable without a database and without
 * waiting for a date. The database functions below only apply what those
 * decide.
 *
 * Nothing in this module deletes anything. A trial ending, a payment failing
 * and grace expiring all change what a business may *add* and which features
 * resolve — never its products, staff, orders, customers or storefront. See
 * docs/specs/2026-10-21-plans.md §3, §4 and §7.
 */

import { prisma } from '@/lib/prisma/client'
import { formatZAR } from '@/lib/utils'
import { sendEmail, platformBillingEmail, type BillingNoticeStage } from '@/lib/email'
import { recordAudit, systemEvent } from '@/modules/platform-admin/audit'
import { log, errorFields } from '@/lib/log'
import { SUBSCRIPTION_GRACE_DAYS } from './entitlements'
import { markUncollectible, addOneMonth, draftInvoiceForPeriod, NothingToInvoiceError } from './invoice.service'

/** A new business gets 14 days of GROW, no card required (§4). */
export const TRIAL_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

/* ---------------------------------------------------------------------------
 * Trial
 * ------------------------------------------------------------------------ */

export function trialPeriod(now: Date): { start: Date; end: Date } {
  return { start: now, end: new Date(now.getTime() + TRIAL_DAYS * DAY_MS) }
}

export type StartTrialOutcome =
  | { started: true; endsAt: Date }
  | { started: false; reason: 'already_subscribed' | 'already_trialled' | 'no_trial_plan' }

/**
 * Starts the 14-day GROW trial for a newly eligible business.
 *
 * Eligible means: no subscription row at all. A business that has ever had
 * one — trialled, paid, cancelled or expired — is not offered another, which
 * is what stops a trial being an unlimited free plan.
 *
 * No card is taken, and nothing is charged: Phase A cannot take a card at all.
 * At expiry the resolver falls straight back to FREE with NO grace, because
 * grace protects a paying customer whose payment failed and there is nothing
 * to retry at the end of a free trial (see entitlements.subscriptionAccess).
 */
export async function startGrowTrial(businessId: string, now: Date = new Date()): Promise<StartTrialOutcome> {
  const existing = await prisma.businessSubscription.findUnique({
    where: { businessId },
    select: { id: true, status: true },
  })
  if (existing) {
    return { started: false, reason: existing.status === 'TRIALING' ? 'already_trialled' : 'already_subscribed' }
  }

  const plan = await prisma.plan.findUnique({ where: { code: 'GROW' }, select: { id: true } })
  if (!plan) {
    log('error', 'billing.trial_plan_missing', { businessId })
    return { started: false, reason: 'no_trial_plan' }
  }

  const { end } = trialPeriod(now)
  const owner = await prisma.business.findUnique({
    where: { id: businessId },
    select: { owner: { select: { email: true } } },
  })

  await prisma.businessSubscription.create({
    data: {
      businessId,
      planId: plan.id,
      status: 'TRIALING',
      currentPeriodEnd: end,
      // Explicitly no grace: a trial simply ends.
      graceEndsAt: end,
      billingEmail: owner?.owner?.email ?? null,
    },
  })

  await recordAudit({
    category: 'SYSTEM',
    action: 'platform_trial_started',
    actor: { type: 'system' },
    businessId,
    resource: { type: 'business_subscription', id: businessId },
    metadata: { plan: 'GROW', days: TRIAL_DAYS, endsAt: end.toISOString() },
  })

  return { started: true, endsAt: end }
}

/**
 * Marks ended trials EXPIRED.
 *
 * Bookkeeping only — the resolver already treats a trial past its
 * currentPeriodEnd as expired, so access is correct whether or not this has
 * run. Writing the status keeps the stored state honest for the Control Centre
 * and stops the row being re-examined every night.
 */
export async function expireEndedTrials(now: Date = new Date()): Promise<number> {
  const ended = await prisma.businessSubscription.findMany({
    where: { status: 'TRIALING', currentPeriodEnd: { lte: now } },
    select: { businessId: true },
  })
  if (ended.length === 0) return 0

  await prisma.businessSubscription.updateMany({
    where: { status: 'TRIALING', currentPeriodEnd: { lte: now } },
    data: { status: 'EXPIRED' },
  })

  for (const row of ended) {
    await recordAudit({
      category: 'SYSTEM',
      action: 'platform_trial_expired',
      actor: { type: 'system' },
      businessId: row.businessId,
      resource: { type: 'business_subscription', id: row.businessId },
      metadata: { fellBackTo: 'FREE', dataDeleted: false },
    })
  }
  return ended.length
}

/* ---------------------------------------------------------------------------
 * Dunning — pure stage decision
 * ------------------------------------------------------------------------ */

/**
 * The reminder cadence (§7), as whole days relative to the invoice due date:
 *
 *   −3  due_soon        a friendly heads-up
 *    0  due_today
 *   +3  overdue
 *   +7  final_warning   names the date the plan changes
 *  +10  downgraded      grace is over; account moves to FREE
 *
 * Grace therefore runs 10 days from the due date, matching
 * SUBSCRIPTION_GRACE_DAYS, so the Phase B card retries (day 0, 2, 5, 8) all
 * land before it ends.
 */
const STAGES: { stage: BillingNoticeStage; offsetDays: number }[] = [
  { stage: 'due_soon', offsetDays: -3 },
  { stage: 'due_today', offsetDays: 0 },
  { stage: 'overdue', offsetDays: 3 },
  { stage: 'final_warning', offsetDays: 7 },
  { stage: 'downgraded', offsetDays: SUBSCRIPTION_GRACE_DAYS },
]

const STAGE_RANK: Record<string, number> = Object.fromEntries(
  STAGES.map((s, i) => [s.stage, i]),
)

function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS)
}

/**
 * The notice an unpaid invoice is due right now, or null for none.
 *
 * Returns the FURTHEST stage reached rather than an exact day match, and
 * compares it against what was already sent. So a cron run that is late, or
 * one that missed two nights, still sends the right single notice instead of
 * silently skipping it or replaying the whole sequence.
 */
export function noticeStageFor(
  invoice: { dueAt: Date | null; lastNoticeStage: string | null },
  now: Date,
): BillingNoticeStage | null {
  if (!invoice.dueAt) return null
  const elapsed = wholeDaysBetween(invoice.dueAt, now)

  let reached: BillingNoticeStage | null = null
  for (const { stage, offsetDays } of STAGES) {
    if (elapsed >= offsetDays) reached = stage
  }
  if (!reached) return null

  const alreadySent = invoice.lastNoticeStage !== null ? STAGE_RANK[invoice.lastNoticeStage] : undefined
  if (alreadySent !== undefined && alreadySent >= STAGE_RANK[reached]) return null
  return reached
}

/** The day grace ends for an invoice that went unpaid. */
export function graceEndFor(dueAt: Date): Date {
  return new Date(dueAt.getTime() + SUBSCRIPTION_GRACE_DAYS * DAY_MS)
}

/* ---------------------------------------------------------------------------
 * Dunning — applying it
 * ------------------------------------------------------------------------ */

/** Who gets billing mail: billingEmail, falling back to the owner's address. */
async function billingRecipient(businessId: string): Promise<{ email: string | null; name: string }> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      name: true,
      owner: { select: { email: true } },
      subscription: { select: { billingEmail: true } },
    },
  })
  return {
    email: business?.subscription?.billingEmail ?? business?.owner?.email ?? null,
    name: business?.name ?? 'your business',
  }
}

function dateLabel(d: Date): string {
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', timeZone: 'Africa/Johannesburg' })
}

/**
 * Sends one invoice's next notice and applies the state change that goes with
 * it. Returns the stage acted on, or null when nothing was due.
 *
 * Email failure does NOT block the state change: a provider outage must never
 * leave a business in grace forever, nor keep a paid plan running unpaid
 * indefinitely. The send is recorded as attempted and the stage advances.
 */
export async function applyNoticeFor(invoiceId: string, now: Date = new Date()): Promise<BillingNoticeStage | null> {
  const invoice = await prisma.platformInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      businessId: true,
      number: true,
      status: true,
      totalCents: true,
      dueAt: true,
      lastNoticeStage: true,
    },
  })
  if (!invoice || invoice.status !== 'OPEN' || !invoice.dueAt) return null

  const stage = noticeStageFor(invoice, now)
  if (!stage) return null

  const graceEnds = graceEndFor(invoice.dueAt)

  // State changes that belong with each stage.
  if (stage === 'due_today' || stage === 'overdue' || stage === 'final_warning') {
    // Payment is late: the plan holds through grace, which the resolver reads
    // from graceEndsAt. Paid features stay fully on until it passes (§M).
    await prisma.businessSubscription.updateMany({
      where: { businessId: invoice.businessId, status: { in: ['ACTIVE', 'PAST_DUE'] } },
      data: { status: 'PAST_DUE', graceEndsAt: graceEnds },
    })
  }

  if (stage === 'downgraded') {
    await endGraceFor(invoice.businessId, invoice.id, now)
  }

  const { email, name } = await billingRecipient(invoice.businessId)
  if (email && invoice.number) {
    const { subject, html } = platformBillingEmail({
      stage,
      businessName: name,
      invoiceNumber: invoice.number,
      totalFormatted: formatZAR(invoice.totalCents / 100),
      dateLabel: dateLabel(stage === 'downgraded' || stage === 'final_warning' ? graceEnds : invoice.dueAt),
      bankingReference: invoice.number,
    })
    await sendEmail({ to: email, subject, html, kind: 'platform_billing' }).catch((e) =>
      log('error', 'billing.notice_email_failed', { invoiceId, stage, ...errorFields(e) }),
    )
  }

  await prisma.platformInvoice.update({
    where: { id: invoiceId },
    data: { lastNoticeStage: stage, lastNoticeAt: now },
  })

  await prisma.businessNotification
    .create({
      data: {
        businessId: invoice.businessId,
        type: 'platform_billing',
        title: stage === 'downgraded' ? 'Your plan moved to Free' : 'Skhokho invoice',
        message:
          stage === 'downgraded'
            ? 'Your account is on the Free plan. Nothing has been deleted — pay the outstanding invoice and your plan comes back.'
            : `Invoice ${invoice.number} — ${formatZAR(invoice.totalCents / 100)}.`,
        data: { invoiceId, stage },
      },
    })
    .catch(() => undefined)

  return stage
}

/**
 * Grace is over: the subscription resolves to FREE and paid managed services
 * are SUSPENDED.
 *
 * What is explicitly NOT done: no product, service, staff member, order,
 * customer or storefront row is deleted, hidden, archived or deactivated. A
 * business that drops to FREE while over its limits keeps everything and
 * simply cannot add more (modules/billing/limits.ts). Paying revives it all.
 */
export async function endGraceFor(businessId: string, invoiceId: string | null, now: Date = new Date()): Promise<void> {
  await prisma.businessSubscription.updateMany({
    where: { businessId, status: { in: ['ACTIVE', 'PAST_DUE'] } },
    data: { status: 'EXPIRED' },
  })

  // Suspended, never deleted — re-enabling is one row.
  const suspended = await prisma.businessAddon.updateMany({
    where: { businessId, status: 'ACTIVE' },
    data: { status: 'SUSPENDED' },
  })

  if (invoiceId) {
    await markUncollectible(invoiceId, 'Grace period ended without payment.', null)
  }

  await recordAudit({
    category: 'SYSTEM',
    action: 'platform_grace_ended',
    actor: { type: 'system' },
    businessId,
    resource: { type: 'business_subscription', id: businessId },
    metadata: {
      fellBackTo: 'FREE',
      addonsSuspended: suspended.count,
      dataDeleted: false,
      merchantPaymentsAffected: false,
      // The night this grace logically ended, which is not the audit row's own
      // timestamp when a missed sweep catches up days later.
      effectiveAt: now.toISOString(),
    },
  })
}

/* ---------------------------------------------------------------------------
 * The nightly sweep
 * ------------------------------------------------------------------------ */

export interface BillingMaintenanceResult {
  trialsExpired: number
  noticesSent: number
  gracesEnded: number
}

/**
 * One pass of the billing clock, for cron/daily.
 *
 * Each invoice is handled independently: one failing must not stop the rest,
 * so a failure is logged as a SYSTEM event and the sweep continues. Phase A
 * performs NO card retries, because Phase A holds no card.
 */
export async function runBillingMaintenance(now: Date = new Date()): Promise<BillingMaintenanceResult> {
  const trialsExpired = await expireEndedTrials(now)

  const open = await prisma.platformInvoice.findMany({
    where: { status: 'OPEN', dueAt: { not: null } },
    select: { id: true },
    orderBy: { dueAt: 'asc' },
    take: 500,
  })

  let noticesSent = 0
  let gracesEnded = 0
  for (const row of open) {
    try {
      const stage = await applyNoticeFor(row.id, now)
      if (stage) noticesSent += 1
      if (stage === 'downgraded') gracesEnded += 1
    } catch (e) {
      log('error', 'billing.notice_failed', { invoiceId: row.id, ...errorFields(e) })
      await systemEvent('platform_billing_notice_failed', {
        outcome: 'FAILURE',
        resource: { type: 'platform_invoice', id: row.id },
        metadata: errorFields(e),
      }).catch(() => undefined)
    }
  }

  return { trialsExpired, noticesSent, gracesEnded }
}

/**
 * Generates the next period's invoice for every paid subscription whose period
 * ends within a day.
 *
 * Phase A creates the invoice as a DRAFT and does not charge anything — the
 * merchant is invoiced and pays by EFT. Issuing stays gated on the VAT status
 * being confirmed (invoice.service.issueInvoice).
 */
export async function generateRenewalDrafts(now: Date = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + DAY_MS)

  const due = await prisma.businessSubscription.findMany({
    where: { status: { in: ['ACTIVE', 'PAST_DUE'] }, currentPeriodEnd: { not: null, lte: horizon } },
    select: { businessId: true, currentPeriodEnd: true },
    take: 500,
  })

  let created = 0
  for (const sub of due) {
    if (!sub.currentPeriodEnd) continue
    const periodStart = sub.currentPeriodEnd
    const periodEnd = addOneMonth(periodStart, periodStart.getUTCDate())
    try {
      const result = await draftInvoiceForPeriod(sub.businessId, periodStart, periodEnd)
      if (result.created) created += 1
    } catch (e) {
      if (e instanceof NothingToInvoiceError) continue
      log('error', 'billing.renewal_draft_failed', { businessId: sub.businessId, ...errorFields(e) })
    }
  }
  return created
}
