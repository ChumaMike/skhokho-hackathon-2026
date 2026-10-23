/**
 * Readiness rules for the owner's AI buddy. Pure functions: no database, no
 * I/O, so every rule can be tested without a request context. The service
 * layer (readiness.service.ts) loads the facts and decides what to notify.
 */

export type ReadinessSeverity = 'SUGGESTION' | 'WARNING'

export interface ReadinessItem {
  key: string
  severity: ReadinessSeverity
  title: string
  message: string
  href: string
}

export interface ReadinessInput {
  status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | string
  logoUrl: string | null
  bannerUrl: string | null
  phone: string | null
  whatsapp: string | null
  address: string | null
  suburb: string | null
  city: string | null
  hasOperatingHours: boolean
  activeProductCount: number
  productsWithPhoto: number
  deliveryEnabled: boolean
  deliveryAreaInfo: string | null
}

export function computeReadiness(input: ReadinessInput): ReadinessItem[] {
  const items: ReadinessItem[] = []

  if (input.activeProductCount === 0) {
    items.push({
      key: 'NO_MENU_ITEMS',
      severity: 'WARNING',
      title: 'Add your first menu item',
      message: 'Customers can\'t order anything until you add at least one item.',
      href: '/dashboard/catalog',
    })
  } else if (input.productsWithPhoto < input.activeProductCount) {
    const missing = input.activeProductCount - input.productsWithPhoto
    items.push({
      key: 'MENU_PHOTOS',
      severity: 'WARNING',
      title: 'Add photos to your menu',
      message: `${missing} of ${input.activeProductCount} menu items have no photo. Photos make people order.`,
      href: '/dashboard/catalog',
    })
  }

  if (!input.logoUrl) {
    items.push({
      key: 'LOGO',
      severity: 'SUGGESTION',
      title: 'Upload a logo',
      message: 'Your storefront shows a letter in place of a logo until you upload one.',
      href: '/dashboard/settings',
    })
  }

  if (!input.bannerUrl) {
    items.push({
      key: 'BANNER',
      severity: 'SUGGESTION',
      title: 'Add a banner photo',
      message: 'A banner photo is the first thing customers see on your storefront.',
      href: '/dashboard/settings',
    })
  }

  if (!input.hasOperatingHours) {
    items.push({
      key: 'OPENING_HOURS',
      severity: 'WARNING',
      title: 'Set your opening hours',
      message: 'Without hours, customers can order at any time, including when you\'re closed.',
      href: '/dashboard/settings',
    })
  }

  if (!input.phone && !input.whatsapp) {
    items.push({
      key: 'CONTACT',
      severity: 'WARNING',
      title: 'Add a phone or WhatsApp number',
      message: 'Customers need a way to reach you about their order.',
      href: '/dashboard/settings',
    })
  }

  if (!input.address && !input.suburb && !input.city) {
    items.push({
      key: 'LOCATION',
      severity: 'SUGGESTION',
      title: 'Add your location',
      message: 'Your suburb or city helps customers find you and sets delivery distances.',
      href: '/dashboard/settings',
    })
  }

  if (input.deliveryEnabled && !input.deliveryAreaInfo) {
    items.push({
      key: 'DELIVERY_AREA',
      severity: 'SUGGESTION',
      title: 'Describe your delivery area',
      message: 'Tell customers which areas you deliver to, so no one is surprised at checkout.',
      href: '/dashboard/settings',
    })
  }

  if (input.status !== 'ACTIVE' && input.activeProductCount > 0) {
    items.push({
      key: 'PUBLISH',
      severity: 'SUGGESTION',
      title: 'Publish your storefront',
      message: 'Your storefront is still a draft, so customers can\'t find it yet.',
      href: '/dashboard',
    })
  }

  return items
}
