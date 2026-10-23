/**
 * Storefront Console composition — which "Manage" cards the Storefront
 * Overview (src/app/dashboard/storefront/page.tsx) shows, and their
 * terminology-resolved labels. Pure, same separation-of-decision-from-
 * rendering convention as home-composition.ts's getHomeSections/
 * getQuickActions and admin-modules.ts's getAdminConsoleGroups.
 *
 * This is presentation/composition only — it decides what to SHOW, never
 * what a person is ALLOWED to do (StaffPermissions, enforced independently
 * by each page's own requireStaffPermission call) or what a business CAN
 * do (BusinessCapability, capabilities.ts remains the one source of truth).
 */

import type { BusinessCapability } from './capabilities'
import type { BusinessExperience } from './business-experience'
import { resolveCatalogLabel } from './business-experience'

export type StorefrontManageSectionId = 'design' | 'content' | 'business-information' | 'pages' | 'analytics' | 'catalogue' | 'customer-actions' | 'ordering'

export interface StorefrontManageSection {
  id: StorefrontManageSectionId
  href: string
  label: string
  sub: string
}

export interface StorefrontConsoleInput {
  capabilities: Set<BusinessCapability>
  experience: BusinessExperience
  /** Design summary line, e.g. "WARM · colour hero". */
  designSummary: string
  /** e.g. "Order" / "Book" / null if never set. */
  primaryActionLabel: string | null
  /** Whether StorefrontContent (storefront-content.ts) has any field set yet — drives the "Storefront words" card's own summary line, same truthful-or-omitted posture as everything else in this module. */
  hasStorefrontContent: boolean
}

/**
 * Design and Business information and Customer actions are always
 * present — every business has identity, a theme, and a customer action to
 * configure. Catalogue and Ordering are capability-gated (§3/§11 of the
 * Storefront Console milestone): a business with neither PRODUCTS nor
 * SERVICES gets no catalogue card, and a business without ORDERS gets no
 * Ordering card at all (Collection/Delivery are meaningless without it).
 */
export function getStorefrontManageSections(input: StorefrontConsoleInput): StorefrontManageSection[] {
  const { capabilities, experience } = input
  const hasProducts = capabilities.has('PRODUCTS')
  const hasServices = capabilities.has('SERVICES')
  const hasOrders = capabilities.has('ORDERS')
  const hasBookings = capabilities.has('BOOKINGS')
  const hasDelivery = capabilities.has('DELIVERY')

  const sections: StorefrontManageSection[] = [
    { id: 'design', href: '/dashboard/storefront/design', label: 'Design', sub: input.designSummary },
    {
      id: 'content',
      // Deep-links straight to the wizard's content step (CONTENT_STEP_INDEX
      // in StorefrontDesignWizard.tsx) — editing copy shouldn't require
      // re-walking the whole template/colour/hero flow every time.
      href: '/dashboard/storefront/design?focus=content',
      label: 'Storefront words',
      sub: input.hasStorefrontContent ? 'Hero headline, about story, highlights' : 'Not written yet',
    },
    {
      id: 'business-information',
      href: '/dashboard/storefront/business-information',
      label: 'Business information',
      sub: 'Name, description, contact details, address',
    },
    {
      id: 'pages',
      href: '/dashboard/storefront/pages',
      label: 'Pages',
      sub: 'Your website pages, menu order and policies',
    },
    {
      id: 'analytics',
      href: '/dashboard/storefront/analytics',
      label: 'Page analytics',
      sub: 'Views, taps and enquiries per page',
    },
  ]

  if (hasProducts || hasServices) {
    sections.push({
      id: 'catalogue',
      href: '/dashboard/catalog',
      label: resolveCatalogLabel(experience, hasProducts, hasServices),
      sub:
        hasBookings && hasServices
          ? 'Customers book these directly from your storefront'
          : hasProducts
            ? `What customers can ${hasOrders ? 'order' : 'browse'}`
            : 'What customers can book',
    })
  }

  sections.push({
    id: 'customer-actions',
    href: '/dashboard/storefront/actions',
    label: 'Customer actions',
    sub: `Primary action: ${input.primaryActionLabel ?? 'not set'}`,
  })

  if (hasOrders) {
    sections.push({
      id: 'ordering',
      href: '/dashboard/storefront/ordering',
      label: 'Ordering',
      sub: hasDelivery ? 'Collection and delivery' : 'Collection only',
    })
  }

  return sections
}
