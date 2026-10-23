/**
 * Vertical Editor Foundation (Phase 3) — resolves the Product/Service editor's
 * section headings, field labels, and hint copy from the SAME Business
 * Experience Registry entry Phases 1-2 already use (business-experience.ts).
 * Not a second terminology mapping (§18): every string here is either taken
 * directly from a BusinessExperience field or composed from one.
 *
 * Deliberately does NOT encode field visibility rules — every category today
 * shows exactly the same real fields (see catalog.service.ts's
 * CreateProductSchema/CreateServiceSchema, the actual, current, authoritative
 * field set). There is no genuine per-vertical field difference yet, so this
 * file doesn't invent one; a future vertical field would extend the
 * `ProductEditorProfile`/`ServiceEditorProfile` shape returned here, not
 * scatter a new `if (category === ...)` through the page.
 */

import type { BusinessExperience } from './business-experience'

export interface EditorSection {
  heading: string
}

export interface ProductEditorProfile {
  itemNoun: string
  addLabel: string
  basic: EditorSection & { nameLabel: string; descriptionLabel: string }
  pricing: EditorSection & { priceLabel: string }
  media: EditorSection & { photoLabel: string; guidance: string }
  availability: EditorSection & { onLabel: string; hint: string }
}

export interface ServiceEditorProfile {
  itemNoun: string
  addLabel: string
  basic: EditorSection & { nameLabel: string; descriptionLabel: string }
  pricing: EditorSection & { priceLabel: string }
  booking: EditorSection & { durationLabel: string; maxBookingsLabel: string }
  media: EditorSection & { photoLabel: string; guidance: string }
  availability: EditorSection & { onLabel: string; hint: string }
}

/**
 * `hasOrders` decides the availability field's consequence copy (§12):
 * a business with PRODUCTS but no ORDERS capability shows products as a
 * plain browsable listing (no Add-to-basket control at all — see
 * ProductsSection.tsx's `ordersEnabled` gate), so "Available for ordering"
 * would overpromise. Same real distinction, not an invented one.
 */
export function getProductEditorProfile(experience: BusinessExperience, hasOrders: boolean): ProductEditorProfile {
  return {
    itemNoun: experience.itemSingular,
    addLabel: experience.addItemLabel,
    basic: {
      heading: 'Basic information',
      nameLabel: `${experience.itemSingular} name`,
      descriptionLabel: 'Description',
    },
    pricing: { heading: 'Pricing', priceLabel: 'Price (R)' },
    media: { heading: 'Photo', photoLabel: 'Photo', guidance: experience.photoGuidance },
    availability: {
      heading: 'Availability',
      onLabel: hasOrders ? 'Available for ordering' : 'Visible on your storefront',
      hint: experience.availabilityHint,
    },
  }
}

/** `hasBookings` mirrors `hasOrders` above — a SERVICES business without the
 *  BOOKINGS capability (e.g. LAUNDRY, which pairs SERVICES with ORDERS/PICKUP
 *  instead — see capabilities.ts's category defaults) has no booking flow to
 *  promise. */
export function getServiceEditorProfile(experience: BusinessExperience, hasBookings: boolean): ServiceEditorProfile {
  return {
    itemNoun: experience.serviceItemSingular,
    addLabel: experience.addServiceLabel,
    basic: {
      heading: 'Basic information',
      nameLabel: `${experience.serviceItemSingular} name`,
      descriptionLabel: 'Description',
    },
    pricing: { heading: 'Pricing', priceLabel: 'Price (R)' },
    booking: {
      heading: 'Booking details',
      durationLabel: 'Duration (minutes)',
      maxBookingsLabel: 'Bookings allowed at once',
    },
    media: { heading: 'Photo', photoLabel: 'Photo', guidance: experience.servicePhotoGuidance },
    availability: {
      heading: 'Availability',
      onLabel: hasBookings ? 'Available for booking' : 'Visible on your storefront',
      hint: experience.serviceAvailabilityHint,
    },
  }
}
