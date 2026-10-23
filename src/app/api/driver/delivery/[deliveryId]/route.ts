import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireDriverSession } from '@/lib/auth/guards'
import { confirmDelivery, confirmPickup, confirmReturn, driverStep, failDelivery } from '@/modules/skhokholetha/delivery.service'
import { DRIVER_STEP_ACTIONS } from '@/modules/skhokholetha/state-machine'
import { lethaError } from '@/modules/skhokholetha/http'

export const runtime = 'nodejs'

/**
 * One endpoint for the driver's delivery steps. The body names an ACTION
 * (validated against a closed list) — never a status — and the state machine
 * decides whether it's allowed from where the delivery is now.
 */
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.enum(DRIVER_STEP_ACTIONS) }).strict(),
  z.object({ action: z.literal('CONFIRM_PICKUP'), code: z.string().max(20) }).strict(),
  z.object({ action: z.literal('CONFIRM_DELIVERY'), code: z.string().max(20) }).strict(),
  z.object({ action: z.literal('CONFIRM_RETURN'), code: z.string().max(20) }).strict(),
  z.object({ action: z.literal('FAIL'), reason: z.string().min(2).max(300) }).strict(),
])

export async function POST(req: NextRequest, { params }: { params: Promise<{ deliveryId: string }> }) {
  try {
    const session = await requireDriverSession()
    const body = Body.parse(await req.json().catch(() => null))
    const { deliveryId } = await params
    switch (body.action) {
      case 'CONFIRM_PICKUP':
        await confirmPickup(session.driverId, deliveryId, body.code)
        break
      case 'CONFIRM_DELIVERY':
        await confirmDelivery(session.driverId, deliveryId, body.code)
        break
      case 'CONFIRM_RETURN':
        await confirmReturn(session.driverId, deliveryId, body.code)
        break
      case 'FAIL':
        await failDelivery(session.driverId, deliveryId, body.reason)
        break
      default:
        await driverStep(session.driverId, deliveryId, body.action)
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return lethaError(e)
  }
}
