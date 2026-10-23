import { NextRequest } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/auth/guards'
import { clientIp } from '@/lib/rate-limit'
import { regenerateRecoveryCodes } from '@/modules/platform-admin/mfa.service'
import { noStoreJson } from '@/modules/platform-admin/session'
import { mfaError } from '../errors'

export const runtime = 'nodejs'

const Body = z.object({ code: z.string().max(12) }).strict()

/** A signed-in admin replaces their recovery codes — needs a fresh TOTP code too. */
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    const { code } = Body.parse(await req.json().catch(() => null))
    const codes = await regenerateRecoveryCodes(admin.adminId, admin.email, code, { ip: clientIp(req), requestId: req.headers.get('x-request-id') })
    return noStoreJson({ ok: true, recoveryCodes: codes })
  } catch (e) {
    return mfaError(e)
  }
}
