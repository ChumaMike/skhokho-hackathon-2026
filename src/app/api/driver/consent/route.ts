import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireDriverSession } from '@/lib/auth/guards'
import { grantLocationConsent, withdrawLocationConsent } from '@/modules/skhokholetha/driver.service'
import { lethaError } from '@/modules/skhokholetha/http'

export const runtime = 'nodejs'

const Body = z.object({ location: z.boolean() }).strict()

export async function POST(req: NextRequest) {
  try {
    const session = await requireDriverSession()
    const { location } = Body.parse(await req.json().catch(() => null))
    if (location) await grantLocationConsent(session.driverId)
    else await withdrawLocationConsent(session.driverId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return lethaError(e)
  }
}
