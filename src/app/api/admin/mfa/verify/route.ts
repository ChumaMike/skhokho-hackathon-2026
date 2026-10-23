import { NextRequest } from 'next/server'
import { z } from 'zod'
import { clientIp } from '@/lib/rate-limit'
import { verifySecondFactor } from '@/modules/platform-admin/mfa.service'
import { adminHome, issueAdminSession, noStoreJson, requireMfaPending } from '@/modules/platform-admin/session'
import { securityEvent } from '@/modules/platform-admin/audit'
import { mfaError } from '../errors'

export const runtime = 'nodejs'

const Body = z.union([z.object({ code: z.string().max(12) }).strict(), z.object({ recoveryCode: z.string().max(20) }).strict()])

/** Step 2 (enrolled admins): a TOTP code or one recovery code → the real admin session. */
export async function POST(req: NextRequest) {
  try {
    const pending = await requireMfaPending(req)
    const body = Body.parse(await req.json().catch(() => null))
    const ctx = { ip: clientIp(req), requestId: req.headers.get('x-request-id') }
    const { epoch, usedRecoveryCode } = await verifySecondFactor(pending.adminId, pending.email, body, ctx)
    const res = noStoreJson({ ok: true, next: await adminHome(req), usedRecoveryCode })
    await issueAdminSession(res, { adminId: pending.adminId, email: pending.email, epoch })
    await securityEvent('admin_login', { actor: { type: 'platform_admin', id: pending.adminId }, metadata: { factor: usedRecoveryCode ? 'recovery-code' : 'totp' }, ...ctx })
    return res
  } catch (e) {
    return mfaError(e)
  }
}
