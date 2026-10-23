/**
 * Platform invoicing — Skhokho Laboratory billing a merchant.
 *
 * This module never touches a merchant's own customer payments. Those are
 * Order / BusinessPaymentAttempt / BusinessPaymentConnection, settled into the
 * merchant's OWN PayFast account, and nothing here reads or writes them. The
 * reference namespaces are kept apart too — `skhp_` here, `skh_` there, with a
 * CHECK constraint in the database so application code cannot get it wrong.
 *
 * Phase A takes no card. Settlement is a human recording money that arrived,
 * normally by EFT, which is a permanent first-class method rather than a
 * stop-gap: many South African small businesses will pay an invoice and never
 * put a card on file.
 *
 * Idempotency lives in the database, not here:
 *   - one live invoice per (business, period_start)  → re-running generation is safe
 *   - one live settlement per invoice                → an invoice cannot be paid twice
 * Both are partial unique indexes (migration 20261021120000). Application
 * checks are a courtesy for error messages; the index is the guarantee.
 */

import crypto from 'node:crypto'
import { Prisma, type PlatformInvoiceStatus, type PlatformSettlementMethod } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { recordAudit } from '@/modules/platform-admin/audit'
import { log, errorFields } from '@/lib/log'
import { managedService } from './managed-services'
import { splitInclusive, invoiceIssuingEnabled, InvoiceIssuingBlockedError } from './vat'

/** Terms for an EFT invoice (docs/specs/2026-10-21-plans.md §8). */
export const PAYMENT_TERMS_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * A platform-billing reference. The `skhp_` prefix is what keeps this flow
 * distinguishable from a merchant payment attempt (`skh_`) in logs, in support
 * queries and — once Phase B exists — at the notification endpoint, which will
 * reject the other namespace outright.
 */
export function platformReference(): string {
  return `skhp_${crypto.randomBytes(16).toString('hex')}`
}

/* ---------------------------------------------------------------------------
 * Billing anniversary
 * ------------------------------------------------------------------------ */

/**
 * One month on from `from`, keeping `anchorDay` as the day of the month.
 *
 * The anniversary is the day the merchant activated (§5), so a subscription
 * started on the 31st must not drift to the 28th permanently after passing
 * through February. The anchor day is carried separately and clamped only for
 * months that are too short: 31 Jan → 28 Feb → 31 Mar.
 */
export function addOneMonth(from: Date, anchorDay: number): Date {
  const year = from.getUTCFullYear()
  const month = from.getUTCMonth() + 1
  const daysInTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const day = Math.min(anchorDay, daysInTarget)
  return new Date(
    Date.UTC(year, month, day, from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds()),
  )
}

/** The billing period that starts when a merchant activates. */
export function periodFrom(activatedAt: Date): { periodStart: Date; periodEnd: Date; anchorDay: number } {
  const anchorDay = activatedAt.getUTCDate()
  return { periodStart: activatedAt, periodEnd: addOneMonth(activatedAt, anchorDay), anchorDay }
}

/* ---------------------------------------------------------------------------
 * Invoice numbering — SKHL-INV-YYYY-NNNNNN, reset per calendar year
 * ------------------------------------------------------------------------ */

export function formatInvoiceNumber(year: number, sequence: number): string {
  return `SKHL-INV-${year}-${String(sequence).padStart(6, '0')}`
}

/**
 * Takes the next number for a calendar year, atomically.
 *
 * The INSERT ... ON CONFLICT DO UPDATE ... RETURNING is a single statement, so
 * two concurrent issues serialise on the row and can never be handed the same
 * number. Must be called inside the issuing transaction: if that transaction
 * rolls back, the number is released with it.
 */
export async function allocateInvoiceNumber(tx: Prisma.TransactionClient, now: Date): Promise<string> {
  const year = now.getUTCFullYear()
  const rows = await tx.$queryRaw<{ last_number: number }[]>`
    INSERT INTO "invoice_number_sequences" ("year", "last_number", "updated_at")
    VALUES (${year}, 1, NOW())
    ON CONFLICT ("year") DO UPDATE
      SET "last_number" = "invoice_number_sequences"."last_number" + 1,
          "updated_at" = NOW()
    RETURNING "last_number"
  `
  const sequence = Number(rows[0]?.last_number)
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error('Could not allocate an invoice number')
  }
  return formatInvoiceNumber(year, sequence)
}

/* ---------------------------------------------------------------------------
 * Building a draft
 * ------------------------------------------------------------------------ */

export interface DraftLine {
  kind: 'PLAN' | 'ADDON' | 'SETUP' | 'PRORATION' | 'CREDIT'
  description: string
  quantity: number
  unitCents: number
}

function lineTotal(line: DraftLine): number {
  return line.unitCents * line.quantity
}

/**
 * The lines for one billing period: the plan, then each active managed
 * service's monthly fee, then any setup fee not yet invoiced.
 *
 * A plan with no price (`price_cents` NULL — not yet priced, a deliberate
 * commercial state) contributes no line, so an unpriced plan can never
 * produce an invoice claiming R 0.00 was due.
 */
export async function buildDraftLines(businessId: string): Promise<DraftLine[]> {
  const [subscription, addons] = await Promise.all([
    prisma.businessSubscription.findUnique({
      where: { businessId },
      select: { planRef: { select: { code: true, name: true, priceCents: true } } },
    }),
    prisma.businessAddon.findMany({
      where: { businessId, status: 'ACTIVE' },
      orderBy: { startedAt: 'asc' },
    }),
  ])

  const lines: DraftLine[] = []

  const plan = subscription?.planRef
  if (plan && plan.priceCents !== null && plan.priceCents > 0) {
    lines.push({
      kind: 'PLAN',
      description: `${plan.name} plan — monthly subscription`,
      quantity: 1,
      unitCents: plan.priceCents,
    })
  }

  for (const addon of addons) {
    const service = managedService(addon.serviceSlug)
    const name = service?.name ?? addon.serviceSlug
    if (addon.monthlyCents > 0) {
      lines.push({ kind: 'ADDON', description: `${name} — monthly`, quantity: 1, unitCents: addon.monthlyCents })
    }
    if (!addon.setupInvoiced && addon.setupCents > 0) {
      lines.push({ kind: 'SETUP', description: `${name} — once-off setup`, quantity: 1, unitCents: addon.setupCents })
    }
  }

  return lines
}

export class NothingToInvoiceError extends Error {
  constructor() {
    super('There is nothing to invoice for this period.')
    this.name = 'NothingToInvoiceError'
  }
}

export class InvoiceAlreadyExistsError extends Error {
  constructor(readonly number: string | null) {
    super('An invoice already exists for this billing period.')
    this.name = 'InvoiceAlreadyExistsError'
  }
}

/**
 * Creates a DRAFT invoice for a period. No number is allocated yet — a
 * discarded draft must not burn one and leave a gap in the sequence.
 *
 * Returns the existing invoice rather than throwing when one already covers
 * this period, so a re-run of generation is a no-op (the partial unique index
 * is the real guarantee; this is just the friendly path).
 */
export async function draftInvoiceForPeriod(
  businessId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.platformInvoice.findFirst({
    where: { businessId, periodStart, status: { not: 'VOID' } },
    select: { id: true },
  })
  if (existing) return { id: existing.id, created: false }

  const lines = await buildDraftLines(businessId)
  if (lines.length === 0) throw new NothingToInvoiceError()

  const total = lines.reduce((sum, l) => sum + lineTotal(l), 0)
  const split = splitInclusive(total)
  const planCode = (
    await prisma.businessSubscription.findUnique({
      where: { businessId },
      select: { planRef: { select: { code: true } } },
    })
  )?.planRef?.code

  try {
    const invoice = await prisma.platformInvoice.create({
      data: {
        businessId,
        periodStart,
        periodEnd,
        planCodeSnapshot: planCode ?? null,
        subtotalCents: split.subtotalCents,
        vatCents: split.vatCents,
        totalCents: split.totalCents,
        status: 'DRAFT',
        lines: {
          create: lines.map((l, i) => ({
            kind: l.kind,
            description: l.description,
            quantity: l.quantity,
            unitCents: l.unitCents,
            amountCents: lineTotal(l),
            sortOrder: i,
          })),
        },
      },
      select: { id: true },
    })
    return { id: invoice.id, created: true }
  } catch (e) {
    // The partial unique index fired: another writer created this period's
    // invoice between our check and our insert. That is the index doing its
    // job, not an error worth surfacing.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const raced = await prisma.platformInvoice.findFirst({
        where: { businessId, periodStart, status: { not: 'VOID' } },
        select: { id: true },
      })
      if (raced) return { id: raced.id, created: false }
    }
    throw e
  }
}

/**
 * DRAFT → OPEN: allocates the number, sets the due date, and makes the
 * invoice immutable.
 *
 * Gated on BILLING_TAX_STATUS_CONFIRMED. The VAT status of Skhokho Laboratory
 * is not confirmed, so drafts and previews work while real issuing stays off —
 * a wrongly-worded invoice would have to be credited and reissued.
 */
export async function issueInvoice(
  invoiceId: string,
  options: { now?: Date; adminId?: string | null; force?: boolean } = {},
): Promise<{ number: string; dueAt: Date }> {
  if (!invoiceIssuingEnabled() && !options.force) throw new InvoiceIssuingBlockedError()
  const now = options.now ?? new Date()
  const dueAt = new Date(now.getTime() + PAYMENT_TERMS_DAYS * DAY_MS)

  return prisma.$transaction(async (tx) => {
    const invoice = await tx.platformInvoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, businessId: true, status: true, number: true, totalCents: true },
    })
    if (!invoice) throw new Error('Invoice not found')
    if (invoice.status !== 'DRAFT') {
      if (invoice.number) return { number: invoice.number, dueAt }
      throw new Error(`Cannot issue an invoice that is ${invoice.status}`)
    }

    const number = await allocateInvoiceNumber(tx, now)
    await tx.platformInvoice.update({
      where: { id: invoiceId },
      data: { number, status: 'OPEN', issuedAt: now, dueAt },
    })
    await recordAudit(
      {
        category: 'ADMIN_ACTION',
        action: 'platform_invoice_issued',
        actor: { type: options.adminId ? 'platform_admin' : 'system', id: options.adminId ?? null },
        businessId: invoice.businessId,
        resource: { type: 'platform_invoice', id: invoiceId },
        metadata: { number, totalCents: invoice.totalCents },
      },
      { tx },
    )
    return { number, dueAt }
  })
}

/* ---------------------------------------------------------------------------
 * Settlement — money that actually arrived
 * ------------------------------------------------------------------------ */

export class SettlementRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettlementRefusedError'
  }
}

export interface RecordSettlementInput {
  amountCents: number
  method: PlatformSettlementMethod
  receivedAt: Date
  payerReference?: string | null
  note?: string | null
  adminId: string
}

/**
 * Records money received against an invoice and activates the plan.
 *
 * One transaction, so an invoice can never be marked paid without both the
 * ledger row and the subscription move landing with it. The partial unique
 * index on (invoice_id) WHERE voided_at IS NULL means a double-submit fails at
 * the database rather than paying an invoice twice.
 *
 * The amount must match the invoice exactly: a short payment is a real
 * commercial conversation, not something to silently accept and call paid.
 */
export async function recordSettlement(
  invoiceId: string,
  input: RecordSettlementInput,
): Promise<{ settlementId: string; reference: string; planCode: string | null }> {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.platformInvoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true,
        businessId: true,
        status: true,
        number: true,
        totalCents: true,
        periodEnd: true,
        planCodeSnapshot: true,
      },
    })
    if (!invoice) throw new SettlementRefusedError('Invoice not found.')
    if (invoice.status === 'PAID') throw new SettlementRefusedError('That invoice is already paid.')
    if (invoice.status === 'VOID') throw new SettlementRefusedError('That invoice was cancelled.')
    if (invoice.status === 'DRAFT') throw new SettlementRefusedError('Issue the invoice before recording payment.')
    if (input.amountCents !== invoice.totalCents) {
      throw new SettlementRefusedError(
        `The amount must match the invoice exactly (${invoice.totalCents} cents).`,
      )
    }

    const reference = platformReference()
    const settlement = await tx.platformSettlement.create({
      data: {
        invoiceId,
        businessId: invoice.businessId,
        reference,
        amountCents: input.amountCents,
        method: input.method,
        payerReference: input.payerReference?.trim() || null,
        receivedAt: input.receivedAt,
        recordedByAdminId: input.adminId,
        note: input.note?.trim() || null,
      },
      select: { id: true },
    })

    await tx.platformInvoice.update({
      where: { id: invoiceId },
      data: { status: 'PAID', paidAt: input.receivedAt },
    })

    // Paid access runs to the end of the period this invoice covered. Never
    // writes plan_entitlements — only the subscription's plan and dates. The
    // resolver then decides what that grants, on the next read.
    if (invoice.planCodeSnapshot) {
      const plan = await tx.plan.findUnique({ where: { code: invoice.planCodeSnapshot }, select: { id: true } })
      if (plan) {
        const data = {
          planId: plan.id,
          status: 'ACTIVE' as const,
          currentPeriodEnd: invoice.periodEnd,
          graceEndsAt: null,
          cancelledAt: null,
        }
        await tx.businessSubscription.upsert({
          where: { businessId: invoice.businessId },
          create: { businessId: invoice.businessId, ...data },
          update: data,
        })
      }
    }

    // A setup fee is charged once: mark it invoiced now that it is paid.
    await tx.businessAddon.updateMany({
      where: { businessId: invoice.businessId, status: 'ACTIVE', setupInvoiced: false },
      data: { setupInvoiced: true },
    })

    await recordAudit(
      {
        category: 'ADMIN_ACTION',
        action: 'platform_settlement_recorded',
        actor: { type: 'platform_admin', id: input.adminId },
        businessId: invoice.businessId,
        resource: { type: 'platform_invoice', id: invoiceId },
        metadata: {
          number: invoice.number,
          reference,
          method: input.method,
          amountCents: input.amountCents,
          planCode: invoice.planCodeSnapshot,
        },
      },
      { tx, strict: true },
    )

    return { settlementId: settlement.id, reference, planCode: invoice.planCodeSnapshot }
  })
}

/* ---------------------------------------------------------------------------
 * Closing an invoice without payment
 * ------------------------------------------------------------------------ */

/** Cancels an invoice. Never a delete — it keeps its number, and numbers are never reused. */
export async function voidInvoice(invoiceId: string, reason: string, adminId: string): Promise<void> {
  if (!reason.trim()) throw new Error('A reason is required to cancel an invoice.')
  const invoice = await prisma.platformInvoice.findUnique({
    where: { id: invoiceId },
    select: { businessId: true, status: true, number: true },
  })
  if (!invoice) throw new Error('Invoice not found')
  if (invoice.status === 'PAID') throw new Error('A paid invoice cannot be cancelled — issue a credit instead.')

  await prisma.platformInvoice.update({
    where: { id: invoiceId },
    data: { status: 'VOID', closedReason: reason.trim() },
  })
  await recordAudit({
    category: 'ADMIN_ACTION',
    action: 'platform_invoice_voided',
    actor: { type: 'platform_admin', id: adminId },
    businessId: invoice.businessId,
    resource: { type: 'platform_invoice', id: invoiceId },
    reason,
    metadata: { number: invoice.number },
  })
}

/**
 * Gives up on collecting. Kept, not deleted: a late settlement can still be
 * recorded against it, which is why the status is not terminal in practice.
 */
export async function markUncollectible(invoiceId: string, reason: string, adminId: string | null): Promise<void> {
  const invoice = await prisma.platformInvoice.findUnique({
    where: { id: invoiceId },
    select: { businessId: true, status: true, number: true },
  })
  if (!invoice) throw new Error('Invoice not found')
  if (invoice.status !== 'OPEN') return

  await prisma.platformInvoice.update({
    where: { id: invoiceId },
    data: { status: 'UNCOLLECTIBLE', closedReason: reason.trim() || 'Grace period ended without payment.' },
  })
  await recordAudit({
    category: adminId ? 'ADMIN_ACTION' : 'SYSTEM',
    action: 'platform_invoice_uncollectible',
    actor: { type: adminId ? 'platform_admin' : 'system', id: adminId },
    businessId: invoice.businessId,
    resource: { type: 'platform_invoice', id: invoiceId },
    reason,
    metadata: { number: invoice.number },
  })
}

/* ---------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------ */

export interface InvoiceView {
  id: string
  number: string | null
  status: PlatformInvoiceStatus
  periodStart: Date
  periodEnd: Date
  subtotalCents: number
  vatCents: number
  totalCents: number
  issuedAt: Date | null
  dueAt: Date | null
  paidAt: Date | null
}

/** A business's own invoices. Scoped by businessId, like every read in modules/. */
export async function listInvoicesForBusiness(businessId: string, take = 50): Promise<InvoiceView[]> {
  return prisma.platformInvoice.findMany({
    where: { businessId, status: { not: 'DRAFT' } },
    orderBy: { periodStart: 'desc' },
    take,
    select: {
      id: true,
      number: true,
      status: true,
      periodStart: true,
      periodEnd: true,
      subtotalCents: true,
      vatCents: true,
      totalCents: true,
      issuedAt: true,
      dueAt: true,
      paidAt: true,
    },
  })
}

/** One invoice with its lines — never reachable across tenants. */
export async function getInvoiceForBusiness(businessId: string, invoiceId: string) {
  return prisma.platformInvoice.findFirst({
    where: { id: invoiceId, businessId, status: { not: 'DRAFT' } },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  })
}

/** What a business currently owes: issued, unpaid, not written off. */
export async function amountOutstanding(businessId: string): Promise<number> {
  const agg = await prisma.platformInvoice.aggregate({
    where: { businessId, status: 'OPEN' },
    _sum: { totalCents: true },
  })
  return agg._sum.totalCents ?? 0
}

/** Best-effort audit for a read-only billing view; never breaks the page. */
export function logBillingReadFailure(where: string, e: unknown): void {
  log('error', 'billing.read_failed', { where, ...errorFields(e) })
}
