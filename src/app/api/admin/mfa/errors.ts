import { ZodError } from 'zod'
import { AuthError } from '@/lib/auth/guards'
import { MfaError } from '@/modules/platform-admin/mfa.service'
import { noStoreJson } from '@/modules/platform-admin/session'
import { log, errorFields } from '@/lib/log'

/** One error mapping for the MFA endpoints — never echoes a code back. */
export function mfaError(e: unknown) {
  if (e instanceof AuthError) return noStoreJson({ ok: false, error: e.message }, e.status)
  if (e instanceof MfaError) return noStoreJson({ ok: false, error: e.message, code: e.code }, e.code === 'RATE_LIMITED' ? 429 : 422)
  if (e instanceof ZodError) return noStoreJson({ ok: false, error: 'Enter the 6-digit code.' }, 400)
  log('error', 'admin.mfa.error', errorFields(e))
  return noStoreJson({ ok: false, error: 'Something went wrong. Try again.' }, 500)
}
