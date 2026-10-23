/**
 * Staff preset registry — the single source of truth `createBusiness`
 * (seeding a business's BusinessRole rows), `inviteStaff` (resolving which
 * role an invite gets), the invite-form UI (which options to show and what
 * plain-language summary to render), and the backfill script all read from.
 *
 * A preset bundles four things that must be kept conceptually separate:
 *   - `permissions` seeds a real BusinessRole — the ONLY authorization
 *     mechanism. Never bypassed, never re-derived from `workspace`.
 *   - `workspace` is presentation-only routing (which dashboard screen this
 *     person lands on). It is never checked by a server action.
 *   - `presetRole` mirrors the legacy StaffRole enum for the four presets
 *     that predate this file (Manager/Counter/ServiceProvider/General —
 *     StaffRole's Manager/Cashier/Technician/Staff). StaffRole is frozen —
 *     Kitchen/Driver/Stock have no `presetRole` at all, only a `jobPreset`
 *     (this preset's own `id`), which is a plain string column, not an
 *     enum, so a future preset never needs a schema migration for the type
 *     itself.
 *   - `requiredCapability` hides a preset from the invite picker for a
 *     business that hasn't opted into the matching BusinessCapability.
 */

import type { StaffPermissions, StaffWorkspace } from '@/types'
import {
  STAFF_PERMISSIONS_BY_PRESET,
  KITCHEN_PERMISSIONS,
  STOCK_PERMISSIONS,
  DRIVER_PERMISSIONS,
} from '@/types'
import type { BusinessCapability } from '@/modules/tenant/capabilities'

export type StaffPresetId =
  | 'MANAGER'
  | 'COUNTER'
  | 'KITCHEN'
  | 'DRIVER'
  | 'SERVICE_PROVIDER'
  | 'STOCK'
  | 'GENERAL'

type LegacyPresetRole = 'MANAGER' | 'STAFF' | 'CASHIER' | 'TECHNICIAN'

export interface StaffPreset {
  id: StaffPresetId
  /** Legacy StaffRole mirror — only set for the four presets that predate this file. */
  presetRole?: LegacyPresetRole
  /** True only for GENERAL — the fallback role every business has had since createBusiness existed. */
  isDefault?: boolean
  /** BusinessRole.name seeded at business creation. */
  name: string
  /** Invite-picker display label. */
  label: string
  /** Suggested default, freely editable by the owner at invite time. */
  jobTitle: string
  workspace: StaffWorkspace
  permissions: StaffPermissions
  /** Hidden from the invite picker unless the business has this capability. */
  requiredCapability?: BusinessCapability
  summary: { grants: string[]; denies: string[]; note?: string }
}

export const STAFF_PRESETS: Record<StaffPresetId, StaffPreset> = {
  GENERAL: {
    id: 'GENERAL',
    presetRole: 'STAFF',
    isDefault: true,
    name: 'Staff',
    label: 'General Staff',
    jobTitle: 'Team member',
    workspace: 'GENERAL',
    permissions: STAFF_PERMISSIONS_BY_PRESET.STAFF,
    summary: {
      grants: ['Orders', 'Customers & loyalty stamps', 'Bookings', 'Taking payment'],
      denies: ['Business analytics', 'Billing/settings', 'Staff administration'],
    },
  },
  MANAGER: {
    id: 'MANAGER',
    presetRole: 'MANAGER',
    name: 'Manager',
    label: 'Manager',
    jobTitle: 'Manager',
    workspace: 'MANAGER',
    permissions: STAFF_PERMISSIONS_BY_PRESET.MANAGER,
    summary: {
      grants: ['Orders & bookings', 'Customers & loyalty', 'Catalogue', 'Inventory', 'Analytics'],
      denies: ['Billing/settings', 'Domains', 'Staff administration'],
    },
  },
  COUNTER: {
    id: 'COUNTER',
    presetRole: 'CASHIER',
    name: 'Cashier',
    label: 'Counter / Cashier',
    jobTitle: 'Counter staff',
    workspace: 'COUNTER',
    permissions: STAFF_PERMISSIONS_BY_PRESET.CASHIER,
    summary: {
      grants: ['Find a customer & give a stamp', 'Orders', 'Taking payment', 'Bookings'],
      denies: ['Business analytics', 'Billing/settings', 'Staff administration'],
    },
  },
  KITCHEN: {
    id: 'KITCHEN',
    name: 'Kitchen',
    label: 'Kitchen / Preparation',
    jobTitle: 'Kitchen staff',
    workspace: 'KITCHEN',
    permissions: KITCHEN_PERMISSIONS,
    requiredCapability: 'ORDERS',
    summary: {
      grants: ['See orders that need preparing', 'Update an order to "Preparing" or "Ready"'],
      denies: ['Customer phone or loyalty history', 'Payments', 'Business analytics', 'Billing/settings'],
    },
  },
  DRIVER: {
    id: 'DRIVER',
    name: 'Driver',
    label: 'Driver',
    jobTitle: 'Driver',
    workspace: 'DELIVERY',
    permissions: DRIVER_PERMISSIONS,
    requiredCapability: 'DELIVERY',
    summary: {
      grants: [],
      denies: ['Orders & customer records', 'Business analytics', 'Billing/settings', 'Staff administration'],
      note: 'Drivers get one simple screen: the deliveries assigned to them, with the address, phone, directions and "picked up" / "delivered" buttons.',
    },
  },
  SERVICE_PROVIDER: {
    id: 'SERVICE_PROVIDER',
    presetRole: 'TECHNICIAN',
    name: 'Technician',
    label: 'Service Provider',
    jobTitle: 'Service provider',
    workspace: 'SERVICE_PROVIDER',
    permissions: STAFF_PERMISSIONS_BY_PRESET.TECHNICIAN,
    requiredCapability: 'BOOKINGS',
    summary: {
      grants: ['See and manage bookings'],
      denies: ['Orders', 'Customer records', 'Payments', 'Business analytics', 'Billing/settings'],
    },
  },
  STOCK: {
    id: 'STOCK',
    name: 'Stock',
    label: 'Stock',
    jobTitle: 'Stock controller',
    workspace: 'STOCK',
    permissions: STOCK_PERMISSIONS,
    requiredCapability: 'INVENTORY',
    summary: {
      grants: ['Manage inventory'],
      denies: ['Orders', 'Customer records', 'Payments', 'Business analytics', 'Billing/settings'],
      note: 'Inventory management has no dedicated screen yet — the underlying access is ready for when it does.',
    },
  },
}

/**
 * The explicit legacy-to-canonical compatibility mapping, computed FROM
 * STAFF_PRESETS above so it can never drift out of sync with it — this IS
 * the "presetRole -> jobPreset" relationship, made a first-class, testable,
 * documented artifact rather than left implicit in each preset's
 * `presetRole` field.
 *
 * legacy presetRole  ->  canonical jobPreset
 *   MANAGER          ->  MANAGER
 *   STAFF            ->  GENERAL
 *   CASHIER          ->  COUNTER
 *   TECHNICIAN       ->  SERVICE_PROVIDER
 *
 * `jobPreset` is the canonical, stable preset identifier for all seven
 * presets going forward — `presetRole` is kept ONLY for backward
 * compatibility with businesses tagged before this file existed (the P0
 * pass's four-preset system) and is never read directly outside this
 * mapping and the one-time backfill script. Neither field is ever used for
 * authorization — BusinessRole.permissions remains the only mechanism.
 */
export const LEGACY_PRESET_ROLE_TO_JOB_PRESET: Record<LegacyPresetRole, StaffPresetId> = Object.fromEntries(
  Object.values(STAFF_PRESETS)
    .filter((preset): preset is StaffPreset & { presetRole: LegacyPresetRole } => Boolean(preset.presetRole))
    .map((preset) => [preset.presetRole, preset.id]),
) as Record<LegacyPresetRole, StaffPresetId>

/**
 * The one function that decides "what canonical preset is this role" —
 * `jobPreset` first (canonical), falling back to the legacy `presetRole`
 * mapping above, `null` for a genuinely custom role (both fields null,
 * e.g. a future "Weekend Senior Team" role an owner names themselves).
 * Presentation/identification only — never an authorization input.
 */
export function resolveCanonicalPreset(role: {
  jobPreset: string | null
  presetRole: string | null
}): StaffPresetId | null {
  if (role.jobPreset && role.jobPreset in STAFF_PRESETS) {
    return role.jobPreset as StaffPresetId
  }
  if (role.presetRole && role.presetRole in LEGACY_PRESET_ROLE_TO_JOB_PRESET) {
    return LEGACY_PRESET_ROLE_TO_JOB_PRESET[role.presetRole as LegacyPresetRole]
  }
  return null
}
