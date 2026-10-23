import { redirect } from 'next/navigation'
import { requireStaff, requireOwner, AuthError } from '@/lib/auth/guards'
import { prisma } from '@/lib/prisma/client'
import { ALL_PERMISSIONS, NO_PERMISSIONS, type StaffPermissions, type StaffWorkspace } from '@/types'
import { getBusinessCapabilities, type BusinessCapability } from '@/modules/tenant/capabilities'
import type { BusinessCategory } from '@prisma/client'
import type { DashboardNavBusiness } from '@/components/DashboardNav'

/**
 * Every /dashboard/* screen accepts any signed-in team member — the
 * business owner (a `StaffToken` with `isOwner: true`, issued by
 * /api/platform/login against `AppUser`) or, since Phase C, a real
 * `BusinessStaff` member (issued by /api/platform/staff-login,
 * `isOwner: false`). Despite the name, this is no longer owner-only; see
 * `requireOwnerOnlySession` below for pages that must be. Redirects to
 * /login when there is no valid session.
 */
export async function requireOwnerSession() {
  try {
    return await requireStaff()
  } catch (err) {
    if (err instanceof AuthError) redirect('/login')
    throw err
  }
}

/** For pages a regular team member must never reach — staff management. */
export async function requireOwnerOnlySession() {
  try {
    return await requireOwner()
  } catch (err) {
    if (err instanceof AuthError) redirect('/login')
    throw err
  }
}

export interface StaffWorkspaceContext {
  isOwner: boolean
  permissions: StaffPermissions
  primaryWorkspace: StaffWorkspace | null
  jobTitle: string | null
  capabilities: Set<BusinessCapability>
  /** Drives merchant-facing terminology (Business Experience Registry) — presentation only. */
  businessCategory: BusinessCategory
  /** Identity shown in the Business Console shell (name/logo/status, "View storefront"). Null only if the business row is somehow missing. */
  business: DashboardNavBusiness | null
}

/**
 * Resolves what src/lib/workspace-nav.ts needs to compute a nav, in a
 * couple of DB calls — mirroring requireStaffPermission's own owner bypass
 * (guards.ts) for the staff lookup. This is presentation-only context:
 * `permissions` here is read the same way requireStaffPermission reads it,
 * but nothing in this file enforces anything — every action stays
 * independently gated. `capabilities` is only used to decide whether to
 * show a "Deliveries" nav link, not to authorize anything.
 */
export async function getStaffWorkspaceContext(session: {
  staffId: string
  isOwner: boolean
  tenantId: string
}): Promise<StaffWorkspaceContext> {
  const business = await prisma.business.findUnique({
    where: { id: session.tenantId },
    select: { category: true, settings: true, name: true, slug: true, logoUrl: true, status: true },
  })
  const capabilities = business ? getBusinessCapabilities(business) : new Set<BusinessCapability>()
  const businessCategory = business?.category ?? 'OTHER'
  const businessIdentity: DashboardNavBusiness | null = business
    ? { name: business.name, slug: business.slug, logoUrl: business.logoUrl, status: business.status }
    : null

  if (session.isOwner) {
    return {
      isOwner: true,
      permissions: ALL_PERMISSIONS,
      primaryWorkspace: 'OWNER',
      jobTitle: null,
      capabilities,
      businessCategory,
      business: businessIdentity,
    }
  }

  const staff = await prisma.businessStaff.findUnique({
    where: { id: session.staffId },
    include: { role: true },
  })

  return {
    isOwner: false,
    permissions: (staff?.role?.permissions ?? NO_PERMISSIONS) as unknown as StaffPermissions,
    primaryWorkspace: staff?.primaryWorkspace ?? null,
    jobTitle: staff?.jobTitle ?? null,
    capabilities,
    businessCategory,
    business: businessIdentity,
  }
}
