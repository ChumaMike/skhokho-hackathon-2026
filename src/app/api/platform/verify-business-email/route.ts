import { NextRequest, NextResponse } from 'next/server'
import { confirmEmailChange } from '@/modules/tenant/business-email'
import { checkRateLimits, clientIp } from '@/lib/rate-limit'
import { recordAudit } from '@/modules/platform-admin/audit'

export const runtime = 'nodejs'

/**
 * The link from businessEmailVerifyEmail. No session needed: whoever holds
 * the (unguessable, 24h) token controls the new address, which is the proof
 * this flow is about. Lands on the settings page either way, which asks the
 * owner to sign in if they aren't.
 */
export async function GET(req: NextRequest) {
  const limited = await checkRateLimits([['tokenUseIp', clientIp(req)]])
  if (!limited.allowed) return NextResponse.redirect(new URL('/dashboard/settings?err=Too+many+attempts.+Try+again+in+a+few+minutes.', req.url), 303)
  const result = await confirmEmailChange(req.nextUrl.searchParams.get('token') ?? '')
  if (!result) {
    return NextResponse.redirect(new URL('/dashboard/settings?err=That+link+has+expired+or+was+already+used.+Request+a+new+one+below.', req.url), 303)
  }
  await recordAudit({
    category: 'MERCHANT_ACTION',
    action: 'business_email_changed',
    actor: { type: 'anonymous' },
    businessId: result.businessId,
    resource: { type: 'business', id: result.businessId },
    ip: clientIp(req),
    requestId: req.headers.get('x-request-id'),
  })
  return NextResponse.redirect(new URL('/dashboard/settings?emailVerified=1', req.url), 303)
}
