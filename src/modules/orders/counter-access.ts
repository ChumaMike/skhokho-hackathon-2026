/**
 * Who may use the Counter workspace, and which of its three parts.
 *
 * The counter is three things on one screen: taking a walk-in order (an
 * order write), the active-orders list (order management data: items,
 * totals, status), and "find a customer & give a stamp" (loyalty). Before
 * this, any signed-in team member — a driver, a stock controller — could
 * open it and read every active order. Each part is now gated by the
 * permission that already protects it elsewhere; the page is reachable only
 * with at least one of them. Pure, so the matrix is testable without a
 * request context; the page calls requireAnyStaffPermission with the same
 * list and uses this for what to render.
 */

import type { StaffPermissions } from '@/types'

export const COUNTER_ENTRY_PERMISSIONS = ['canManageOrders', 'canProcessPayments', 'canIssueLoyalty'] as const satisfies readonly (keyof StaffPermissions)[]

export interface CounterAccess {
  /** May open the page at all. */
  allowed: boolean
  /** The quick-tap POS — creates orders (createCounterOrderAction requires canManageOrders). */
  canTakeOrders: boolean
  /** The active-orders list — the same data /dashboard/orders protects with canManageOrders. */
  canSeeOrders: boolean
  /** Find a customer & give a stamp (stampByPhoneAction requires canIssueLoyalty). */
  canStamp: boolean
}

export function counterAccess(permissions: StaffPermissions, isOwner: boolean): CounterAccess {
  if (isOwner) return { allowed: true, canTakeOrders: true, canSeeOrders: true, canStamp: true }
  const canTakeOrders = permissions.canManageOrders === true
  const canSeeOrders = permissions.canManageOrders === true
  const canStamp = permissions.canIssueLoyalty === true
  const allowed = COUNTER_ENTRY_PERMISSIONS.some((p) => permissions[p] === true)
  return { allowed, canTakeOrders, canSeeOrders, canStamp }
}
