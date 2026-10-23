/**
 * Admin Module Registry — the ONE list of merchant-console modules, each
 * describing its own route, grouping, required capability, required
 * permission, and terminology-resolved label. Replaces scattering
 * `if (category === FOOD_VENDOR)` or ad-hoc nav filtering through pages.
 *
 * Deliberately layered on top of, not a replacement for, the existing
 * separation this codebase already enforces:
 *   - capabilities.ts / BusinessCapability decides what a business DOES.
 *   - StaffPermissions (src/types) decides what a PERSON may do — still the
 *     only server-side authorization boundary (every page independently
 *     calls requireStaffPermission/requireOwnerOnlySession; this registry
 *     is consulted for NOTHING except which links to render).
 *   - business-experience.ts decides the WORDING.
 * A module hidden here because of a missing permission is a presentation
 * choice, never itself the authorization — direct navigation to its route
 * hits the same requireStaffPermission call it always did.
 */

import type { StaffPermissions } from '@/types'
import type { BusinessCapability } from '@/modules/tenant/capabilities'
import type { BusinessExperience } from '@/modules/tenant/business-experience'
import { resolveCatalogLabel } from '@/modules/tenant/business-experience'
import { WORKFLOW_CAPABILITIES } from '@/modules/storefront-workflows/workflows'
import type { DashboardSection } from '@/components/DashboardNav'

export type AdminModuleGroupId = 'OVERVIEW' | 'RUN_YOUR_BUSINESS' | 'YOUR_STORE' | 'CUSTOMERS' | 'GROW' | 'BUSINESS'

export const ADMIN_MODULE_GROUP_TITLES: Record<AdminModuleGroupId, string> = {
  OVERVIEW: 'Overview',
  RUN_YOUR_BUSINESS: 'Run your business',
  YOUR_STORE: 'Your store',
  CUSTOMERS: 'Customers',
  GROW: 'Grow',
  BUSINESS: 'Business',
}

export interface AdminConsoleModule {
  key: DashboardSection
  href: string
  label: string
}

export interface AdminConsoleGroup {
  id: AdminModuleGroupId
  title: string
  modules: AdminConsoleModule[]
}

export interface AdminModuleContext {
  isOwner: boolean
  permissions: StaffPermissions
  capabilities: Set<BusinessCapability>
  experience: BusinessExperience
  hasProducts: boolean
  hasServices: boolean
}

interface AdminModuleDef {
  key: DashboardSection
  group: AdminModuleGroupId
  href: string
  label: (ctx: AdminModuleContext) => string
  /** Every listed capability must be present. Omit for "always available". */
  requiredCapabilities?: BusinessCapability[]
  /** At least one must be true (or the caller is the owner). Omit for "always visible to any signed-in staff member". */
  requiredPermission?: (permissions: StaffPermissions) => boolean
}

const MODULE_DEFS: AdminModuleDef[] = [
  {
    key: 'home',
    group: 'OVERVIEW',
    href: '/dashboard',
    label: () => 'Home',
  },
  {
    key: 'orders',
    group: 'RUN_YOUR_BUSINESS',
    href: '/dashboard/orders',
    label: () => 'Orders',
    requiredCapabilities: ['ORDERS'],
    requiredPermission: (p) => p.canManageOrders,
  },
  {
    key: 'kitchen',
    group: 'RUN_YOUR_BUSINESS',
    href: '/dashboard/kitchen',
    label: () => 'Kitchen',
    requiredCapabilities: ['ORDERS'],
    requiredPermission: (p) => p.canManageOrders || p.canPrepareOrders,
  },
  {
    key: 'deliveries',
    group: 'RUN_YOUR_BUSINESS',
    href: '/dashboard/deliveries',
    label: () => 'Deliveries',
    requiredCapabilities: ['DELIVERY'],
    requiredPermission: (p) => p.canManageDeliveries,
  },
  {
    key: 'appointments',
    group: 'RUN_YOUR_BUSINESS',
    href: '/dashboard/appointments',
    label: () => 'Bookings',
    requiredCapabilities: ['BOOKINGS'],
    requiredPermission: (p) => p.canReadBookings || p.canManageBookings,
  },
  {
    key: 'leads',
    group: 'RUN_YOUR_BUSINESS',
    href: '/dashboard/leads',
    label: () => 'Enquiries',
    // Visible when ANY storefront workflow capability is on — an "any of"
    // rule, enforced in isModuleVisible like the catalogue's.
    requiredPermission: (p) => p.canManageCustomers || p.canManageBookings,
  },
  {
    key: 'catalog',
    group: 'YOUR_STORE',
    href: '/dashboard/catalog',
    label: (ctx) => resolveCatalogLabel(ctx.experience, ctx.hasProducts, ctx.hasServices),
    requiredPermission: (p) => p.canManageServices,
    // Visibility additionally requires PRODUCTS or SERVICES — enforced in
    // getAdminConsoleGroups (an "any of" rule the requiredCapabilities
    // all-must-match shape can't express).
  },
  {
    key: 'storefront',
    group: 'YOUR_STORE',
    href: '/dashboard/storefront',
    label: () => 'Storefront',
    // No permission gate here — matches storefront/page.tsx today, which
    // any signed-in staff member can already view (no requireStaffPermission
    // call in that page).
  },
  {
    key: 'customers',
    group: 'CUSTOMERS',
    href: '/dashboard/customers',
    label: () => 'Customers',
    requiredPermission: (p) => p.canManageCustomers || p.canIssueLoyalty,
  },
  {
    key: 'content',
    group: 'GROW',
    href: '/dashboard/content',
    label: () => 'Content & Marketing',
    // Plan gating is NOT done here: the page shows an upgrade panel when the
    // business's plan lacks content_studio, and every action re-checks it.
    requiredPermission: (p) => p.canManageContent,
  },
  {
    key: 'staff',
    group: 'BUSINESS',
    href: '/dashboard/staff',
    label: () => 'Team',
    // Owner-only page (requireOwnerOnlySession) — requiredPermission left
    // unset so only the isOwner fallback below grants it.
    requiredPermission: () => false,
  },
  {
    key: 'analytics',
    group: 'BUSINESS',
    href: '/dashboard/analytics',
    label: () => 'Analytics',
    requiredPermission: (p) => p.canViewAnalytics,
  },
  {
    key: 'assistant',
    group: 'BUSINESS',
    href: '/dashboard/assistant',
    label: () => 'Ask Skhokho',
  },
  {
    key: 'settings',
    group: 'BUSINESS',
    href: '/dashboard/settings',
    label: () => 'Settings',
    requiredPermission: (p) => p.canManageSettings,
  },
  {
    key: 'domains',
    group: 'BUSINESS',
    href: '/dashboard/settings/domains',
    label: () => 'Domains',
    requiredPermission: (p) => p.canManageDomains,
  },
  {
    key: 'payments',
    group: 'BUSINESS',
    href: '/dashboard/settings/payments',
    label: () => 'Payments',
    // canManageBilling, not canProcessPayments: this screen decides WHERE a
    // business's money is sent, which is a different and far more dangerous
    // thing than recording that some arrived at the till. No staff preset
    // grants it, so in practice it is owner-only.
    //
    // Deliberately NOT gated on the PAYMENTS capability — that capability is
    // in no category's defaults, so requiring it would hide this page from
    // every business that exists.
    requiredPermission: (p) => p.canManageBilling,
  },
]

const GROUP_ORDER: AdminModuleGroupId[] = ['OVERVIEW', 'RUN_YOUR_BUSINESS', 'YOUR_STORE', 'CUSTOMERS', 'GROW', 'BUSINESS']

function isModuleVisible(def: AdminModuleDef, ctx: AdminModuleContext): boolean {
  if (def.key === 'catalog' && !ctx.hasProducts && !ctx.hasServices) return false
  if (def.key === 'leads' && !WORKFLOW_CAPABILITIES.some((c) => ctx.capabilities.has(c))) return false
  if (def.requiredCapabilities && !def.requiredCapabilities.every((c) => ctx.capabilities.has(c))) return false
  if (def.requiredPermission && !ctx.isOwner && !def.requiredPermission(ctx.permissions)) return false
  return true
}

/**
 * The grouped merchant console nav — Owner/Manager/General's real
 * experience. Kitchen/Delivery/Counter workspaces deliberately don't use
 * this (see workspace-nav.ts): they get a single dedicated operational
 * link each, not a filtered version of the full console.
 *
 * Never returns an empty group (§6 "Do not render empty groups") and never
 * a duplicate module.
 */
export function getAdminConsoleGroups(ctx: AdminModuleContext): AdminConsoleGroup[] {
  const groups: AdminConsoleGroup[] = []
  for (const groupId of GROUP_ORDER) {
    const modules = MODULE_DEFS.filter((def) => def.group === groupId && isModuleVisible(def, ctx)).map((def) => ({
      key: def.key,
      href: def.href,
      label: def.label(ctx),
    }))
    if (modules.length > 0) {
      groups.push({ id: groupId, title: ADMIN_MODULE_GROUP_TITLES[groupId], modules })
    }
  }
  return groups
}
