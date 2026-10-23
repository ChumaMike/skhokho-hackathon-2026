/**
 * Home's adaptive composition rules — which sections render, which quick
 * actions show, and the one customer-retention insight — all as pure
 * functions over capabilities/permissions, the same separation of
 * decision-from-data-fetching this session's other composition logic uses
 * (order.service.ts's canAdvanceOrderFromStatus, order-delivery.service.ts's
 * canActOnDelivery, workspace-nav.ts's getWorkspaceNav).
 */

import type { StaffPermissions } from '@/types'
import type { BusinessCapability } from '@/modules/tenant/capabilities'
import type { MemberRow } from '@/modules/customers/customer.service'

// ---------------------------------------------------------------------------
// Retention — deterministic, explainable, not a churn model
// ---------------------------------------------------------------------------

/**
 * "Regulars who haven't returned" — a customer counts as a regular once
 * they've stamped more than once (minStamps), distinguishing them from a
 * single one-time visitor; "lapsed" means their last visit is at least
 * `days` days ago. Both thresholds are named constants, not tuned/learned —
 * the whole point is a statement that's true by construction, not a
 * predicted likelihood of churn.
 */
export function computeLapsedRegulars(members: Pick<MemberRow, 'stamps' | 'last_seen'>[], minStamps = 2, days = 30): number {
  const cutoffMs = days * 86_400_000
  const now = Date.now()
  return members.filter((m) => m.stamps >= minStamps && now - new Date(m.last_seen).getTime() >= cutoffMs).length
}

// ---------------------------------------------------------------------------
// Section visibility
// ---------------------------------------------------------------------------

export interface HomeSections {
  showOrdersToday: boolean
  showBookingsToday: boolean
  showHappeningNow: boolean
  showRetention: boolean
}

/**
 * `showHappeningNow` is a capability/permission gate only — whether it
 * actually RENDERS still depends on the fetched counts being non-zero
 * (decided by the caller, dashboard/page.tsx), so a business with real
 * ORDERS/DELIVERY capability but nothing currently in flight doesn't show
 * an empty "Happening now" card.
 */
export function getHomeSections(
  capabilities: Set<BusinessCapability>,
  permissions: StaffPermissions,
  isOwner: boolean,
): HomeSections {
  const can = (allowed: boolean) => isOwner || allowed
  return {
    showOrdersToday: capabilities.has('ORDERS'),
    showBookingsToday: capabilities.has('BOOKINGS'),
    showHappeningNow:
      (capabilities.has('ORDERS') && can(permissions.canManageOrders || permissions.canPrepareOrders)) ||
      (capabilities.has('DELIVERY') && can(permissions.canManageDeliveries)),
    showRetention: capabilities.has('LOYALTY') && can(permissions.canManageCustomers || permissions.canIssueLoyalty),
  }
}

// ---------------------------------------------------------------------------
// Quick actions
// ---------------------------------------------------------------------------

export interface QuickActionDef {
  id: string
  label: string
  href: string
}

/**
 * Only ever returns actions with a real, already-built destination — "New
 * order"/"New booking" are deliberately never added here: no
 * merchant-initiated creation flow exists for either today (both are
 * customer-storefront-only), so adding them would mean building new
 * backend actions, not just a link. That stays a confirmed, documented
 * product gap, not something to paper over with a broken quick action.
 */
export function getQuickActions(
  capabilities: Set<BusinessCapability>,
  permissions: StaffPermissions,
  isOwner: boolean,
): QuickActionDef[] {
  const can = (allowed: boolean) => isOwner || allowed
  const actions: (QuickActionDef | false)[] = [
    (capabilities.has('PRODUCTS') || capabilities.has('SERVICES')) &&
      can(permissions.canManageServices) && {
        id: 'add-product',
        label: 'Add a product or service',
        href: '/dashboard/catalog',
      },
    can(permissions.canManageCustomers) && {
      id: 'add-customer',
      label: 'Add a customer',
      href: '/dashboard/customers/add',
    },
    capabilities.has('LOYALTY') &&
      can(permissions.canIssueLoyalty) && {
        id: 'give-stamp',
        label: 'Give a stamp',
        href: '/dashboard/customers',
      },
    isOwner && {
      id: 'invite-staff',
      label: 'Invite a team member',
      href: '/dashboard/staff',
    },
  ]
  return actions.filter((action): action is QuickActionDef => action !== false)
}
