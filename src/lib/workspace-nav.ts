/**
 * Central navigation policy — replaces DashboardNav's old static section
 * list. Explicitly presentation-only: this decides which links render and
 * where "home" points for a given staff member, nothing more. It is NOT an
 * authorization mechanism and must never be treated as one — every page
 * and server action this might hide a link to remains independently
 * gated by requireOwner()/requireStaffPermission(), completely unaware
 * this module exists. Direct URL navigation to a hidden section behaves
 * exactly as if the link were visible: permission-checked, same as today.
 *
 * `primaryWorkspace: null` (every staff member invited before this
 * milestone) is treated identically to `'GENERAL'` — the one hard backward-
 * compatibility guarantee this file makes.
 *
 * OWNER/MANAGER/GENERAL (and the no-dedicated-screen-yet SERVICE_PROVIDER/
 * STOCK fallback) get the real, grouped Business Console — built from the
 * Admin Module Registry (src/modules/dashboard/admin-modules.ts), which is
 * both capability- AND permission-aware (§12 of the Business Console
 * milestone: "Permissions filter the current person's admin experience").
 * This supersedes the older rule that navigation only ever varied by
 * `primaryWorkspace`, never by individual permission grants — that rule
 * predates the Business Console milestone's explicit ask for
 * permission-aware admin nav, and MANAGER's own permission preset (which
 * already lacks canManageStaff/canManageSettings/canManageDomains) means
 * this still reproduces "Manager has no Staff/Settings/Domains link" as an
 * emergent property, not a hardcoded workspace-name check.
 *
 * KITCHEN/DELIVERY/COUNTER stay deliberately un-generalised, single-link
 * (or, for Counter, small fixed-set) operational workspaces — "do not
 * duplicate the entire dashboard application" for a Kitchen worker or
 * Driver remains true independent of this rewrite.
 */

import type { StaffPermissions, StaffWorkspace } from '@/types'
import type { BusinessCapability } from '@/modules/tenant/capabilities'
import type { BusinessCategory } from '@prisma/client'
import type { DashboardSection } from '@/components/DashboardNav'
import { getBusinessExperience } from '@/modules/tenant/business-experience'
import { getAdminConsoleGroups, type AdminConsoleGroup } from '@/modules/dashboard/admin-modules'

export interface WorkspaceNavSection {
  key: DashboardSection
  href: string
  label: string
}

export interface WorkspaceNavResult {
  sections: WorkspaceNavSection[]
  defaultRoute: string
  /** Present only for the full grouped merchant console (see module doc above). */
  groups?: AdminConsoleGroup[]
}

export interface WorkspaceNavInput {
  isOwner: boolean
  permissions: StaffPermissions
  primaryWorkspace: StaffWorkspace | null
  /** Drives capability-gated modules (Deliveries, Kitchen, Bookings, Catalog, ...). Optional so
   *  callers that only have session/permission context on hand don't need to fetch business
   *  settings just to render a nav without it — omitting it fails OPEN (see buildConsoleNav). */
  capabilities?: Set<BusinessCapability>
  /** Drives merchant-facing terminology (Menu vs Products, Parts, ...). Defaults to the GENERAL/OTHER wording when omitted. */
  businessCategory?: BusinessCategory
}

function buildConsoleNav(input: WorkspaceNavInput, defaultRoute: string): WorkspaceNavResult {
  const capabilities = input.capabilities ?? FULL_CAPABILITY_SET
  const experience = getBusinessExperience(input.businessCategory ?? 'OTHER')
  const groups = getAdminConsoleGroups({
    isOwner: input.isOwner,
    permissions: input.permissions,
    capabilities,
    experience,
    hasProducts: capabilities.has('PRODUCTS'),
    hasServices: capabilities.has('SERVICES'),
  })
  const sections = groups.flatMap((g) => g.modules)
  return { sections, defaultRoute, groups }
}

// Used only when `capabilities` is omitted entirely — the existing
// "fails open" contract (a caller that hasn't wired capabilities through
// yet keeps seeing every capability-gated link, never loses one it didn't
// ask to hide).
const FULL_CAPABILITY_SET: Set<BusinessCapability> = new Set([
  'ORDERS',
  'PRODUCTS',
  'SERVICES',
  'BOOKINGS',
  'PICKUP',
  'DELIVERY',
  'LOYALTY',
  'INVENTORY',
  'STAFF',
  'PAYMENTS',
])

export function getWorkspaceNav(input: WorkspaceNavInput): WorkspaceNavResult {
  // Owner and GENERAL (which includes every pre-existing staff member,
  // since primaryWorkspace was null for all of them until this migration)
  // get today's exact, unchanged experience.
  const workspace = input.isOwner ? 'OWNER' : (input.primaryWorkspace ?? 'GENERAL')

  switch (workspace) {
    case 'COUNTER':
      return {
        sections: [
          { key: 'home', href: '/dashboard/counter', label: 'Home' },
          ...filterByCapability(pick(['orders', 'appointments', 'customers']), input.capabilities),
        ],
        defaultRoute: '/dashboard/counter',
      }

    case 'KITCHEN':
      // Deliberately minimal — "do not duplicate the entire dashboard
      // application." A single link, not a filtered version of the full nav.
      return { sections: [{ key: 'kitchen', href: '/dashboard/kitchen', label: 'Kitchen' }], defaultRoute: '/dashboard/kitchen' }

    case 'DELIVERY':
      // A driver must not gain access to the full /dashboard/orders page
      // merely because they can perform deliveries — same minimal-nav
      // treatment as Kitchen, one link, nothing else.
      return { sections: [{ key: 'deliveries', href: '/dashboard/driver', label: 'Deliveries' }], defaultRoute: '/dashboard/driver' }

    case 'MANAGER':
    case 'OWNER':
    case 'GENERAL':
    default:
      // SERVICE_PROVIDER/STOCK also fall here — valid preset/workspace
      // values with no dedicated screen yet, so they get the full grouped
      // console (filtered down by their actual permissions) rather than a
      // broken or fake one.
      return buildConsoleNav(input, '/dashboard')
  }
}

// ---------------------------------------------------------------------------
// Legacy helpers — still used by the COUNTER minimal nav above, which keeps
// its old hand-picked flat shape rather than routing through the grouped
// Admin Module Registry (Counter's screen isn't the merchant console).
// ---------------------------------------------------------------------------

const BASE_SECTIONS: WorkspaceNavSection[] = [
  { key: 'home', href: '/dashboard', label: 'Home' },
  { key: 'orders', href: '/dashboard/orders', label: 'Orders' },
  { key: 'appointments', href: '/dashboard/appointments', label: 'Bookings' },
  { key: 'catalog', href: '/dashboard/catalog', label: 'Catalogue' },
  { key: 'customers', href: '/dashboard/customers', label: 'Customers' },
]

function pick(keys: DashboardSection[]): WorkspaceNavSection[] {
  return BASE_SECTIONS.filter((s) => keys.includes(s.key))
}

/**
 * Drops 'appointments' when the business has no BOOKINGS capability — a
 * Food/Takeaway business (or any other non-booking category) otherwise
 * gets a permanently dead-end "No upcoming appointments" tab. Fails OPEN
 * (keeps the section) when `capabilities` is undefined.
 */
function filterByCapability(
  sections: WorkspaceNavSection[],
  capabilities: Set<BusinessCapability> | undefined,
): WorkspaceNavSection[] {
  if (!capabilities) return sections
  return sections.filter((s) => s.key !== 'appointments' || capabilities.has('BOOKINGS'))
}
