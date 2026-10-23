/**
 * Owner-readable page analytics — the merchant's own storefront, page by
 * page, from the same daily counters the learning system keeps (events.ts).
 * Nothing about visitors: counts of views, taps on the main button and
 * enquiries per page, and how many views came from phones. Small numbers
 * are shown as numbers; nothing is dressed up or extrapolated.
 *
 * `buildPageAnalytics` is pure; `getPageAnalytics` is the one database read.
 */

import { prisma } from '@/lib/prisma/client'
import { pageHref, type SitePage } from '@/modules/storefront-spec/pages'
import { loadSite } from '@/modules/storefront-spec/site'
import { pageKeyForSlug, storefrontDay } from './events'

export const PAGE_ANALYTICS_WINDOWS = [7, 30, 90] as const
export type PageAnalyticsWindow = (typeof PAGE_ANALYTICS_WINDOWS)[number]

export interface PageStatRow {
  event: string
  page: string
  device: string
  count: number
}

export interface PageAnalyticsRow {
  id: string
  title: string
  path: string
  /** Whether customers can open it today (hidden or empty pages still show history). */
  live: boolean
  views: number
  /** Taps on the main button and other calls to action on this page. */
  primaryTaps: number
  /** WhatsApp / call taps plus request forms sent from this page. */
  enquiries: number
  /** Of views with a known device class, the share from phones — null when none were classified. */
  phoneShare: number | null
}

export interface MostSharedProduct {
  id: string
  name: string
  /** All-time completed shares (Product.shareCount) — the plain number the merchant can quote. */
  shareCount: number
}

export interface PageAnalytics {
  days: PageAnalyticsWindow
  totals: { views: number; primaryTaps: number; enquiries: number; orders: number; bookings: number; phoneShare: number | null; shares: number }
  pages: PageAnalyticsRow[]
  /** Social products (Tab 7): products by all-time shares, most first; empty until something was shared. */
  mostShared: MostSharedProduct[]
  /** Views on pages that no longer exist in the page model (renamed or deleted), kept honest rather than dropped. */
  otherViews: number
}

function keyFor(page: SitePage): string {
  return page.kind === 'HOME' ? 'HOME' : pageKeyForSlug(page.slug)
}

function share(phone: number, known: number): number | null {
  return known > 0 ? Math.round((phone / known) * 100) : null
}

/** Pure: counters → one row per page in the owner's order, plus totals. */
export function buildPageAnalytics(rows: PageStatRow[], pages: SitePage[], liveIds: ReadonlySet<string>, basePath: string, days: PageAnalyticsWindow, mostShared: MostSharedProduct[] = []): PageAnalytics {
  const byPage = new Map<string, { views: number; taps: number; enquiries: number; phone: number; known: number }>()
  const bump = (key: string) => {
    let entry = byPage.get(key)
    if (!entry) {
      entry = { views: 0, taps: 0, enquiries: 0, phone: 0, known: 0 }
      byPage.set(key, entry)
    }
    return entry
  }
  let orders = 0
  let bookings = 0
  let shares = 0
  for (const r of rows) {
    const entry = bump(r.page)
    switch (r.event) {
      case 'PAGE_VIEW':
        entry.views += r.count
        if (r.device === 'MOBILE' || r.device === 'DESKTOP') {
          entry.known += r.count
          if (r.device === 'MOBILE') entry.phone += r.count
        }
        break
      case 'CTA_CLICK':
        entry.taps += r.count
        break
      case 'ENQUIRY_CLICK':
      case 'LEAD_SUBMITTED':
        entry.enquiries += r.count
        break
      case 'ORDER_PLACED':
        orders += r.count
        break
      case 'BOOKING_SUBMITTED':
        bookings += r.count
        break
      case 'PRODUCT_SHARE':
        shares += r.count
        break
    }
  }

  const seen = new Set<string>()
  const result: PageAnalyticsRow[] = pages.map((page) => {
    const key = keyFor(page)
    seen.add(key)
    const e = byPage.get(key) ?? { views: 0, taps: 0, enquiries: 0, phone: 0, known: 0 }
    return { id: page.id, title: page.title, path: pageHref(page, basePath), live: liveIds.has(page.id), views: e.views, primaryTaps: e.taps, enquiries: e.enquiries, phoneShare: share(e.phone, e.known) }
  })
  // Product pages are many; one line for all of them.
  const product = byPage.get('PRODUCT')
  if (product && product.views > 0) {
    seen.add('PRODUCT')
    result.push({ id: 'PRODUCT', title: 'Product pages', path: `${basePath}/product/…`, live: true, views: product.views, primaryTaps: product.taps, enquiries: product.enquiries, phoneShare: share(product.phone, product.known) })
  }
  // Hashtag pages (Tab 7) likewise: one line for all of them.
  const tag = byPage.get('TAG')
  if (tag && tag.views > 0) {
    seen.add('TAG')
    result.push({ id: 'TAG', title: 'Hashtag pages', path: `${basePath}/tag/…`, live: true, views: tag.views, primaryTaps: tag.taps, enquiries: tag.enquiries, phoneShare: share(tag.phone, tag.known) })
  }
  let otherViews = 0
  for (const [key, e] of byPage) if (!seen.has(key) && !['BASKET', 'CHECKOUT', 'CONFIGURE'].includes(key)) otherViews += e.views

  const all = [...byPage.values()]
  const totalKnown = all.reduce((n, e) => n + e.known, 0)
  const totalPhone = all.reduce((n, e) => n + e.phone, 0)
  return {
    days,
    totals: {
      views: all.reduce((n, e) => n + e.views, 0),
      primaryTaps: all.reduce((n, e) => n + e.taps, 0),
      enquiries: all.reduce((n, e) => n + e.enquiries, 0),
      orders,
      bookings,
      phoneShare: share(totalPhone, totalKnown),
      shares,
    },
    pages: result,
    mostShared,
    otherViews,
  }
}

/** The merchant's page analytics for the last `days` days. Scoped to their business only. */
export async function getPageAnalytics(businessId: string, days: PageAnalyticsWindow = 30, now: Date = new Date()): Promise<PageAnalytics> {
  const since = new Date(storefrontDay(now).getTime() - (days - 1) * 24 * 60 * 60 * 1000)
  const [grouped, business, mostShared] = await Promise.all([
    prisma.storefrontDailyStat.groupBy({ by: ['event', 'page', 'device'], where: { businessId, day: { gte: since } }, _sum: { count: true } }),
    prisma.business.findUniqueOrThrow({ where: { id: businessId } }),
    // All-time, this shop only; five is enough for a merchant to act on.
    prisma.product.findMany({ where: { businessId, shareCount: { gt: 0 } }, orderBy: [{ shareCount: 'desc' }, { name: 'asc' }], take: 5, select: { id: true, name: true, shareCount: true } }),
  ])
  const basePath = `/store/${business.slug}`
  const site = await loadSite(business, basePath)
  const live = new Set(site.pages.filter((p) => p.visible && (site.nav.some((i) => i.id === p.id) || site.footer.some((i) => i.id === p.id) || p.kind === 'HOME')).map((p) => p.id))
  const rows: PageStatRow[] = grouped.map((g) => ({ event: g.event, page: g.page, device: g.device, count: g._sum.count ?? 0 }))
  return buildPageAnalytics(rows, site.pages, live, basePath, days, mostShared)
}
