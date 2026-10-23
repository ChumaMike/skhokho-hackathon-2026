/**
 * Business Experience Registry — the ONE place BusinessCategory maps to
 * merchant-facing terminology. Nothing else in the codebase should branch
 * on `category` to decide what to call things; this is that branch,
 * centralised, per the adaptive Business Console milestone.
 *
 * Deliberately semantic/presentation-only: this file does NOT decide what
 * a business can actually do (that stays capabilities.ts's job, see
 * BusinessCapability) and does NOT decide who's allowed to do it (that
 * stays StaffPermissions). A business's Product rows are never renamed to
 * "MenuItem" — Product/Service remain the internal domain entities; this
 * registry only changes the words shown to the merchant around them.
 *
 * Every BusinessCategory enum value (prisma/schema.prisma) has an entry.
 * OTHER doubles as the GENERAL fallback — same wording an unclassified
 * legacy business already gets the broadest capability defaults for
 * (capabilities.ts's DEFAULT_CAPABILITIES_BY_CATEGORY.OTHER).
 */

import type { BusinessCategory } from '@prisma/client'

export interface BusinessExperience {
  /** Nav/section label for the PRODUCTS catalogue, e.g. "Menu" / "Products" / "Parts". */
  catalogLabel: string
  itemSingular: string
  itemPlural: string
  addItemLabel: string
  /** Nav/section label for the SERVICES catalogue. Doesn't vary by category today — every
   *  vertical that offers services calls them "Services" — but kept as its own field so a
   *  future category-specific wording (e.g. a salon's "Treatments") doesn't require a
   *  reshape of every caller. */
  serviceCatalogLabel: string
  serviceItemSingular: string
  serviceItemPlural: string
  addServiceLabel: string

  // -------------------------------------------------------------------------
  // Vertical Editor Foundation (Phase 3) — presentation-only hint copy for
  // the Product/Service editor. Deliberately living on the SAME registry
  // entry as the terminology above, not a second mapping (§18): the
  // "editor profile" a category gets is just more strings keyed by the same
  // BusinessCategory, resolved through the same getBusinessExperience().
  // -------------------------------------------------------------------------

  /** §16 image guidance shown above the Product photo field. */
  photoGuidance: string
  /** §16 image guidance shown above the Service photo field. */
  servicePhotoGuidance: string
  /** §12 consequence copy next to the Product Hide/Show control. */
  availabilityHint: string
  /** §12 consequence copy next to the Service Hide/Show control. */
  serviceAvailabilityHint: string

  // -------------------------------------------------------------------------
  // Food Menu Domain Foundation (Phase 4) §21 — NOT a capability. A Menu
  // Category / MenuOptionGroup is presentation/editor-surface gating, the
  // same kind of decision `photoGuidance` etc. already make; it doesn't
  // change what a business can DO (BusinessCapability still owns that), so
  // it belongs on this registry, not a new capability flag. False for every
  // category except FOOD_VENDOR — see §20: Retail/Salon/Mechanic must never
  // surface Menu categories or option groups in their editor.
  // -------------------------------------------------------------------------
  supportsMenuOptions: boolean
}

// Shared across every category today — every vertical's Hide/Show control
// means exactly the same thing underneath (setProductActive/setServiceActive
// toggling isActive). Kept as a named constant rather than inlined so a
// future category-specific nuance is a one-line change, not a reshape.
const GENERIC_AVAILABILITY_HINT = "Hide this from customers without deleting it."

const GENERAL_EXPERIENCE: BusinessExperience = {
  catalogLabel: 'Products',
  itemSingular: 'Product',
  itemPlural: 'Products',
  addItemLabel: 'Add product',
  serviceCatalogLabel: 'Services',
  serviceItemSingular: 'Service',
  serviceItemPlural: 'Services',
  addServiceLabel: 'Add service',
  photoGuidance: 'Show the actual product.',
  servicePhotoGuidance: 'Show what customers can expect.',
  availabilityHint: GENERIC_AVAILABILITY_HINT,
  serviceAvailabilityHint: GENERIC_AVAILABILITY_HINT,
  supportsMenuOptions: false,
}

const FOOD_EXPERIENCE: BusinessExperience = {
  catalogLabel: 'Menu',
  itemSingular: 'Menu item',
  itemPlural: 'Menu items',
  addItemLabel: 'Add menu item',
  serviceCatalogLabel: 'Services',
  serviceItemSingular: 'Service',
  serviceItemPlural: 'Services',
  addServiceLabel: 'Add service',
  photoGuidance: 'Use a clear photo of this menu item.',
  servicePhotoGuidance: 'Show what customers can expect.',
  availabilityHint: GENERIC_AVAILABILITY_HINT,
  serviceAvailabilityHint: GENERIC_AVAILABILITY_HINT,
  supportsMenuOptions: true,
}

const MECHANIC_EXPERIENCE: BusinessExperience = {
  catalogLabel: 'Parts',
  itemSingular: 'Part',
  itemPlural: 'Parts',
  addItemLabel: 'Add part',
  serviceCatalogLabel: 'Services',
  serviceItemSingular: 'Service',
  serviceItemPlural: 'Services',
  addServiceLabel: 'Add service',
  photoGuidance: 'Show the actual part.',
  servicePhotoGuidance: 'Show the work you’ll be doing.',
  availabilityHint: GENERIC_AVAILABILITY_HINT,
  serviceAvailabilityHint: GENERIC_AVAILABILITY_HINT,
  // A Mechanic's "menu" isn't a food menu — no Menu Category/option-group
  // editor for parts (§20/§21 scope this to Food specifically).
  supportsMenuOptions: false,
}

const BUSINESS_EXPERIENCE_BY_CATEGORY: Record<BusinessCategory, BusinessExperience> = {
  FOOD_VENDOR: FOOD_EXPERIENCE,
  // A tuck shop sells packaged goods off a shelf, not an order-a-dish menu
  // — Products fits how the owner actually thinks about their stock.
  TUCK_SHOP: GENERAL_EXPERIENCE,
  RETAIL_STORE: GENERAL_EXPERIENCE,
  MECHANIC: MECHANIC_EXPERIENCE,
  // No PRODUCTS capability by default for these (capabilities.ts) — the
  // product-side wording is inert unless an owner explicitly opts in, in
  // which case the generic fallback is the honest default.
  SALON: GENERAL_EXPERIENCE,
  HAIR_BRAIDER: GENERAL_EXPERIENCE,
  NAIL_TECHNICIAN: GENERAL_EXPERIENCE,
  CAR_WASH: GENERAL_EXPERIENCE,
  EVENTS: GENERAL_EXPERIENCE,
  CHILDCARE: GENERAL_EXPERIENCE,
  LAUNDRY: GENERAL_EXPERIENCE,
  OTHER: GENERAL_EXPERIENCE,
}

export function getBusinessExperience(category: BusinessCategory): BusinessExperience {
  return BUSINESS_EXPERIENCE_BY_CATEGORY[category] ?? GENERAL_EXPERIENCE
}

/**
 * The single label for "the catalogue" nav module/section when a business
 * may have PRODUCTS, SERVICES, both, or (transitionally) neither. Never
 * renders an empty/dead label — callers gate the module's visibility on
 * capabilities separately (see admin-modules.ts).
 */
export function resolveCatalogLabel(experience: BusinessExperience, hasProducts: boolean, hasServices: boolean): string {
  if (hasProducts && hasServices) return `${experience.catalogLabel} & ${experience.serviceCatalogLabel}`
  if (hasServices) return experience.serviceCatalogLabel
  return experience.catalogLabel
}
