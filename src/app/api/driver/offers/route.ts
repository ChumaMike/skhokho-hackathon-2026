import { NextResponse } from 'next/server'
import { requireDriverSession } from '@/lib/auth/guards'
import { listDriverOffers, maybeTickDispatch } from '@/modules/skhokholetha/dispatch.service'
import { lethaError } from '@/modules/skhokholetha/http'

export const runtime = 'nodejs'

/** The driver's live offers. Polling also advances dispatch (expiry, next round). */
export async function GET() {
  try {
    const session = await requireDriverSession()
    await maybeTickDispatch()
    return NextResponse.json({ ok: true, offers: await listDriverOffers(session.driverId) }, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    return lethaError(e)
  }
}
