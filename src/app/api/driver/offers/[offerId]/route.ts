import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireDriverSession } from '@/lib/auth/guards'
import { acceptOffer, declineOffer } from '@/modules/skhokholetha/dispatch.service'
import { lethaError } from '@/modules/skhokholetha/http'

export const runtime = 'nodejs'

const Body = z.object({ decision: z.enum(['ACCEPT', 'DECLINE']) }).strict()

export async function POST(req: NextRequest, { params }: { params: Promise<{ offerId: string }> }) {
  try {
    const session = await requireDriverSession()
    const { decision } = Body.parse(await req.json().catch(() => null))
    const { offerId } = await params
    if (decision === 'DECLINE') {
      await declineOffer(session.driverId, offerId)
      return NextResponse.json({ ok: true })
    }
    const result = await acceptOffer(session.driverId, offerId)
    return NextResponse.json({ ok: true, deliveryId: result.networkDeliveryId })
  } catch (e) {
    return lethaError(e)
  }
}
