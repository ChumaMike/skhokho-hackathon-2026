import { NextRequest } from 'next/server'
import { z } from 'zod'
import { clientIp } from '@/lib/rate-limit'
import { confirmEnrollment } from '@/modules/platform-admin/mfa.service'
import { adminHome, issueAdminSession, noStoreJson, requireMfaPending } from '@/modules/platform-admin/session'
import { securityEvent } from '@/modules/platform-admin/audit'
import { mfaError } from '../errors'

export const runtime = 'nodejs'

const Body = z.object({ code: z.string().max(12) }).strict()

/** Step 2b: confirm the authenticator with a code; returns recovery codes ONCE and signs in. */
export async function POST(req: NextRequest) {
  try {
    const pending = await requireMfaPending(req)
    const { code } = Body.parse(await req.json().catch(() => null))
    const ctx = { ip: clientIp(req), requestId: req.headers.get('x-request-id') }
    const { recoveryCodes, epoch } = await confirmEnrollment(pending.adminId, pending.email, code, ctx)
    const res = noStoreJson({ ok: true, recoveryCodes, next: await adminHome(req) })
    await issueAdminSession(res, { adminId: pending.adminId, email: pending.email, epoch })
    await securityEvent('admin_login', { actor: { type: 'platform_admin', id: pending.adminId }, metadata: { factor: 'totp-enrolment' }, ...ctx })
    return res
  } catch (e) {
    return mfaError(e)
  }
}
