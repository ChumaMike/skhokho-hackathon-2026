import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma/client'
import { hostTenantConflict } from '@/lib/tenant/storefront-request'
import { EventBatchSchema, recordStorefrontEvents } from '@/modules/storefront-learning/events'
import { checkRateLimits, clientIp } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/**
 * Storefront behaviour beacon. Public (no session on a storefront), so:
 *  - Do Not Track / Global Privacy Control → nothing is counted;
 *  - every field is an enum or a catalogue id (EventBatchSchema);
 *  - a tenant host may only count for its own business;
 *  - only ACTIVE businesses, and only item ids from THEIR catalogue;
 *  - a per-IP rate limit (IP kept in memory only, never stored).
 * Always 204 — the response says nothing about what was or wasn't counted.
 */
export async function POST(req: NextRequest) {
  const noContent = new NextResponse(null, { status: 204 })
  if (req.headers.get('dnt') === '1' || req.headers.get('sec-gpc') === '1') return noContent

  // Shared across instances (the old in-memory counter was per instance).
  if (!(await checkRateLimits([['storefrontEventsIp', clientIp(req)]])).allowed) return noContent

  let body: unknown
  try {
    body = JSON.parse(await req.text())
  } catch {
    return noContent
  }
  const parsed = EventBatchSchema.safeParse(body)
  if (!parsed.success) return noContent
  const { businessId, device, events } = parsed.data

  if (await hostTenantConflict(req, businessId)) return noContent

  const business = await prisma.business.findFirst({ where: { id: businessId, status: 'ACTIVE' }, select: { settings: true } })
  if (!business) return noContent

  // Item ids must be this business's own products/services.
  const itemIds = [...new Set(events.map((e) => e.itemId).filter((id): id is string => Boolean(id)))]
  let known = new Set<string>()
  if (itemIds.length > 0) {
    const [products, services] = await Promise.all([
      prisma.product.findMany({ where: { businessId, id: { in: itemIds } }, select: { id: true } }),
      prisma.service.findMany({ where: { businessId, id: { in: itemIds } }, select: { id: true } }),
    ])
    known = new Set([...products, ...services].map((r) => r.id))
  }
  const accepted = events.filter((e) => !e.itemId || known.has(e.itemId))

  try {
    await recordStorefrontEvents(businessId, accepted, { device, settings: business.settings })
  } catch (e) {
    console.error('[store/events] could not record', e)
  }
  return noContent
}
