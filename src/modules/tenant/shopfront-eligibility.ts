import type { BusinessCategory } from '@prisma/client'
import { getBusinessCapabilities } from './capabilities'
import { getStorefrontLayout, templateFits } from '@/modules/storefront-spec/layout'

/**
 * Connected Shopfront redesign — Phase 1 scope.
 *
 * The old template/preset system (storefront-templates.ts) only ever varies
 * which pages exist or which token values apply — it can't express a
 * genuinely different visual design, so this redesign is a net-new
 * component tree (src/components/storefront/shopfront/) rather than an
 * extension of it. Full replacement is the end goal, but it ships in
 * phases: Phase 1 covers product-catalogue businesses (reusing the real
 * catalog/cart/checkout stack as-is); Phase 2 (below) extends it to
 * services/booking businesses. Every category not covered by either check
 * keeps rendering on the current system.
 *
 * Reuses the exact category groupings already established in
 * storefront-templates.ts's FOOD_MENU/RETAIL_CATALOGUE `categoryFit`
 * rather than hardcoding a second list that could drift from it.
 */
const SHOPFRONT_CATEGORIES: BusinessCategory[] = ['FOOD_VENDOR', 'RETAIL_STORE', 'TUCK_SHOP']

export function isShopfrontCategory(category: BusinessCategory): boolean {
  return SHOPFRONT_CATEGORIES.includes(category)
}

/**
 * Connected Shopfront redesign — Phase 2 scope (services/booking).
 *
 * A visually distinct variant of the same redesign philosophy — a centered
 * nav (src/components/storefront/shopfront-booking/), not the Phase 1
 * product Shopfront's top-right nav — for businesses whose storefront job
 * is booking an appointment, not browsing a catalogue. Reuses
 * storefront-templates.ts's SALON_BOOKING/SERVICES_TRUST `categoryFit`
 * groupings combined, same anti-drift reasoning as isShopfrontCategory
 * above. Checked BEFORE isShopfrontCategory at every cutover site — the
 * two lists are disjoint today, but this ordering is what keeps them that
 * way by construction rather than by coincidence.
 */
const SHOPFRONT_BOOKING_CATEGORIES: BusinessCategory[] = [
  'SALON',
  'HAIR_BRAIDER',
  'NAIL_TECHNICIAN',
  'CAR_WASH',
  'MECHANIC',
  'EVENTS',
  'CHILDCARE',
  'LAUNDRY',
]

export function isShopfrontBookingCategory(category: BusinessCategory): boolean {
  return SHOPFRONT_BOOKING_CATEGORIES.includes(category)
}

export type StorefrontVariant = 'PRODUCT' | 'BOOKING' | 'LEGACY'

/**
 * The single decision for which storefront design a business gets.
 *
 * Premium is the default for every category. Services/booking categories get
 * the booking variant, everything else the product variant. An owner who has
 * explicitly chosen the old design (settings.storefront.design === 'LEGACY')
 * keeps StorefrontView. Every cutover site asks this one function, so the
 * rule can't drift between routes.
 */
export function resolveStorefrontVariant(business: {
  category: BusinessCategory
  settings: unknown
}): StorefrontVariant {
  const settings = (business.settings ?? {}) as { storefront?: { design?: unknown } }
  if (settings.storefront?.design === 'LEGACY') return 'LEGACY'
  // A published storefront spec chose a template — honoured only while the
  // business can still serve it (booking needs services, the catalogue
  // template needs products), so a capability change never strands a store
  // on a template with nothing in it.
  const layout = getStorefrontLayout(business)
  if (layout && templateFits(layout.template, getBusinessCapabilities(business))) return layout.template
  if (isShopfrontBookingCategory(business.category)) return 'BOOKING'
  return 'PRODUCT'
}
