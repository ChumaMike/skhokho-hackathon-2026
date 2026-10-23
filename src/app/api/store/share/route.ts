import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma/client'
import { hostTenantConflict } from '@/lib/tenant/storefront-request'
import { checkRateLimits, clientIp } from '@/lib/rate-limit'
import { recordStorefrontEvents } from '@/modules/storefront-learning/events'

export const runtime = 'nodejs'

const Body = z
  .object({
    businessId: z.string().uuid(),
    productId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  })
  .strict()

/**
 * Social products (Tab 7): "this product was shared" — once, after the
 * share sheet or the copy completed. Two counters move: the product's own
 * share count (the plain number the merchant sees), and the daily
 * PRODUCT_SHARE counter beside views and taps in Page analytics. Nothing
 * about who shared it is received or kept: no identity, no cookie, no
 * destination, no IP stored (the rate limit holds it in memory only).
 * Always 204 — the answer never says whether anything was counted.
 */
export async function POST(req: NextRequest) {
  const noContent = new NextResponse(null, { status: 204 })
  if (!(await checkRateLimits([['shareCountIp', clientIp(req)]])).allowed) return noContent

  let body: unknown
  try {
    body = JSON.parse(await req.text())
  } catch {
    return noContent
  }
  const parsed = Body.safeParse(body)
  if (!parsed.success) return noContent
  const { businessId, productId } = parsed.data

  // A tenant host may only count for its own shop.
  if (await hostTenantConflict(req, businessId)) return noContent

  const business = await prisma.business.findFirst({ where: { id: businessId, status: 'ACTIVE' }, select: { settings: true } })
  if (!business) return noContent
  // Only this shop's own live product; a hidden one is no longer shareable.
  const product = await prisma.product.findFirst({ where: { id: productId, businessId, isActive: true }, select: { id: true } })
  if (!product) return noContent

  try {
    await prisma.product.update({ where: { id: product.id }, data: { shareCount: { increment: 1 } } })
    await recordStorefrontEvents(businessId, [{ type: 'PRODUCT_SHARE', page: 'PRODUCT', itemId: product.id }], { settings: business.settings })
  } catch (e) {
    console.error('[store/share] could not count', e)
  }
  return noContent
}
