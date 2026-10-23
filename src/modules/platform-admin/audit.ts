/**
 * The platform audit trail (platform_audit_events, append-only).
 *
 *   ADMIN_ACTION  a privileged change by a platform admin (always with a reason)
 *   SECURITY      failed admin login, failed MFA, denied access, rate limits,
 *                 rejected webhooks, repeated code failures, suspensions…
 *   SYSTEM        background job and email/provider failures
 *
 * Writing an event NEVER breaks the request that caused it: failures are
 * logged (structured) and swallowed, except where a caller asks for `strict`
 * (an admin action that must not succeed unaudited). Metadata is redacted
 * (src/lib/redact.ts); IPs are stored as a keyed hash only.
 */

import { createHash } from 'node:crypto'
import type { AuditCategory, AuditOutcome, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { redact } from '@/lib/redact'
import { log, errorFields } from '@/lib/log'

export type AuditActorType = 'platform_admin' | 'staff' | 'driver' | 'system' | 'anonymous'

export interface AuditInput {
  category: AuditCategory
  action: string
  outcome?: AuditOutcome
  actor: { type: AuditActorType; id?: string | null }
  businessId?: string | null
  resource?: { type: string; id?: string | null }
  reason?: string | null
  metadata?: Record<string, unknown>
  ip?: string | null
  requestId?: string | null
}

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip || ip === 'unknown') return null
  return createHash('sha256').update(`audit-ip:${process.env.JWT_SECRET ?? ''}:${ip}`).digest('hex').slice(0, 32)
}

/** A business id only if it's a UUID (the column is uuid) — anything else is dropped, never thrown. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function toRow(e: AuditInput): Prisma.PlatformAuditEventCreateInput {
  return {
    category: e.category,
    action: e.action.slice(0, 80),
    outcome: e.outcome ?? 'SUCCESS',
    actorType: e.actor.type,
    actorId: e.actor.id ?? null,
    businessId: e.businessId && UUID.test(e.businessId) ? e.businessId : null,
    resourceType: e.resource?.type ?? null,
    resourceId: e.resource?.id ?? null,
    reason: e.reason ? e.reason.trim().slice(0, 500) : null,
    metadata: e.metadata ? (redact(e.metadata) as Prisma.InputJsonValue) : undefined,
    ipHash: hashIp(e.ip),
    requestId: e.requestId?.slice(0, 64) ?? null,
  }
}

/** Records an event. Never throws unless `strict` (then the caller's action must fail too). */
export async function recordAudit(e: AuditInput, opts: { strict?: boolean; tx?: Prisma.TransactionClient } = {}): Promise<void> {
  try {
    await (opts.tx ?? prisma).platformAuditEvent.create({ data: toRow(e) })
  } catch (err) {
    log('error', 'audit.write_failed', { action: e.action, category: e.category, ...errorFields(err) })
    if (opts.strict) throw err
  }
}

/** Shorthand for security events (never strict — a security log must not take the site down). */
export function securityEvent(action: string, e: Omit<AuditInput, 'category' | 'action'>): Promise<void> {
  return recordAudit({ ...e, category: 'SECURITY', action })
}

export function systemEvent(action: string, e: Omit<AuditInput, 'category' | 'action' | 'actor'> & { actor?: AuditInput['actor'] }): Promise<void> {
  return recordAudit({ ...e, actor: e.actor ?? { type: 'system' }, category: 'SYSTEM', action })
}

/** Request context for events raised inside a request (best-effort: absent outside one). */
export async function requestContext(): Promise<{ ip: string | null; requestId: string | null }> {
  try {
    const { headers } = await import('next/headers')
    const h = await headers()
    const ip = h.get('x-vercel-forwarded-for') ?? h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    return { ip, requestId: h.get('x-request-id') }
  } catch {
    return { ip: null, requestId: null }
  }
}
