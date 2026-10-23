/**
 * Shared application types
 *
 * Re-exports the Prisma-generated model types plus the compound shapes that
 * services return, so route handlers and components don't each re-derive them.
 */

import type {
  Business,
  BusinessStaff,
  BusinessRole,
  BusinessSubscription,
  Membership,
  Customer,
  Order,
  OrderItem,
  Product,
  Service,
  InventoryItem,
  Appointment,
  StaffWorkspace,
} from '@prisma/client'

export type {
  Business,
  BusinessStaff,
  BusinessRole,
  BusinessSubscription,
  Membership,
  Customer,
  Order,
  OrderItem,
  Product,
  Service,
  InventoryItem,
  Appointment,
  StaffWorkspace,
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * Stored as JSON on `BusinessRole.permissions`. Owners (`BusinessStaff.isOwner`)
 * bypass every check, so this only gates non-owner staff.
 */
export interface StaffPermissions {
  canManageStaff: boolean
  // No code path calls requireStaffPermission("canManageInventory") today —
  // confirmed by tracing every caller of inventory.service.ts's adjustStock/
  // setStockLevel: the only one is order.service.ts's completeOrder (already
  // gated on canManageOrders), and no dashboard page or action lets staff
  // trigger a manual stock adjustment at all yet. Not a security gap to
  // close — there is nothing unprotected to protect — but a real, intended
  // capability once inventory management ships (see the P0 authorization
  // audit and docs/specs/2026-09-08-staff-workspace-architecture.md).
  canManageInventory: boolean
  canManageOrders: boolean
  canViewAnalytics: boolean
  canManageCustomers: boolean
  canManageServices: boolean
  canProcessPayments: boolean
  canManageSettings: boolean
  // Added Phase 5 of the multi-tenant domain plan (see
  // docs/specs/2026-09-02-multi-tenant-domain-architecture.md). Purely
  // additive: a `BusinessRole.permissions` JSON row written before this
  // phase simply has these keys `undefined`, which reads falsy at every
  // `requireStaffPermission` call site — fails closed, not open, without
  // needing a migration. The one-off backfill in
  // prisma/scripts/backfill-permission-keys.ts sets them explicitly instead
  // of leaving that implicit for any row that predates this phase.
  canReadBookings: boolean
  canManageBookings: boolean
  canIssueLoyalty: boolean
  canAdjustLoyalty: boolean
  canInviteStaff: boolean
  canManageDomains: boolean
  canManageBilling: boolean
  // Least-privilege order-preparation authority (workforce architecture
  // hardening pass): CONFIRMED->PROCESSING and PROCESSING->READY may be
  // performed by canPrepareOrders OR canManageOrders — see
  // order.service.ts's canAdvanceOrderFromStatus, the one place that rule
  // is enforced. Every OTHER order transition (accepting a new PENDING
  // order, completing, cancelling) stays canManageOrders-only regardless
  // of this flag. A role JSON row written before this key existed reads it
  // as `undefined` (falsy) — fails closed, and loses nothing: every such
  // role already has canManageOrders true, which already covers
  // preparation transitions via the OR rule above. No backfill needed.
  canPrepareOrders: boolean
  // Delivery permission semantics, prepared ahead of the Delivery
  // milestone so Driver is never shipped with only a broad
  // canManageDeliveries grant (the same mistake Kitchen's canManageOrders
  // was). No enforcement point exists yet — no code checks either flag —
  // this is purely the typed shape ready for when Delivery ships.
  /** Operational: a driver's own authority over deliveries assigned/available to them. */
  canPerformDeliveries: boolean
  /** Managerial: dispatch/oversight authority across the business's deliveries. */
  canManageDeliveries: boolean
  /** Content & Marketing: write, edit and plan marketing content and run AI content tools. A role JSON row written before this key reads it as undefined (false). */
  canManageContent: boolean
}

export const NO_PERMISSIONS: StaffPermissions = {
  canManageStaff: false,
  canManageInventory: false,
  canManageOrders: false,
  canViewAnalytics: false,
  canManageCustomers: false,
  canManageServices: false,
  canProcessPayments: false,
  canManageSettings: false,
  canReadBookings: false,
  canManageBookings: false,
  canIssueLoyalty: false,
  canAdjustLoyalty: false,
  canInviteStaff: false,
  canManageDomains: false,
  canManageBilling: false,
  canPrepareOrders: false,
  canPerformDeliveries: false,
  canManageDeliveries: false,
  canManageContent: false,
}

export const ALL_PERMISSIONS: StaffPermissions = {
  canManageStaff: true,
  canManageInventory: true,
  canManageOrders: true,
  canViewAnalytics: true,
  canManageCustomers: true,
  canManageServices: true,
  canProcessPayments: true,
  canManageSettings: true,
  canReadBookings: true,
  canManageBookings: true,
  canIssueLoyalty: true,
  canAdjustLoyalty: true,
  canInviteStaff: true,
  canManageDomains: true,
  canManageBilling: true,
  canPrepareOrders: true,
  canPerformDeliveries: true,
  canManageDeliveries: true,
  canManageContent: true,
}

/**
 * Non-owner invite presets — the single source of truth `createBusiness`
 * (seeding a fresh business's roles) and `prisma/scripts/backfill-role-presets.ts`
 * (adding the same presets to businesses created before this existed) both
 * read from, so the two can never drift apart.
 *
 * STAFF and CASHIER are deliberately identical: today's permission model has
 * no capability that distinguishes "generic team member" from "front-counter
 * cashier" — both get the same day-to-day set (orders, customers, payments,
 * bookings, issuing loyalty stamps). CASHIER exists as its own preset so the
 * invite form's label is honest (selecting it doesn't silently fall back to
 * a differently-named role), not because it currently grants anything STAFF
 * doesn't.
 *
 * MANAGER and TECHNICIAN are genuinely different from STAFF/CASHIER — this
 * is the actual fix: before this, selecting any of the four labels produced
 * the exact same access (see this file's git history / the P0 audit that
 * found `inviteStaff` always assigned the isDefault role regardless of the
 * label chosen).
 */
export const STAFF_PERMISSIONS_BY_PRESET: Record<'MANAGER' | 'STAFF' | 'CASHIER' | 'TECHNICIAN', StaffPermissions> = {
  STAFF: {
    ...NO_PERMISSIONS,
    canManageOrders: true,
    canManageCustomers: true,
    canProcessPayments: true,
    canReadBookings: true,
    canManageBookings: true,
    canIssueLoyalty: true,
  },
  CASHIER: {
    ...NO_PERMISSIONS,
    canManageOrders: true,
    canManageCustomers: true,
    canProcessPayments: true,
    canReadBookings: true,
    canManageBookings: true,
    canIssueLoyalty: true,
  },
  // Broader day-to-day trust than Staff/Cashier — catalog, inventory,
  // loyalty redemption, and read-only analytics — but deliberately stops
  // short of staff/business-configuration control (canManageStaff,
  // canInviteStaff, canManageSettings, canManageDomains, canManageBilling
  // all stay false), consistent with the existing Owner-vs-everyone-else
  // split: structural/financial control isn't delegated by a role preset.
  MANAGER: {
    ...NO_PERMISSIONS,
    canManageOrders: true,
    canManageCustomers: true,
    canProcessPayments: true,
    canReadBookings: true,
    canManageBookings: true,
    canIssueLoyalty: true,
    canAdjustLoyalty: true,
    canViewAnalytics: true,
    canManageServices: true,
    canManageInventory: true,
    // Dispatch/oversight authority, prepared ahead of the Delivery
    // milestone — no enforcement point exists yet, but Manager is the
    // dispatcher role once one does.
    canManageDeliveries: true,
    // Marketing content is day-to-day work, not structural control.
    canManageContent: true,
  },
  // Booking-focused only — a service provider doesn't need general order,
  // payment, or customer-record access to do their job.
  TECHNICIAN: {
    ...NO_PERMISSIONS,
    canReadBookings: true,
    canManageBookings: true,
  },
}

/**
 * Job-based presets that have no StaffRole equivalent (see
 * src/modules/staff/staff-presets.ts's StaffPresetId — StaffRole is frozen,
 * these were never added to it). Kept alongside STAFF_PERMISSIONS_BY_PRESET
 * rather than merged into it so that map's existing 4-key shape (and the P0
 * tests asserting it) never changes.
 */
// Least-privilege: only what preparing an order requires. Deliberately
// canPrepareOrders, NOT canManageOrders — a Kitchen worker may move
// CONFIRMED->PROCESSING->READY (see order.service.ts's
// canAdvanceOrderFromStatus) but must never accept a new PENDING order,
// complete one, or cancel one; those stay canManageOrders-only regardless
// of this flag. No customer, payment, or settings access either — the
// Kitchen workspace's own page also fetches a deliberately minimal query
// independent of this, but the permission floor is enforced here,
// server-side, regardless of what any page chooses to render.
export const KITCHEN_PERMISSIONS: StaffPermissions = {
  ...NO_PERMISSIONS,
  canPrepareOrders: true,
}

// canManageInventory has no reachable enforcement point yet (see the P0
// authorization audit — no dashboard action calls adjustStock/setStockLevel
// today), but this is exactly the intended future use of that flag once
// inventory management ships, not a granted-but-meaningless permission.
export const STOCK_PERMISSIONS: StaffPermissions = {
  ...NO_PERMISSIONS,
  canManageInventory: true,
}

// Operational-only: a driver's own authority over deliveries assigned/
// available to them. No enforcement point exists yet (Delivery isn't built
// this pass) — this exists so Driver is never shipped with only a broad
// canManageDeliveries grant, which would hand a driver dispatcher-level
// authority they should never have. Deliberately zero other grants.
export const DRIVER_PERMISSIONS: StaffPermissions = {
  ...NO_PERMISSIONS,
  canPerformDeliveries: true,
}

// ---------------------------------------------------------------------------
// Compound service return types
// ---------------------------------------------------------------------------

/** The pairwise membership view a business is allowed to see (never the global id). */
export type MembershipView = Pick<
  Membership,
  'publicId' | 'shortCode' | 'displayName' | 'firstSeen' | 'lastSeen'
>

export type OrderWithItems = Order & {
  items: OrderItem[]
  membership: Membership | null
}

export type OrderWithDetail = Order & {
  items: (OrderItem & {
    product: Pick<Product, 'name'> | null
    service: Pick<Service, 'name'> | null
  })[]
  membership: Pick<Membership, 'publicId' | 'shortCode' | 'displayName'> | null
  staff: Pick<BusinessStaff, 'firstName' | 'lastName'> | null
}

export type StaffWithRole = BusinessStaff & { role: BusinessRole | null }

export type BusinessWithSubscription = Business & { subscription: BusinessSubscription | null }

export type ProductWithStock = Product & { inventory: InventoryItem | null }

// ---------------------------------------------------------------------------
// API envelope
// ---------------------------------------------------------------------------

export type Paginated<T> = {
  total: number
  page: number
  perPage: number
  totalPages: number
} & T

export interface ApiOk<T> {
  ok: true
  data: T
}

export interface ApiErr {
  ok: false
  error: string
  details?: unknown
}

export type ApiResponse<T> = ApiOk<T> | ApiErr
