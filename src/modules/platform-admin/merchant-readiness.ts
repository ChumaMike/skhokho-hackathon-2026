/**
 * Merchant readiness — "can this business trade today?", derived from real
 * system state only. Nothing here is a typed label: every line comes from the
 * same settings, rows and platform configuration the storefront and checkout
 * read, so the Control Centre can never say READY while a customer is stuck.
 *
 * Two layers:
 *   computeMerchantReadiness(input)  pure, unit-testable, no Prisma
 *   loadMerchantReadiness(ids)       one batched read per table for N businesses
 *
 * A check is NOT_APPLICABLE when the business model doesn't use it (a salon
 * has no delivery; a cash shop has no card connection), so a legitimate
 * business is never marked NOT READY for something it doesn't need.
 */

import type { BusinessCategory, BusinessStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { isEmailConfigured } from '@/lib/email'
import { isGeocodingConfigured } from '@/lib/geocoding'
import { getBusinessCapabilities, getDeliverySettings, getFulfilmentSettings, getPaymentSettings } from '@/modules/tenant/capabilities'
import { hasConfiguredHours } from '@/modules/tenant/operating-hours'
import { legalInformationGaps, LEGAL_GAP_LABELS } from '@/modules/tenant/legal-information'
import { getTradingStatus } from '@/modules/tenant/trading-status'
import { lethaEnabled } from '@/modules/skhokholetha/flags'

export type ReadinessState = 'READY' | 'NEEDS_ACTION' | 'BLOCKED' | 'NOT_APPLICABLE'
export type OverallReadiness = 'READY_TO_TRADE' | 'NOT_READY_TO_TRADE' | 'BLOCKED'

export type ReadinessKey =
  | 'profile'
  | 'storefront'
  | 'catalogue'
  | 'hours'
  | 'staff'
  | 'fulfilment'
  | 'collection'
  | 'delivery'
  | 'deliveryAreas'
  | 'payments'
  | 'email'
  | 'legal'

export interface ReadinessCheck {
  key: ReadinessKey
  label: string
  state: ReadinessState
  /** One plain sentence an operator can read out to the merchant. */
  detail: string
}

export interface MerchantReadiness {
  overall: OverallReadiness
  checks: ReadinessCheck[]
  /** The NEEDS_ACTION / BLOCKED details, in order — what to tell the merchant. */
  actions: string[]
  trading: { state: 'OPEN' | 'CLOSED' | 'PAUSED'; label: string }
}

export interface ReadinessInput {
  status: BusinessStatus
  category: BusinessCategory
  settings: unknown
  operatingHours: unknown
  phone: string | null
  whatsapp: string | null
  email: string | null
  latitude: number | null
  longitude: number | null
  activeProducts: number
  activeServices: number
  /** Active staff rows including the owner. */
  activeStaff: number
  /** Active staff rows that still hold an unused invitation. */
  pendingInvites: number
  activeZones: number
  /** The business's own LIVE PayFast connection (never retired), if any. */
  liveConnection: { status: 'PENDING_VERIFICATION' | 'VERIFIED' | 'INVALID' | 'DISABLED' | 'SUPERSEDED' } | null
  platform: { emailConfigured: boolean; networkDeliveryEnabled: boolean; geocodingConfigured: boolean }
}

const LABELS: Record<ReadinessKey, string> = {
  profile: 'Business profile',
  storefront: 'Storefront',
  catalogue: 'Products / services',
  hours: 'Opening hours',
  staff: 'Staff',
  fulfilment: 'Fulfilment',
  collection: 'Collection',
  delivery: 'Delivery',
  deliveryAreas: 'Delivery areas',
  payments: 'Payments',
  email: 'Email',
  legal: 'Legal information',
}

export function platformReadinessConfig(): ReadinessInput['platform'] {
  return { emailConfigured: isEmailConfigured(), networkDeliveryEnabled: lethaEnabled('network'), geocodingConfigured: isGeocodingConfigured() }
}

export function computeMerchantReadiness(input: ReadinessInput, now: Date = new Date()): MerchantReadiness {
  const checks: ReadinessCheck[] = []
  const add = (key: ReadinessKey, state: ReadinessState, detail: string) => checks.push({ key, label: LABELS[key], state, detail })
  const caps = getBusinessCapabilities({ category: input.category, settings: input.settings })
  const takesOrders = caps.has('ORDERS')
  const takesBookings = caps.has('BOOKINGS')
  const hasPin = typeof input.latitude === 'number' && typeof input.longitude === 'number'

  // Profile: customers need one way to reach the shop.
  if (input.phone || input.whatsapp) add('profile', 'READY', `Contact ${input.whatsapp ? 'WhatsApp' : 'phone'} on the storefront${hasPin ? ' · address pinned' : ' · address not pinned'}.`)
  else add('profile', 'NEEDS_ACTION', 'No phone or WhatsApp number — customers have no way to contact the shop.')

  // Storefront: only an ACTIVE business is visible at all.
  if (input.status === 'ACTIVE') add('storefront', 'READY', 'Published and visible to customers.')
  else if (input.status === 'PENDING_VERIFICATION') add('storefront', 'NEEDS_ACTION', 'Not published yet — the owner publishes from Dashboard › Storefront once there is a product or service.')
  else add('storefront', 'BLOCKED', `Business is ${input.status.toLowerCase().replace('_', ' ')} — storefront and console are offline.`)

  // Catalogue: whichever the business sells.
  const items = (takesOrders || caps.has('PRODUCTS') ? input.activeProducts : 0) + (takesBookings || caps.has('SERVICES') ? input.activeServices : 0)
  if (items > 0) add('catalogue', 'READY', `${input.activeProducts} active product(s), ${input.activeServices} active service(s).`)
  else add('catalogue', 'NEEDS_ACTION', 'Nothing active to sell — add at least one product or service.')

  // Hours: without them the shop shows as always open, which is rarely true.
  if (hasConfiguredHours(input.operatingHours)) add('hours', 'READY', 'Trading hours set.')
  else add('hours', 'NEEDS_ACTION', 'No opening hours — the storefront treats the shop as always open.')

  // Staff: an owner can run alone; pending invites are information, not a block.
  add('staff', 'READY', `${input.activeStaff} active (owner included)${input.pendingInvites ? ` · ${input.pendingInvites} invite(s) not yet accepted` : ''}.`)

  // Fulfilment (order-taking businesses only).
  if (!takesOrders) {
    add('fulfilment', 'NOT_APPLICABLE', 'Bookings business — no checkout.')
    add('collection', 'NOT_APPLICABLE', '—')
    add('delivery', 'NOT_APPLICABLE', '—')
    add('deliveryAreas', 'NOT_APPLICABLE', '—')
  } else {
    const f = getFulfilmentSettings({ settings: input.settings })
    const d = getDeliverySettings({ settings: input.settings })
    if (!f.collectionEnabled && !f.deliveryEnabled) add('fulfilment', 'NEEDS_ACTION', 'Neither collection nor delivery is on — customers cannot check out.')
    else add('fulfilment', 'READY', `${f.collectionEnabled ? 'Collection' : ''}${f.collectionEnabled && f.deliveryEnabled ? ' + ' : ''}${f.deliveryEnabled ? 'Delivery' : ''}.`)

    add('collection', f.collectionEnabled ? 'READY' : 'NOT_APPLICABLE', f.collectionEnabled ? 'Customers can collect.' : 'Collection switched off.')

    if (!f.deliveryEnabled) {
      add('delivery', 'NOT_APPLICABLE', 'Delivery switched off.')
      add('deliveryAreas', 'NOT_APPLICABLE', '—')
    } else {
      const source = f.deliverySources
      const problems: string[] = []
      if (source === 'NETWORK' && !input.platform.networkDeliveryEnabled) problems.push('only Skhokholetha drivers are allowed but the network is switched off on the platform')
      if (source !== 'OWN' && !hasPin) problems.push('Skhokholetha needs the shop address pinned on the map')
      if (d.pricingMode === 'PER_KM' && !hasPin) problems.push('distance pricing needs the shop address pinned')
      if (d.pricingMode === 'PER_KM' && !input.platform.geocodingConfigured) problems.push('distance pricing needs the Google Maps key on the platform')
      const mode = d.pricingMode === 'ZONE' ? 'zone pricing' : d.pricingMode === 'PER_KM' ? 'distance pricing' : `flat fee R ${(d.feeCents / 100).toFixed(2)}`
      const who = source === 'OWN' ? 'own drivers' : source === 'NETWORK' ? 'Skhokholetha' : 'own drivers + Skhokholetha'
      if (problems.length) add('delivery', 'NEEDS_ACTION', `On (${mode}, ${who}) but ${problems.join('; ')}.`)
      else add('delivery', 'READY', `On · ${mode} · ${who}.`)

      if (d.pricingMode !== 'ZONE') add('deliveryAreas', 'NOT_APPLICABLE', d.pricingMode === 'PER_KM' ? `Distance pricing${d.maxDistanceKm ? ` up to ${d.maxDistanceKm} km` : ''}.` : 'Flat fee — no areas needed.')
      else if (input.activeZones > 0) add('deliveryAreas', 'READY', `${input.activeZones} active area(s).`)
      else add('deliveryAreas', 'NEEDS_ACTION', 'Zone pricing is on but no active delivery area exists — every delivery address is refused.')
    }
  }

  // Payments: in-person is a complete, legitimate model; "online wanted but not live" is the gap.
  const wantsOnline = getPaymentSettings({ settings: input.settings }).online
  const live = input.liveConnection
  // Bookings are paid in person by design (there is no card step in the booking flow).
  if (!takesOrders) add('payments', 'NOT_APPLICABLE', takesBookings ? 'Bookings are paid in person — no card checkout.' : '—')
  else if (!wantsOnline) add('payments', 'READY', 'Pay in person (card payments switched off by the owner).')
  else if (live?.status === 'VERIFIED') add('payments', 'READY', 'Card payments live — verified PayFast account.')
  else if (!live) add('payments', 'NEEDS_ACTION', 'Card payments are on but no PayFast account is connected — customers pay in person until it is verified.')
  else add('payments', 'NEEDS_ACTION', `Card payments are on but the PayFast account is ${live.status.toLowerCase().replace('_', ' ')} — customers pay in person until it is verified.`)

  // Email: platform-level; the merchant cannot fix this one.
  if (input.platform.emailConfigured) add('email', 'READY', 'Order and staff emails are sent.')
  else add('email', 'NEEDS_ACTION', 'Platform email is not configured — no order confirmations, invites or password resets go out (platform action).')

  // Legal: the ECTA s43 block every storefront footer shows (Dashboard ›
  // Settings › Legal). Missing pieces mean the published storefront names
  // the trading name as the seller and has no returns terms — the footer
  // renders fallbacks rather than inventing them, so this is where the gap
  // is made visible. A complaints contact falls back to the shop's own
  // contact details, so it is only a gap when the profile has none either.
  const legalGaps = legalInformationGaps({ settings: input.settings, phone: input.phone, whatsapp: input.whatsapp, email: input.email })
  if (legalGaps.length === 0) add('legal', 'READY', 'Legal name, returns terms and complaints contact shown on the storefront.')
  else add('legal', 'NEEDS_ACTION', `Storefront legal block incomplete — missing ${legalGaps.map((g) => LEGAL_GAP_LABELS[g]).join(', ')} (Dashboard › Settings › Legal).`)

  const blocked = checks.some((c) => c.state === 'BLOCKED')
  const needs = checks.some((c) => c.state === 'NEEDS_ACTION')
  const overall: OverallReadiness = blocked ? 'BLOCKED' : needs ? 'NOT_READY_TO_TRADE' : 'READY_TO_TRADE'
  const trading = getTradingStatus({ settings: input.settings, operatingHours: input.operatingHours }, now)
  return {
    overall,
    checks,
    actions: checks.filter((c) => c.state === 'NEEDS_ACTION' || c.state === 'BLOCKED').map((c) => `${c.label}: ${c.detail}`),
    trading: { state: trading.state, label: trading.label },
  }
}

/**
 * Readiness for several businesses with one query per table (no per-business
 * fan-out), so the list page costs the same for 1 or 50 rows. Returns a map
 * keyed by business id; ids that don't exist are simply absent.
 */
export async function loadMerchantReadiness(businessIds: string[], now: Date = new Date()): Promise<Map<string, MerchantReadiness>> {
  const out = new Map<string, MerchantReadiness>()
  if (businessIds.length === 0) return out
  const ids = Array.from(new Set(businessIds)).slice(0, 500)
  const inIds = { businessId: { in: ids } }
  const [businesses, products, services, staff, invites, zones, connections] = await Promise.all([
    prisma.business.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, category: true, settings: true, operatingHours: true, phone: true, whatsapp: true, email: true, latitude: true, longitude: true },
    }),
    prisma.product.groupBy({ by: ['businessId'], where: { ...inIds, isActive: true }, _count: { _all: true } }),
    prisma.service.groupBy({ by: ['businessId'], where: { ...inIds, isActive: true }, _count: { _all: true } }),
    prisma.businessStaff.groupBy({ by: ['businessId'], where: { ...inIds, isActive: true }, _count: { _all: true } }),
    prisma.businessStaff.groupBy({ by: ['businessId'], where: { ...inIds, isActive: true, isOwner: false, resetToken: { not: null }, lastLoginAt: null }, _count: { _all: true } }),
    prisma.deliveryZone.groupBy({ by: ['businessId'], where: { ...inIds, active: true }, _count: { _all: true } }),
    prisma.businessPaymentConnection.findMany({ where: { ...inIds, provider: 'PAYFAST', environment: 'LIVE', retiredAt: null }, select: { businessId: true, status: true } }),
  ])
  const countBy = (rows: { businessId: string; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.businessId, r._count._all]))
  const p = countBy(products)
  const s = countBy(services)
  const st = countBy(staff)
  const inv = countBy(invites)
  const z = countBy(zones)
  const conn = new Map(connections.map((c) => [c.businessId, { status: c.status }]))
  const platform = platformReadinessConfig()
  for (const b of businesses) {
    out.set(
      b.id,
      computeMerchantReadiness(
        {
          status: b.status,
          category: b.category,
          settings: b.settings,
          operatingHours: b.operatingHours,
          phone: b.phone,
          whatsapp: b.whatsapp,
          email: b.email,
          latitude: b.latitude,
          longitude: b.longitude,
          activeProducts: p.get(b.id) ?? 0,
          activeServices: s.get(b.id) ?? 0,
          activeStaff: st.get(b.id) ?? 0,
          pendingInvites: inv.get(b.id) ?? 0,
          activeZones: z.get(b.id) ?? 0,
          liveConnection: conn.get(b.id) ?? null,
          platform,
        },
        now,
      ),
    )
  }
  return out
}

/** Overview figure: how many non-suspended businesses could trade right now. Bounded by the same 500-row cap. */
export async function readinessSummary(now: Date = new Date()): Promise<{ readyToTrade: number; notReady: number; blocked: number; considered: number }> {
  const rows = await prisma.business.findMany({ where: { status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] } }, select: { id: true }, orderBy: { createdAt: 'desc' }, take: 500 })
  const m = await loadMerchantReadiness(
    rows.map((r) => r.id),
    now,
  )
  let readyToTrade = 0
  let notReady = 0
  let blocked = 0
  for (const r of m.values()) {
    if (r.overall === 'READY_TO_TRADE') readyToTrade += 1
    else if (r.overall === 'BLOCKED') blocked += 1
    else notReady += 1
  }
  return { readyToTrade, notReady, blocked, considered: m.size }
}
