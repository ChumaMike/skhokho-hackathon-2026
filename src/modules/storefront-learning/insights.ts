/**
 * Merchant-facing storefront insights — plain sentences about the
 * merchant's OWN storefront, from their own counters. Never anything about
 * other businesses, never the internal pattern-learning system.
 *
 * Insights appear only once there's enough to say something real
 * (INSIGHT_MIN_VISITS); small numbers are reported as numbers, not dressed up.
 */

import { prisma } from '@/lib/prisma/client'
import { getStorefrontLayout } from '@/modules/storefront-spec/layout'
import { getBusinessExperience } from '@/modules/tenant/business-experience'
import { storefrontDay } from './events'

export const INSIGHT_MIN_VISITS = 20
export const INSIGHT_WINDOW_DAYS = 30

export interface StatRow {
  event: string
  page: string
  itemId: string
  device: string
  count: number
}

export interface Insight {
  key: 'TOP_PAGE' | 'TOP_ITEMS' | 'MAIN_BUTTON' | 'BOOKING_VS_ENQUIRY' | 'PHONES' | 'CHECKOUT' | 'BOOKINGS'
  text: string
}

export interface StorefrontInsights {
  enoughData: boolean
  visits: number
  insights: Insight[]
}

function sum(rows: StatRow[], match: (r: StatRow) => boolean): number {
  return rows.reduce((total, r) => (match(r) ? total + r.count : total), 0)
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const PAGE_NAMES: Record<string, string> = {
  HOME: 'home',
  ABOUT: 'about',
  CONTACT: 'contact',
  GALLERY: 'gallery',
  PRODUCT: 'product',
  BASKET: 'basket',
  CHECKOUT: 'checkout',
}

/** Pure: counters → sentences. */
export function buildInsights(
  rows: StatRow[],
  context: { itemNames: Map<string, string>; catalogLabel: string; mainButton: { label: string; action: string } | null },
): StorefrontInsights {
  const visits = sum(rows, (r) => r.event === 'PAGE_VIEW')
  if (visits < INSIGHT_MIN_VISITS) return { enoughData: false, visits, insights: [] }

  const insights: Insight[] = []

  // Most-visited page.
  const byPage = new Map<string, number>()
  for (const r of rows) if (r.event === 'PAGE_VIEW') byPage.set(r.page, (byPage.get(r.page) ?? 0) + r.count)
  const [topPage, topViews] = [...byPage.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  if (topPage) {
    const name = topPage === 'SHOP' ? context.catalogLabel.toLowerCase() : PAGE_NAMES[topPage] ?? topPage.toLowerCase()
    insights.push({ key: 'TOP_PAGE', text: `Your ${name} page receives the most visits — ${plural(topViews!, 'visit', 'visits')} in the last ${INSIGHT_WINDOW_DAYS} days.` })
  }

  // Products/services customers interact with most (views, basket adds, enquiries).
  const byItem = new Map<string, number>()
  for (const r of rows) {
    if (r.itemId && (r.event === 'PRODUCT_VIEW' || r.event === 'ADD_TO_BASKET' || r.event === 'ENQUIRY_CLICK')) {
      byItem.set(r.itemId, (byItem.get(r.itemId) ?? 0) + r.count)
    }
  }
  const topItems = [...byItem.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => context.itemNames.get(id))
    .filter((n): n is string => Boolean(n))
    .slice(0, 3)
  if (topItems.length > 0) insights.push({ key: 'TOP_ITEMS', text: `Customers interact most with ${list(topItems)}.` })

  // The main button.
  const ctaTaps = sum(rows, (r) => r.event === 'CTA_CLICK')
  const homeVisits = byPage.get('HOME') ?? 0
  if (context.mainButton && ctaTaps > 0 && homeVisits > 0) {
    const pct = Math.round((ctaTaps / homeVisits) * 100)
    insights.push({ key: 'MAIN_BUTTON', text: `Your main button ("${context.mainButton.label}") was tapped ${plural(ctaTaps, 'time', 'times')} — about ${pct}% of home page visits.` })
  }

  // Booking vs enquiry engagement.
  const bookings = sum(rows, (r) => r.event === 'BOOKING_SUBMITTED')
  const enquiries = sum(rows, (r) => r.event === 'ENQUIRY_CLICK')
  if (context.mainButton?.action === 'BOOK' && ctaTaps + enquiries >= 5) {
    insights.push({
      key: 'BOOKING_VS_ENQUIRY',
      text:
        ctaTaps >= enquiries
          ? `Your booking button is getting more engagement than WhatsApp enquiries (${ctaTaps} taps vs ${enquiries}).`
          : `More customers are asking on WhatsApp than tapping your booking button (${enquiries} vs ${ctaTaps}) — it may help to make booking easier to find.`,
    })
  }

  // Phones.
  const deviceViews = sum(rows, (r) => r.event === 'PAGE_VIEW' && r.device !== '')
  const phoneViews = sum(rows, (r) => r.event === 'PAGE_VIEW' && r.device === 'MOBILE')
  if (deviceViews >= INSIGHT_MIN_VISITS) {
    const pct = Math.round((phoneViews / deviceViews) * 100)
    if (pct >= 50) insights.push({ key: 'PHONES', text: `${pct}% of your visitors use their phones — clear photos and short words help most.` })
  }

  // Checkout funnel.
  const checkouts = sum(rows, (r) => r.event === 'CHECKOUT_START')
  const orders = sum(rows, (r) => r.event === 'ORDER_PLACED')
  if (checkouts > 0) {
    insights.push({ key: 'CHECKOUT', text: `${plural(checkouts, 'customer', 'customers')} started checkout and ${plural(orders, 'order was', 'orders were')} placed.` })
  }
  if (bookings > 0) insights.push({ key: 'BOOKINGS', text: `Customers made ${plural(bookings, 'booking', 'bookings')} from your storefront.` })

  return { enoughData: true, visits, insights }
}

/** The merchant's own insights for the last INSIGHT_WINDOW_DAYS. Scoped to their business only. */
export async function getStorefrontInsights(businessId: string, now: Date = new Date()): Promise<StorefrontInsights> {
  const since = new Date(storefrontDay(now).getTime() - (INSIGHT_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000)
  const [grouped, business] = await Promise.all([
    prisma.storefrontDailyStat.groupBy({
      by: ['event', 'page', 'itemId', 'device'],
      where: { businessId, day: { gte: since } },
      _sum: { count: true },
    }),
    prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { settings: true, category: true } }),
  ])
  const rows: StatRow[] = grouped.map((g) => ({ event: g.event, page: g.page, itemId: g.itemId, device: g.device, count: g._sum.count ?? 0 }))

  const itemIds = [...new Set(rows.map((r) => r.itemId).filter(Boolean))]
  const [products, services] = itemIds.length
    ? await Promise.all([
        prisma.product.findMany({ where: { businessId, id: { in: itemIds } }, select: { id: true, name: true } }),
        prisma.service.findMany({ where: { businessId, id: { in: itemIds } }, select: { id: true, name: true } }),
      ])
    : [[], []]
  const layout = getStorefrontLayout(business)

  return buildInsights(rows, {
    itemNames: new Map([...products, ...services].map((i) => [i.id, i.name])),
    catalogLabel: getBusinessExperience(business.category).catalogLabel,
    mainButton: layout ? { label: layout.cta.label, action: layout.cta.action } : null,
  })
}
