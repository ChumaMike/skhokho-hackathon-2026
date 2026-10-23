/**
 * Deterministic storefront-readiness recommendations — pure, no Prisma
 * import (the caller passes already-fetched data), no LLM.
 *
 * Critical rule: a check whose precondition doesn't hold is OMITTED from
 * the returned array entirely, never included as `resolved: true` noise —
 * this is the concrete mechanism for "never recommend a feature that
 * doesn't exist." There is deliberately no "no reviews yet" check — that
 * would frame a business's early days as an owner mistake, which this
 * engine must never do.
 */

import type { BusinessCapability } from './capabilities'
import type { DeliverySettings } from './capabilities'
import type { StorefrontSettings } from './storefront-theme'
import { deriveDefaultPrimaryAction, resolveHeroMode } from './storefront-theme'
import type { BusinessExperience } from './business-experience'
import { getBusinessExperience } from './business-experience'

export type StorefrontRecommendationType =
  | 'MISSING_LOGO'
  | 'HERO_IMAGE_NO_BANNER'
  | 'WHATSAPP_ACTION_NO_NUMBER'
  | 'MISSING_DESCRIPTION'
  | 'VISIT_ACTION_NO_LOCATION'
  | 'DELIVERY_NO_AREA_INFO'
  | 'PRODUCT_IMAGES_MISSING'
  | 'SERVICE_IMAGES_MISSING'
  | 'EMPTY_CATALOGUE'
  | 'TRY_NEW_STOREFRONT_DESIGN'

export interface StorefrontRecommendation {
  type: StorefrontRecommendationType
  message: string
  href: string
  resolved: boolean
}

export interface StorefrontRecommendationInput {
  business: {
    logoUrl?: string | null
    bannerUrl?: string | null
    whatsapp?: string | null
    phone?: string | null
    address?: string | null
    suburb?: string | null
    city?: string | null
    description?: string | null
  }
  capabilities: Set<BusinessCapability>
  storefront: StorefrontSettings
  delivery: DeliverySettings
  /** Map from listProductsForOwner(businessId) — only imageUrl is needed here. */
  products: { imageUrl: string | null }[]
  /** Map from listServicesForOwner(businessId) — only imageUrl is needed here. */
  services: { imageUrl: string | null }[]
  /**
   * Business Experience Registry entry (see business-experience.ts) — reused,
   * never a second terminology mapping. Optional and defaults to the
   * GENERAL/OTHER wording so existing callers that haven't wired category
   * through keep working unchanged (Storefront Console milestone §24).
   */
  experience?: BusinessExperience
  /**
   * From getStorefrontTemplateSelection(businessId) (tenant.service.ts) —
   * optional so existing callers that haven't wired it through keep working
   * (the check below is simply omitted, same as any other optional input
   * here). Only activeTemplateId is needed: CLASSIC-or-unset means the
   * business has never moved off the default page layout.
   */
  templateSelection?: { activeTemplateId: string | null }
}

// Fixed, category-independent messages. PRODUCT_IMAGES_MISSING,
// SERVICE_IMAGES_MISSING and EMPTY_CATALOGUE are computed dynamically below
// instead (terminology + real counts, §24 of the Storefront Console
// milestone: "3 menu items have no photo", not a generic "Some products...").
const MESSAGES: Record<Exclude<StorefrontRecommendationType, 'PRODUCT_IMAGES_MISSING' | 'SERVICE_IMAGES_MISSING' | 'EMPTY_CATALOGUE'>, string> = {
  MISSING_LOGO: 'Add a logo so customers recognise you at a glance.',
  HERO_IMAGE_NO_BANNER: "You've chosen a photo hero, but haven't added a cover photo yet.",
  WHATSAPP_ACTION_NO_NUMBER: "Your storefront's main action is WhatsApp, but no WhatsApp number is set.",
  MISSING_DESCRIPTION: 'Add a short description so customers know what you do.',
  VISIT_ACTION_NO_LOCATION: "Your storefront's main action is Visit us, but no address is set.",
  DELIVERY_NO_AREA_INFO: "Delivery is on, but customers aren't told which areas you deliver to.",
  TRY_NEW_STOREFRONT_DESIGN: 'Give your storefront a fresh new look — pick a layout built for your kind of business, or let us generate one.',
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}

/**
 * Every recommendation is truthful (computed from real data), links
 * somewhere it can actually be fixed, and disappears once resolved.
 */
export function getStorefrontRecommendations(input: StorefrontRecommendationInput): StorefrontRecommendation[] {
  const { business, capabilities, storefront, delivery, products, services } = input
  const experience = input.experience ?? getBusinessExperience('OTHER')
  // Deliberately the RAW saved choice (falling back only when nothing was
  // ever saved), NOT resolvePrimaryAction's safe/re-validated value — if
  // the merchant explicitly chose WHATSAPP and later lost their number,
  // this must still say "WHATSAPP_ACTION_NO_NUMBER" so the gap is
  // surfaced, not silently masked by a fallback the owner never asked for.
  // resolvePrimaryAction is for rendering only (StorefrontView) — it must
  // never leak into recommendation logic, or this exact gap goes silent.
  const primaryAction = storefront.theme.primaryAction ?? deriveDefaultPrimaryAction(capabilities, business)
  const heroMode = resolveHeroMode(storefront.theme, business)
  const recommendations: StorefrontRecommendation[] = []

  recommendations.push({
    type: 'MISSING_LOGO',
    message: MESSAGES.MISSING_LOGO,
    href: '/dashboard/storefront/business-information',
    resolved: !!business.logoUrl,
  })

  if (heroMode === 'IMAGE') {
    recommendations.push({
      type: 'HERO_IMAGE_NO_BANNER',
      message: MESSAGES.HERO_IMAGE_NO_BANNER,
      href: '/dashboard/storefront/design',
      resolved: !!business.bannerUrl,
    })
  }

  if (primaryAction === 'WHATSAPP') {
    recommendations.push({
      type: 'WHATSAPP_ACTION_NO_NUMBER',
      message: MESSAGES.WHATSAPP_ACTION_NO_NUMBER,
      href: '/dashboard/storefront/business-information',
      resolved: !!business.whatsapp,
    })
  }

  recommendations.push({
    type: 'MISSING_DESCRIPTION',
    message: MESSAGES.MISSING_DESCRIPTION,
    href: '/dashboard/storefront/business-information',
    resolved: !!business.description?.trim(),
  })

  if (primaryAction === 'VISIT') {
    recommendations.push({
      type: 'VISIT_ACTION_NO_LOCATION',
      message: MESSAGES.VISIT_ACTION_NO_LOCATION,
      href: '/dashboard/storefront/business-information',
      resolved: !!(business.address || business.suburb || business.city),
    })
  }

  if (capabilities.has('DELIVERY')) {
    recommendations.push({
      type: 'DELIVERY_NO_AREA_INFO',
      message: MESSAGES.DELIVERY_NO_AREA_INFO,
      href: '/dashboard/storefront/ordering',
      resolved: !delivery.enabled || !!delivery.areaInfo?.trim(),
    })
  }

  if (capabilities.has('PRODUCTS') && products.length > 0) {
    const missing = products.filter((p) => !p.imageUrl).length
    recommendations.push({
      type: 'PRODUCT_IMAGES_MISSING',
      message: `${missing} ${pluralize(missing, experience.itemSingular, experience.itemPlural).toLowerCase()} ${pluralize(missing, 'has', 'have')} no photo yet.`,
      href: '/dashboard/catalog',
      resolved: missing === 0,
    })
  }

  if (capabilities.has('SERVICES') && services.length > 0) {
    const missing = services.filter((s) => !s.imageUrl).length
    recommendations.push({
      type: 'SERVICE_IMAGES_MISSING',
      message: `${missing} ${pluralize(missing, experience.serviceItemSingular, experience.serviceItemPlural).toLowerCase()} ${pluralize(missing, 'has', 'have')} no photo yet.`,
      href: '/dashboard/catalog',
      resolved: missing === 0,
    })
  }

  const hasProducts = capabilities.has('PRODUCTS')
  const hasServices = capabilities.has('SERVICES')
  const emptyCatalogueMessage =
    hasProducts && hasServices
      ? `Add your first ${experience.itemSingular.toLowerCase()} or ${experience.serviceItemSingular.toLowerCase()} so customers have something to order or book.`
      : hasServices
        ? `Add your first ${experience.serviceItemSingular.toLowerCase()} so customers have something to book.`
        : `Add your first ${experience.itemSingular.toLowerCase()} so customers have something to order.`
  recommendations.push({
    type: 'EMPTY_CATALOGUE',
    message: emptyCatalogueMessage,
    href: '/dashboard/catalog',
    resolved: products.length > 0 || services.length > 0,
  })

  if (input.templateSelection) {
    const activeTemplateId = input.templateSelection.activeTemplateId
    recommendations.push({
      type: 'TRY_NEW_STOREFRONT_DESIGN',
      message: MESSAGES.TRY_NEW_STOREFRONT_DESIGN,
      href: '/dashboard/storefront/design',
      // null (no BusinessProfile row yet) resolves the same as CLASSIC —
      // both mean "still on the default layout." Deliberately does not try
      // to distinguish "defaulted here" from "explicitly chose Classic" —
      // there's no saved signal for that distinction today, and the message
      // above is worded to stay true either way.
      resolved: activeTemplateId !== null && activeTemplateId !== 'CLASSIC',
    })
  }

  return recommendations
}

/** Convenience for surfaces that only want the still-outstanding items. */
export function getUnresolvedStorefrontRecommendations(input: StorefrontRecommendationInput): StorefrontRecommendation[] {
  return getStorefrontRecommendations(input).filter((r) => !r.resolved)
}
