/**
 * What content generation is allowed to know — assembled on the server from
 * authoritative rows, never from anything the client submitted except the
 * merchant's own free-text idea (which is treated as untrusted content).
 *
 * Reuses the storefront facts gatherer (business, catalogue counts, brand
 * colours, contact PRESENCE only) and the brand profile. Adds the subject
 * (one product, one category, an offer, a custom idea, or an aggregated
 * sales insight) and nothing else: no customer names, phone numbers,
 * addresses, payments or delivery codes ever reach this object.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma/client'
import { formatZAR } from '@/lib/utils'
import { gatherStorefrontFacts, type StorefrontFacts } from '@/modules/storefront-spec/facts'
import { getBrandProfile, type BrandProfile } from './brand-profile'

export const ContentSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('BUSINESS') }).strict(),
  z.object({ type: z.literal('PRODUCT'), productId: z.string().min(1).max(64) }).strict(),
  z.object({ type: z.literal('CATEGORY'), categoryId: z.string().min(1).max(64) }).strict(),
  z.object({ type: z.literal('OFFER'), text: z.string().trim().min(3).max(400) }).strict(),
  z.object({ type: z.literal('CUSTOM'), text: z.string().trim().min(3).max(400) }).strict(),
  z.object({ type: z.literal('INSIGHT') }).strict(),
])
export type ContentSource = z.infer<typeof ContentSourceSchema>

export class ContentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentError'
  }
}

export interface SubjectProduct {
  id: string
  name: string
  /** Untrusted free text written by the merchant (or a previous AI draft). */
  description: string | null
  priceLabel: string
  categoryName: string | null
}

export interface ContentContext {
  facts: StorefrontFacts
  brand: BrandProfile
  subject:
    | { kind: 'BUSINESS' }
    | { kind: 'PRODUCT'; product: SubjectProduct }
    | { kind: 'CATEGORY'; categoryName: string; products: SubjectProduct[] }
    | { kind: 'OFFER'; text: string }
    | { kind: 'CUSTOM'; text: string }
    | { kind: 'INSIGHT' }
  /** Aggregated sales facts only (names + quantities over 30 days); empty when there is no paid history. */
  insight: { topProducts: { name: string; quantity: number }[]; days: number }
}

const INSIGHT_DAYS = 30

async function productView(businessId: string, productId: string): Promise<SubjectProduct> {
  // Scoped by the caller's business — another business's id is simply "not in your catalogue".
  const p = await prisma.product.findFirst({
    where: { id: productId, businessId, isActive: true },
    select: { id: true, name: true, description: true, price: true, category: { select: { name: true } } },
  })
  if (!p) throw new ContentError("That product isn't in your catalogue.")
  return { id: p.id, name: p.name, description: p.description?.trim() || null, priceLabel: formatZAR(p.price), categoryName: p.category?.name ?? null }
}

/** Top sellers by paid order quantity — an aggregate, never an order or a customer. */
export async function salesInsight(businessId: string, now: Date = new Date()): Promise<ContentContext['insight']> {
  const since = new Date(now.getTime() - INSIGHT_DAYS * 24 * 60 * 60 * 1000)
  const grouped = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: { productId: { not: null }, order: { businessId, paymentStatus: 'PAID', createdAt: { gte: since } } },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: 5,
  })
  const ids = grouped.map((g) => g.productId).filter((id): id is string => !!id)
  if (ids.length === 0) return { topProducts: [], days: INSIGHT_DAYS }
  const products = await prisma.product.findMany({ where: { businessId, id: { in: ids }, isActive: true }, select: { id: true, name: true } })
  const names = new Map(products.map((p) => [p.id, p.name]))
  return {
    topProducts: grouped.filter((g) => g.productId && names.has(g.productId)).map((g) => ({ name: names.get(g.productId!)!, quantity: g._sum.quantity ?? 0 })),
    days: INSIGHT_DAYS,
  }
}

export async function gatherContentContext(businessId: string, source: ContentSource, now: Date = new Date()): Promise<ContentContext> {
  const [facts, business, insight] = await Promise.all([
    gatherStorefrontFacts(businessId),
    prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { settings: true } }),
    salesInsight(businessId, now),
  ])
  const brand = getBrandProfile(business)

  let subject: ContentContext['subject']
  switch (source.type) {
    case 'BUSINESS':
      subject = { kind: 'BUSINESS' }
      break
    case 'PRODUCT':
      subject = { kind: 'PRODUCT', product: await productView(businessId, source.productId) }
      break
    case 'CATEGORY': {
      const category = await prisma.productCategory.findFirst({ where: { id: source.categoryId, businessId }, select: { id: true, name: true } })
      if (!category) throw new ContentError("That category isn't in your catalogue.")
      const rows = await prisma.product.findMany({
        where: { businessId, categoryId: category.id, isActive: true },
        orderBy: [{ isFeatured: 'desc' }, { name: 'asc' }],
        take: 12,
        select: { id: true, name: true, description: true, price: true },
      })
      subject = { kind: 'CATEGORY', categoryName: category.name, products: rows.map((p) => ({ id: p.id, name: p.name, description: p.description?.trim() || null, priceLabel: formatZAR(p.price), categoryName: category.name })) }
      break
    }
    case 'OFFER':
      subject = { kind: 'OFFER', text: source.text }
      break
    case 'CUSTOM':
      subject = { kind: 'CUSTOM', text: source.text }
      break
    case 'INSIGHT':
      subject = { kind: 'INSIGHT' }
      break
  }
  return { facts, brand, subject, insight }
}
