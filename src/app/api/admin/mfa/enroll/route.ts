import { NextRequest } from 'next/server'
import { beginEnrollment } from '@/modules/platform-admin/mfa.service'
import { noStoreJson, requireMfaPending } from '@/modules/platform-admin/session'
import { mfaError } from '../errors'

export const runtime = 'nodejs'

/** Step 2a (first sign-in only): a new authenticator secret, shown once as a QR code. */
export async function POST(req: NextRequest) {
  try {
    const pending = await requireMfaPending(req)
    return noStoreJson({ ok: true, ...(await beginEnrollment(pending.adminId, pending.email)) })
  } catch (e) {
    return mfaError(e)
  }
}
