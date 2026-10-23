/**
 * The append-only record of phone messages, and the daily spend cap.
 *
 * Deliberately provider-agnostic: it sits in the seam, not in the BulkSMS
 * adapter, so swapping vendor changes nothing here. Also deliberately
 * ignorant of phone numbers and message bodies — callers hand it a MASKED
 * number and a character count, never the real thing. That is not politeness,
 * it is the only way a log table can coexist with the promise in provider.ts
 * never to record either; a module that cannot receive the number cannot leak
 * it.
 *
 * Nothing in here throws. A logging failure must never stop a message, and a
 * cap that cannot be read must not silently become unlimited — see `withinCap`
 * for which way each one fails.
 */

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { log, errorFields } from '@/lib/log'
import type { MessageKind } from './provider'

/** Matches the plan allowances' order of magnitude; overridable per deployment. */
export const DEFAULT_DAILY_CAP = 500

/**
 * South Africa has no daylight saving, so SAST is always UTC+2 and the day
 * boundary is arithmetic rather than a timezone library. A cap that reset at
 * UTC midnight would reset at 02:00 in the morning for the shops paying for
 * it, which is not what "a day" means to them.
 */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000

/** The instant 00:00 SAST on the SA calendar day containing `now`. */
export function startOfSaDay(now: Date): Date {
  const shifted = new Date(now.getTime() + SAST_OFFSET_MS)
  const midnightShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
  return new Date(midnightShifted - SAST_OFFSET_MS)
}

/**
 * The cap from the environment. A malformed or negative value is treated as
 * absent rather than as zero: a typo in an env var must not silently stop
 * every order notification on the platform.
 */
export function dailyCap(): number {
  const raw = (process.env.SMS_DAILY_CAP_PER_BUSINESS ?? '').trim()
  if (!raw) return DEFAULT_DAILY_CAP
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    log('warn', 'message_log.bad_cap_env', { raw })
    return DEFAULT_DAILY_CAP
  }
  return parsed
}

/**
 * Statuses that consumed real money and therefore quota. A provider refusal
 * costs nothing, so it does not count — otherwise an outage at the vendor
 * would eat a shop's daily allowance without sending anything. Stopping an
 * abusive loop of refused sends is the rate limiter's job (lib/rate-limit.ts),
 * not the spend cap's.
 */
const QUOTA_CONSUMING = ['ACCEPTED', 'DELIVERED', 'UNDELIVERED'] as const

export interface CapVerdict {
  allowed: boolean
  used: number
  cap: number
}

/**
 * Whether this business may send one more today.
 *
 * Fails CLOSED on a database error: if we cannot count what has been spent, we
 * do not spend more. The alternative — treating an unreadable count as zero —
 * turns a database blip into an uncapped bill.
 *
 * `businessId` null means a platform message (a customer sign-in code, which
 * is deliberately not attributed to a shop). Those share one bucket under the
 * same cap, so a loop cannot send unlimited codes either.
 *
 * Known and accepted: this counts, then the caller sends, so a concurrent
 * burst can overshoot the cap by the number of sends already in flight. That
 * is fine for a spend guard — it is a budget, not an invariant. Making it
 * exact would need an advisory lock or a counter row with a CHECK, which is
 * not worth the contention on every notification.
 */
export async function withinCap(businessId: string | null, now: Date = new Date()): Promise<CapVerdict> {
  const cap = dailyCap()
  if (cap === 0) return { allowed: false, used: 0, cap }
  try {
    const used = await prisma.messageLog.count({
      where: {
        businessId,
        createdAt: { gte: startOfSaDay(now) },
        status: { in: [...QUOTA_CONSUMING] },
      },
    })
    return { allowed: used < cap, used, cap }
  } catch (e) {
    log('error', 'message_log.cap_unreadable', { ...errorFields(e) })
    return { allowed: false, used: cap, cap }
  }
}

export type RecordedStatus = 'CAPPED' | 'REJECTED' | 'ACCEPTED'

export interface RecordInput {
  businessId: string | null
  kind: MessageKind
  provider: string
  /** Already masked by the caller. This module never sees a real number. */
  toMasked: string
  /** Length of the text that was (or would have been) sent — not the text. */
  bodyChars: number
  status: RecordedStatus
  providerMessageId?: string | null
  errorName?: string | null
  costCredits?: number | null
}

/**
 * Appends one row. Never throws and never blocks the caller's result: if the
 * insert fails the message still happened (or still failed) and the caller's
 * answer must not change because bookkeeping did.
 */
/**
 * A unique-constraint violation on `provider_message_id` specifically, rather
 * than any P2002 — a collision on some future index must still be reported as
 * a failure instead of being quietly retried.
 */
function isDuplicateProviderMessageId(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false
  const target = (e.meta as { target?: unknown } | undefined)?.target
  const fields = Array.isArray(target) ? target.map(String) : typeof target === 'string' ? [target] : []
  return fields.some((f) => f.includes('provider_message_id'))
}

export async function recordSend(input: RecordInput): Promise<void> {
  const data = {
    businessId: input.businessId,
    kind: input.kind,
    provider: input.provider,
    toMasked: input.toMasked,
    bodyChars: input.bodyChars,
    status: input.status,
    providerMessageId: input.providerMessageId ?? null,
    errorName: input.errorName ?? null,
    costCredits:
      input.costCredits == null ? null : new Prisma.Decimal(input.costCredits.toFixed(4)),
  }
  try {
    await prisma.messageLog.create({ data })
  } catch (e) {
    // A provider id we have seen before must not cost us the spend record.
    // The unique index exists so a replayed delivery report cannot be applied
    // to two rows; it was never meant to decide whether a charged message is
    // counted. So keep the row and drop the id: the cap stays honest, which is
    // the half that spends a shop's money, and the delivery report simply has
    // nothing to match. Losing the row instead would let a business send past
    // its cap, which is the one thing the cap exists to prevent.
    if (isDuplicateProviderMessageId(e) && data.providerMessageId !== null) {
      log('warn', 'message_log.duplicate_provider_id', {
        kind: input.kind,
        status: input.status,
        provider: input.provider,
      })
      try {
        await prisma.messageLog.create({ data: { ...data, providerMessageId: null } })
      } catch (retryError) {
        log('error', 'message_log.write_failed', {
          kind: input.kind,
          status: input.status,
          ...errorFields(retryError),
        })
      }
      return
    }
    log('error', 'message_log.write_failed', { kind: input.kind, status: input.status, ...errorFields(e) })
  }
}

export interface DeliveryReport {
  providerMessageId: string
  delivered: boolean
  errorName?: string | null
  at?: Date
}

/**
 * Applies one delivery report to the row it belongs to.
 *
 * Idempotent and append-only in spirit: it only ever moves ACCEPTED forward to
 * DELIVERED or UNDELIVERED and stamps the times. A report for an unknown id is
 * not an error worth shouting about (a replay, or a message sent before this
 * table existed), and a report that would move a row backwards is ignored
 * rather than applied, so a late duplicate cannot undo a final state.
 *
 * Returns whether a row was changed, which the webhook uses only to decide
 * what to log — never to tell the caller whether the id was valid, because
 * that would make the endpoint an oracle for guessing message ids.
 */
export async function applyDeliveryReport(report: DeliveryReport): Promise<boolean> {
  const at = report.at ?? new Date()
  try {
    const result = await prisma.messageLog.updateMany({
      where: { providerMessageId: report.providerMessageId, status: 'ACCEPTED' },
      data: {
        status: report.delivered ? 'DELIVERED' : 'UNDELIVERED',
        deliveredAt: report.delivered ? at : null,
        reportedAt: at,
        errorName: report.delivered ? null : (report.errorName ?? 'provider_undelivered'),
      },
    })
    return result.count > 0
  } catch (e) {
    log('error', 'message_log.report_failed', { ...errorFields(e) })
    return false
  }
}
