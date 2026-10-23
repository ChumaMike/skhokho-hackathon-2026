import { NextRequest, NextResponse } from 'next/server'
import { verifyDriverEmail } from '@/modules/skhokholetha/driver.service'
import { checkRateLimits, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const limited = await checkRateLimits([['tokenUseIp', clientIp(req)]])
  if (!limited.allowed) return NextResponse.redirect(new URL('/driver?verify=limited', req.url), 303)
  const ok = await verifyDriverEmail(req.nextUrl.searchParams.get('token') ?? '')
  return NextResponse.redirect(new URL(ok ? '/driver?verified=1' : '/driver?verify=expired', req.url), 303)
}
