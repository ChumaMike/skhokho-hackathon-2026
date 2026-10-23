import { NextResponse } from 'next/server'
import { requireDriverSession } from '@/lib/auth/guards'
import { getDriverActiveDelivery } from '@/modules/skhokholetha/delivery.service'
import { lethaError } from '@/modules/skhokholetha/http'

export const runtime = 'nodejs'

/** The driver's current delivery (drop-off details only because it's theirs). */
export async function GET() {
  try {
    const session = await requireDriverSession()
    return NextResponse.json({ ok: true, delivery: await getDriverActiveDelivery(session.driverId) }, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    return lethaError(e)
  }
}
