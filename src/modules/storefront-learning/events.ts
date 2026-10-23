/**
 * Storefront behaviour signals — recorded ONLY as daily counters.
 *
 * What is never collected: any identifier for a visitor or customer, IP
 * addresses, user agents, cookies, names, phone numbers, emails, free text,
 * URLs or referrers. An event is just "this happened, on this day, on this
 * storefront version / page / section / catalogue item, on a phone or a
 * computer" — so nothing stored can single anyone out, and there is nothing
 * personal to delete per visitor.
 *
 * Client events come from the storefront beacon (honouring Do Not Track /
 * Global Privacy Control); orders and bookings are counted server-side
 * where they're created, so the most important numbers can't be faked from
 * a browser.
 */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { StorefrontEventType } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { getStorefrontLayout } from '@/modules/storefront-spec/layout'

export const STOREFRONT_EVENT_TYPES = [
  'PAGE_VIEW',
  'PRODUCT_VIEW',
  'CTA_CLICK',
  'ADD_TO_BASKET',
  'CHECKOUT_START',
  'ORDER_PLACED',
  'BOOKING_SUBMITTED',
  'ENQUIRY_CLICK',
  'LEAD_SUBMITTED',
  'PRODUCT_SHARE',
] as const satisfies readonly StorefrontEventType[]

/** Only these may come from a browser; orders, bookings, saved leads and completed shares are counted server-side. */
export const CLIENT_EVENT_TYPES = ['PAGE_VIEW', 'PRODUCT_VIEW', 'CTA_CLICK', 'ADD_TO_BASKET', 'CHECKOUT_START', 'ENQUIRY_CLICK'] as const

/**
 * Pages with a route of their own. Every other storefront page — services,
 * reviews, policies, request forms, the owner's custom pages — is counted
 * as `page:<slug>` (OWNER_PAGE below): the slug is the page's own address
 * from the page model, lowercase letters, digits and dashes only, never
 * free text.
 */
export const STOREFRONT_PAGES = ['HOME', 'SHOP', 'ABOUT', 'CONTACT', 'GALLERY', 'PRODUCT', 'BASKET', 'CHECKOUT', 'CONFIGURE', 'TAG'] as const
export const OWNER_PAGE = /^page:[a-z0-9]+(?:-[a-z0-9]+)*$/
export const STOREFRONT_SECTIONS = ['HERO', 'NAV', 'TRUST_BAR', 'CATALOGUE', 'ABOUT', 'REVIEWS', 'CONTACT'] as const
export const DEVICES = ['MOBILE', 'DESKTOP'] as const

export type StorefrontPage = (typeof STOREFRONT_PAGES)[number] | `page:${string}`

/** The counter key for a storefront address: '' → HOME, 'shop' → SHOP, …, anything else → page:<slug>. */
export function pageKeyForSlug(slug: string): StorefrontPage {
  switch (slug) {
    case '':
      return 'HOME'
    case 'shop':
      return 'SHOP'
    case 'about':
      return 'ABOUT'
    case 'contact':
      return 'CONTACT'
    case 'gallery':
      return 'GALLERY'
    default:
      return `page:${slug}`
  }
}

/** One browser event. Every field is an enum, a page address or a catalogue id — no free text can get in. */
export const ClientEventSchema = z
  .object({
    type: z.enum(CLIENT_EVENT_TYPES),
    page: z.union([z.enum(STOREFRONT_PAGES), z.string().max(48).regex(OWNER_PAGE)]),
    section: z.enum(STOREFRONT_SECTIONS).optional(),
    itemId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  })
  .strict()

export const EventBatchSchema = z
  .object({
    businessId: z.string().uuid(),
    device: z.enum(DEVICES).optional(),
    events: z.array(ClientEventSchema).min(1).max(10),
  })
  .strict()

export type ClientEvent = z.infer<typeof ClientEventSchema>

export interface CounterEvent {
  type: StorefrontEventType
  page?: string
  section?: string
  itemId?: string
}

/**
 * The calendar day in South Africa (UTC+2, no daylight saving) — so a
 * merchant's "today" matches theirs, not UTC's.
 */
export function storefrontDay(now: Date): Date {
  const sast = new Date(now.getTime() + 2 * 60 * 60 * 1000)
  return new Date(Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), sast.getUTCDate()))
}

/**
 * Adds events to this business's daily counters, attributed to whatever
 * storefront version is live right now. One atomic INSERT … ON CONFLICT per
 * distinct counter, so concurrent visitors never lose a count.
 */
export async function recordStorefrontEvents(
  businessId: string,
  events: CounterEvent[],
  options: { device?: 'MOBILE' | 'DESKTOP'; now?: Date; settings?: unknown } = {},
): Promise<void> {
  if (events.length === 0) return
  const settings =
    options.settings !== undefined
      ? options.settings
      : (await prisma.business.findUnique({ where: { id: businessId }, select: { settings: true } }))?.settings
  const layout = getStorefrontLayout({ settings })
  const day = storefrontDay(options.now ?? new Date())
  const revisionId = layout?.revisionId ?? ''
  const templateId = layout?.templateId ?? ''
  const device = options.device ?? ''

  // Merge identical events in the batch into one increment.
  const merged = new Map<string, CounterEvent & { n: number }>()
  for (const e of events) {
    const key = [e.type, e.page ?? '', e.section ?? '', e.itemId ?? ''].join('|')
    const existing = merged.get(key)
    if (existing) existing.n += 1
    else merged.set(key, { ...e, n: 1 })
  }

  for (const e of merged.values()) {
    await prisma.$executeRaw`
      INSERT INTO "storefront_daily_stats"
        ("id", "business_id", "day", "revision_id", "template_id", "event", "page", "section", "item_id", "device", "count")
      VALUES
        (${`sds_${randomUUID()}`}, ${businessId}::uuid, ${day}::date, ${revisionId}, ${templateId},
         ${e.type}::"StorefrontEventType", ${e.page ?? ''}, ${e.section ?? ''}, ${e.itemId ?? ''}, ${device}, ${e.n})
      ON CONFLICT ("business_id", "day", "revision_id", "template_id", "event", "page", "section", "item_id", "device")
      DO UPDATE SET "count" = "storefront_daily_stats"."count" + EXCLUDED."count"
    `
  }
}

/**
 * Server-side counting for orders and bookings. Never throws — losing a
 * statistic must never fail a customer's order.
 */
export async function countServerEvent(businessId: string, type: 'ORDER_PLACED' | 'BOOKING_SUBMITTED' | 'LEAD_SUBMITTED', page: StorefrontPage): Promise<void> {
  try {
    await recordStorefrontEvents(businessId, [{ type, page }])
  } catch (e) {
    console.error('[storefront-learning] could not count', type, e)
  }
}

// Ingestion rate limiting lives in src/lib/rate-limit.ts (shared across instances).
