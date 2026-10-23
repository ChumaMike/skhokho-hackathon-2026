import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireDriverSession } from '@/lib/auth/guards'
import { requestAvailability } from '@/modules/skhokholetha/driver.service'
import { lethaError } from '@/modules/skhokholetha/http'

export const runtime = 'nodejs'

const Body = z.object({ online: z.boolean() }).strict()

/** A REQUEST to go online/offline — the server checks eligibility and decides. */
export async function POST(req: NextRequest) {
  try {
    const session = await requireDriverSession()
    const { online } = Body.parse(await req.json().catch(() => null))
    return NextResponse.json({ ok: true, ...(await requestAvailability(session.driverId, online)) })
  } catch (e) {
    return lethaError(e)
  }
}
