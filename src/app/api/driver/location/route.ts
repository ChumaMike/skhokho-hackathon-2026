import { NextRequest, NextResponse } from 'next/server'
import { requireDriverSession } from '@/lib/auth/guards'
import { recordDriverPosition } from '@/modules/skhokholetha/driver.service'
import { lethaError } from '@/modules/skhokholetha/http'
import { checkRateLimits } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/** The driver's own position. Ignored unless online with consent; no history is kept. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireDriverSession()
    const limited = await checkRateLimits([['driverLocation', session.driverId]])
    if (!limited.allowed) return NextResponse.json({ ok: false, error: 'Too many updates.' }, { status: 429 })
    const result = await recordDriverPosition(session.driverId, await req.json().catch(() => null))
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return lethaError(e)
  }
}
