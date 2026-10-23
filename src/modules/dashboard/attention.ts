/**
 * Central "needs your attention" policy — one place that decides which
 * operational exceptions surface on Home, instead of a scattered array
 * literal mixing unrelated concerns (the shape `dashboard/page.tsx` had
 * before this milestone). Every type here maps 1:1 to an existing, real
 * page or action — never an alert with nowhere to resolve it.
 *
 * Deliberately excludes BUSINESS_NOT_PUBLISHED / SETUP_INCOMPLETE:
 * PublicationStatus (dashboard/PublicationStatus.tsx) already owns that
 * signal, more prominently (a banner, not a line item) — duplicating it
 * here would be the exact "duplicate information" this milestone's audit
 * was asked to catch.
 *
 * Pure function, no I/O — every count is supplied by the caller, already
 * correctly tenant-scoped by whichever existing service function produced
 * it. This is what makes it directly unit-testable without a database,
 * matching the pattern order.service.ts's canAdvanceOrderFromStatus and
 * order-delivery.service.ts's canActOnDelivery already established.
 *
 * Product analytics (not built — no event mechanism exists in this
 * codebase yet, see the milestone report): once one exists, the natural
 * event here is `attention_item_opened`, fired when a returned item's
 * href is followed.
 */

import type { StaffPermissions } from '@/types'
import type { BusinessCapability } from '@/modules/tenant/capabilities'

export type AttentionType =
  | 'ORDER_CONFIRMATION_REQUIRED'
  | 'ORDER_UNPAID'
  | 'BOOKING_CONFIRMATION_REQUIRED'
  | 'READY_DELIVERY_UNASSIGNED'
  | 'DELIVERY_OUT'
  | 'FAILED_DELIVERY'
  | 'LOW_STOCK'
  | 'STAFF_INVITE_PENDING'

export type AttentionSeverity = 'info' | 'warning' | 'critical'

export interface AttentionItem {
  type: AttentionType
  id: string
  label: string
  href: string
  severity: AttentionSeverity
}

export interface AttentionCounts {
  unpaidOrders: number
  ordersAwaitingConfirmation: number
  bookingsAwaitingConfirmation: number
  lowStockCount: number
  pendingStaffInvites: number
  deliveriesNeedingDriver: number
  deliveriesOut: number
  deliveryProblems: number
}

function plural(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural
}

/**
 * Builds the list of operational exceptions the current viewer both cares
 * about (their business actually does this — capability) and can act on
 * (their role permits it — permission, owner always bypasses). Zero-count
 * items are never included — a merchant checking this daily should see
 * actions, not a reassurance that nothing needs doing.
 */
export function buildAttentionItems(
  counts: AttentionCounts,
  capabilities: Set<BusinessCapability>,
  permissions: StaffPermissions,
  isOwner: boolean,
): AttentionItem[] {
  const can = (allowed: boolean) => isOwner || allowed
  const items: (AttentionItem | false)[] = [
    capabilities.has('ORDERS') &&
      can(permissions.canManageOrders) &&
      counts.unpaidOrders > 0 && {
        type: 'ORDER_UNPAID',
        id: 'order-unpaid',
        label: `${counts.unpaidOrders} ${plural(counts.unpaidOrders, 'order is', 'orders are')} waiting on payment`,
        href: '/dashboard/orders',
        severity: 'warning',
      },
    capabilities.has('ORDERS') &&
      can(permissions.canManageOrders) &&
      counts.ordersAwaitingConfirmation > 0 && {
        type: 'ORDER_CONFIRMATION_REQUIRED',
        id: 'order-confirmation-required',
        label: `${counts.ordersAwaitingConfirmation} new ${plural(counts.ordersAwaitingConfirmation, 'order needs', 'orders need')} confirming`,
        href: '/dashboard/orders',
        severity: 'warning',
      },
    capabilities.has('BOOKINGS') &&
      can(permissions.canManageBookings) &&
      counts.bookingsAwaitingConfirmation > 0 && {
        type: 'BOOKING_CONFIRMATION_REQUIRED',
        id: 'booking-confirmation-required',
        label: `${counts.bookingsAwaitingConfirmation} ${plural(counts.bookingsAwaitingConfirmation, 'booking needs', 'bookings need')} your confirmation`,
        href: '/dashboard/appointments',
        severity: 'warning',
      },
    capabilities.has('INVENTORY') &&
      can(permissions.canManageInventory || permissions.canManageServices) &&
      counts.lowStockCount > 0 && {
        type: 'LOW_STOCK',
        id: 'low-stock',
        label: `${counts.lowStockCount} ${plural(counts.lowStockCount, 'product is', 'products are')} running low on stock`,
        href: '/dashboard/catalog',
        severity: 'warning',
      },
    isOwner &&
      counts.pendingStaffInvites > 0 && {
        type: 'STAFF_INVITE_PENDING',
        id: 'staff-invite-pending',
        label: `${counts.pendingStaffInvites} staff ${plural(counts.pendingStaffInvites, "invite hasn't", "invites haven't")} been accepted yet`,
        href: '/dashboard/staff',
        severity: 'info',
      },
    capabilities.has('DELIVERY') &&
      can(permissions.canManageDeliveries) &&
      counts.deliveriesNeedingDriver > 0 && {
        type: 'READY_DELIVERY_UNASSIGNED',
        id: 'delivery-needs-driver',
        label: `${counts.deliveriesNeedingDriver} ${plural(counts.deliveriesNeedingDriver, 'delivery needs', 'deliveries need')} a driver`,
        href: '/dashboard/deliveries',
        severity: 'warning',
      },
    capabilities.has('DELIVERY') &&
      can(permissions.canManageDeliveries) &&
      counts.deliveryProblems > 0 && {
        type: 'FAILED_DELIVERY',
        id: 'delivery-problems',
        label: `${counts.deliveryProblems} ${plural(counts.deliveryProblems, 'delivery problem', 'delivery problems')} reported`,
        href: '/dashboard/deliveries',
        severity: 'critical',
      },
    capabilities.has('DELIVERY') &&
      can(permissions.canManageDeliveries) &&
      counts.deliveriesOut > 0 && {
        type: 'DELIVERY_OUT',
        id: 'delivery-out',
        label: `${counts.deliveriesOut} ${plural(counts.deliveriesOut, 'delivery is', 'deliveries are')} out right now`,
        href: '/dashboard/deliveries',
        severity: 'info',
      },
  ]

  return items.filter((item): item is AttentionItem => item !== false)
}
