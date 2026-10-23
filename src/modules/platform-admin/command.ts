/**
 * Every admin change is an explicit, named command — never a generic field
 * editor. `adminCommand` is the one wrapper server actions use:
 *
 *   1. requireAdmin(permission) — MFA session + role (else 404)
 *   2. a reason (min 5 chars) when the command is sensitive
 *   3. the command itself (its own service-level validation)
 *   4. an ADMIN_ACTION audit event: actor, action, resource, business, reason
 *
 * The audit write is `strict`: if it fails the admin sees an error (the change
 * has happened — the log line `audit.write_failed` is the alert for that case).
 */

import { notFound, redirect, unstable_rethrow } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { ZodError } from 'zod'
import { requireAdmin, type AdminContext } from '@/lib/auth/guards'
import { recordAudit, requestContext } from './audit'
import type { AdminPermission } from './permissions'
import { log, errorFields } from '@/lib/log'

export class AdminCommandError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdminCommandError'
  }
}

/** Errors whose message is safe and useful to show the admin. */
const SHOWABLE = new Set(['AdminCommandError', 'RefundResolutionError', 'DataSubjectError', 'DriverError', 'LedgerError', 'NetworkDeliveryError', 'MfaError', 'FeatureDisabledError', 'InvalidTransitionError'])

export interface CommandResult {
  action: string
  resource: { type: string; id: string }
  businessId?: string | null
  metadata?: Record<string, unknown>
}

export function reasonFrom(fd: FormData, required: boolean): string | null {
  const reason = String(fd.get('reason') ?? '').trim()
  if (required && reason.length < 5) throw new AdminCommandError('Give a reason (at least 5 characters) — it goes in the audit log.')
  return reason || null
}

export async function adminCommand(
  opts: { permission: AdminPermission; path: string; reasonRequired?: boolean; okFlag?: string },
  fd: FormData,
  run: (admin: AdminContext, reason: string | null) => Promise<CommandResult>,
): Promise<never> {
  let admin: AdminContext
  try {
    admin = await requireAdmin(opts.permission)
  } catch {
    notFound()
  }
  try {
    const reason = reasonFrom(fd, opts.reasonRequired ?? true)
    const result = await run(admin, reason)
    const ctx = await requestContext()
    await recordAudit(
      { category: 'ADMIN_ACTION', action: result.action, actor: { type: 'platform_admin', id: admin.adminId }, resource: result.resource, businessId: result.businessId, reason, metadata: { role: admin.role, ...result.metadata }, ...ctx },
      { strict: true },
    )
  } catch (e) {
    unstable_rethrow(e)
    const showable = e instanceof Error && (SHOWABLE.has(e.name) || e instanceof ZodError)
    if (!showable) log('error', 'admin.command_failed', { path: opts.path, ...errorFields(e) })
    const message = e instanceof ZodError ? 'Some details were not valid.' : showable ? (e as Error).message : 'Something went wrong.'
    redirect(`${opts.path}?err=${encodeURIComponent(message)}`)
  }
  revalidatePath(opts.path)
  redirect(`${opts.path}?ok=${opts.okFlag ?? '1'}`)
}
