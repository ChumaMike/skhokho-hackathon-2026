/**
 * Auth Guards
 *
 * Helpers used in API route handlers and Server Components to:
 *   1. Extract and verify the JWT from the Authorization header / cookie
 *   2. Assert that the caller has the correct role
 *   3. Assert the caller has a specific permission
 *
 * Each guard throws a typed error with an HTTP status code so the
 * API route handler can return the right status to the client.
 */

import { cookies, headers } from 'next/headers'
import { verifyToken, type TokenPayload } from '@/modules/auth/auth.service'
import { prisma } from '@/lib/prisma/client'
import { ALL_PERMISSIONS, NO_PERMISSIONS, type StaffPermissions } from '@/types'
import type { PlatformAdminRole } from '@prisma/client'
import { can, type AdminPermission } from '@/modules/platform-admin/permissions'
import { securityEvent, requestContext } from '@/modules/platform-admin/audit'

// ---------------------------------------------------------------------------
// Auth Error
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403 = 401,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

// `cookies()` and `headers()` are async in Next.js 15 — they must be awaited.
async function extractToken(): Promise<string | null> {
  // 1. Authorization: Bearer <token>
  const headerStore = await headers()
  const authHeader = headerStore.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }

  // 2. HttpOnly cookie (preferred for web clients)
  const cookieStore = await cookies()
  return (
    cookieStore.get('skhokho-staff-token')?.value ??
    cookieStore.get('skhokho-user-token')?.value ??
    cookieStore.get('skhokho-admin-token')?.value ??
    null
  )
}

// ---------------------------------------------------------------------------
// Generic: require any valid token
// ---------------------------------------------------------------------------

export async function requireAuth(): Promise<TokenPayload> {
  const token = await extractToken()
  if (!token) throw new AuthError('No authentication token provided')

  try {
    return await verifyToken(token)
  } catch {
    throw new AuthError('Invalid or expired token')
  }
}

// ---------------------------------------------------------------------------
// Platform admin guard
// ---------------------------------------------------------------------------

/**
 * The session of ONE actor type, read only from that type's own cookie (or a
 * Bearer token of that type). A person signed in as staff AND as a driver
 * (or admin) never has one session stand in for the other.
 */
async function requireSessionOf<T extends TokenPayload['type']>(type: T): Promise<Extract<TokenPayload, { type: T }>> {
  const headerStore = await headers()
  const authHeader = headerStore.get('authorization')
  const cookieNames: Record<TokenPayload['type'], string> = {
    platform_admin: 'skhokho-admin-token',
    admin_mfa: 'skhokho-admin-mfa',
    staff: 'skhokho-staff-token',
    platform_user: 'skhokho-user-token',
    driver: 'skhokho-driver-token',
    customer: 'skhokho-customer-token',
  }
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (await cookies()).get(cookieNames[type])?.value
  if (!token) throw new AuthError('No authentication token provided')
  let payload: TokenPayload
  try {
    payload = await verifyToken(token)
  } catch {
    throw new AuthError('Invalid or expired token')
  }
  if (payload.type !== type) {
    await securityEvent('session_type_mismatch', { outcome: 'DENIED', actor: { type: 'anonymous' }, metadata: { expected: type, presented: payload.type }, ...(await requestContext()) })
    throw new AuthError('Wrong kind of session for this action', 403)
  }
  return payload as Extract<TokenPayload, { type: T }>
}

/**
 * A storefront customer who signed in with a one-time code (see
 * customer-auth.service.ts). Read ONLY from the customer cookie — an owner,
 * staff or driver session never stands in for a customer, and this never
 * satisfies requireAuth/requireStaff. Returns null rather than throwing:
 * every page that uses it also has a signed-out state to render.
 */
export async function getCustomerSession(): Promise<Extract<TokenPayload, { type: 'customer' }> | null> {
  try {
    return await requireSessionOf('customer')
  } catch {
    return null
  }
}

export async function requireCustomerSession() {
  return requireSessionOf('customer')
}

/** A signed-in Skhokholetha driver whose account is still active. */
export async function requireDriverSession() {
  const payload = await requireSessionOf('driver')
  const user = await prisma.appUser.findUnique({ where: { id: payload.userId }, select: { isActive: true } })
  if (!user?.isActive) throw new AuthError('Your account has been deactivated', 403)
  const driver = await prisma.driverProfile.findUnique({ where: { id: payload.driverId }, select: { id: true, userId: true } })
  if (!driver || driver.userId !== payload.userId) throw new AuthError('Driver profile not found', 403)
  return payload
}

export interface AdminContext {
  /** AppUser id of the admin. */
  adminId: string
  /** platform_admins.id */
  platformAdminId: string
  email: string
  role: PlatformAdminRole
}

/**
 * A platform admin who completed MFA in THIS session, is still an active
 * ADMIN user, whose session hasn't been ended by an MFA reset or role change
 * (epoch), and whose role (read from the database, never the token) grants
 * `permission`. Staff, driver, customer and half-signed-in (password-only)
 * sessions never pass. A denial with a session present is a security event.
 */
export async function requireAdmin(permission?: AdminPermission): Promise<AdminContext> {
  const payload = await requireSessionOf('platform_admin')
  if (payload.mfa !== true) throw new AuthError('MFA required', 401)
  const admin = await prisma.platformAdmin.findUnique({
    where: { userId: payload.adminId },
    select: { id: true, role: true, sessionEpoch: true, mfaEnabledAt: true, user: { select: { role: true, isActive: true, email: true } } },
  })
  if (!admin || admin.user.role !== 'ADMIN' || !admin.user.isActive || !admin.mfaEnabledAt || admin.sessionEpoch !== payload.epoch) {
    throw new AuthError('Admin session is no longer valid', 401)
  }
  if (permission && !can(admin.role, permission)) {
    const ctx = await requestContext()
    await securityEvent('admin_permission_denied', { outcome: 'DENIED', actor: { type: 'platform_admin', id: payload.adminId }, metadata: { permission, role: admin.role }, ...ctx })
    throw new AuthError("Your admin role doesn't allow this.", 403)
  }
  return { adminId: payload.adminId, platformAdminId: admin.id, email: admin.user.email, role: admin.role }
}

/** Kept for existing call sites: a super admin with a valid MFA session. */
export async function requireSuperAdmin(): Promise<AdminContext> {
  return requireAdmin('admins.manage')
}

// ---------------------------------------------------------------------------
// Staff guard (tenant-scoped)
// ---------------------------------------------------------------------------

export async function requireStaff(tenantId?: string) {
  const payload = await requireAuth()
  if (payload.type !== 'staff') {
    throw new AuthError('Staff access required', 403)
  }

  // If tenantId is specified, ensure staff belongs to that tenant
  if (tenantId && payload.tenantId !== tenantId) {
    throw new AuthError('You do not have access to this business', 403)
  }

  await assertSessionStillActive(payload)
  return payload
}

/**
 * A signed session is only as good as the account behind it right now: a
 * deactivated team member (or owner account) loses access on their next
 * request, not when their token expires days later. Fails closed.
 */
export async function assertSessionStillActive(payload: { staffId: string; tenantId: string; isOwner: boolean }) {
  if (payload.isOwner) {
    const owner = await prisma.appUser.findUnique({ where: { id: payload.staffId }, select: { isActive: true } })
    if (!owner?.isActive) throw new AuthError('Your account has been deactivated', 403)
    return
  }
  const staff = await prisma.businessStaff.findUnique({
    where: { id: payload.staffId },
    select: { isActive: true, businessId: true, isOwner: true },
  })
  if (!staff || !staff.isActive || staff.isOwner || staff.businessId !== payload.tenantId) {
    throw new AuthError('Your account has been deactivated', 403)
  }
}

/**
 * Owner-only: same "staff" token as any team member, but with `isOwner`
 * checked. Use for actions a regular team member must never reach —
 * inviting/removing staff, in particular — even though (see Known Risks in
 * the tool-graduation record) most other dashboard actions do not yet
 * check `requireStaffPermission`'s per-role permissions and are reachable
 * by any signed-in team member today.
 *
 * `StaffPermissions.canManageStaff`/`canInviteStaff` exist for this exact
 * boundary but are deliberately NOT consulted here — this hard owner-only
 * gate is already the strictest policy possible (a non-owner can never
 * reach staff/actions.ts regardless of what their role's permissions JSON
 * says), so wiring those flags in today could only ever loosen access, not
 * tighten it. They stay in the type as a real, intentional future
 * capability (a Manager who can manage the team without being a full
 * owner) — deferred, not dead, pending the staff/workspace architecture
 * review (docs/specs/2026-09-08-staff-workspace-architecture.md).
 */
export async function requireOwner(tenantId?: string) {
  const payload = await requireStaff(tenantId)
  if (!payload.isOwner) throw new AuthError('Owner access required', 403)
  return payload
}

/**
 * `tenantId` is optional and, for the common /dashboard/* call site, should
 * usually be omitted — a page/action doesn't know its own tenantId until
 * *after* authenticating, so there's nothing meaningful to check it
 * against yet. Pass it only when the caller already has a businessId from
 * elsewhere (e.g. a URL param on a tenant-scoped API route) and wants the
 * extra defense-in-depth of confirming the session actually belongs to it.
 */
const recentStaffDenials = new Map<string, number>()

export async function requireStaffPermission(
  permission: keyof StaffPermissions,
  tenantId?: string,
) {
  const payload = await requireStaff(tenantId)

  // Owner bypass MUST be decided from the token, before any DB lookup: for
  // an owner, payload.staffId actually holds AppUser.id, not a real
  // BusinessStaff.id (see /api/platform/login's comment — there is no
  // dedicated "owner" token type, so an owner signs in as a StaffToken).
  // Looking that up against `businessStaff` would find nothing and throw
  // "Staff member not found" for the owner themselves, on every single
  // permission-checked action — this was caught before it ever shipped
  // wired into a real call site, precisely because of that mismatch.
  if (payload.isOwner) return { payload, staff: null }

  const staff = await prisma.businessStaff.findUnique({
    where: { id: payload.staffId },
    include: { role: true },
  })

  if (!staff) throw new AuthError('Staff member not found')
  if (!staff.isActive) throw new AuthError('Your account has been deactivated', 403)
  // No `staff.isOwner` bypass needed here: the owner's own BusinessStaff row
  // (created alongside their AppUser row, see createBusiness in
  // tenant.service.ts) has no login path of its own — a real staff-login
  // token reaching this line is, by construction, never the owner.

  // `permissions` is Prisma `Json`, so widen through unknown before narrowing.
  const permissions = (staff.role?.permissions ?? {}) as unknown as StaffPermissions
  if (!permissions[permission]) {
    // Pages also probe permissions to decide what to show, so one event per staff+permission per hour per instance.
    const key = `${payload.staffId}:${permission}`
    if ((recentStaffDenials.get(key) ?? 0) < Date.now() - 60 * 60 * 1000) {
      recentStaffDenials.set(key, Date.now())
      if (recentStaffDenials.size > 5_000) recentStaffDenials.clear()
      await securityEvent('staff_permission_denied', { outcome: 'DENIED', actor: { type: 'staff', id: payload.staffId }, businessId: payload.tenantId, metadata: { permission }, ...(await requestContext()) })
    }
    throw new AuthError("Your role doesn't have permission to do that — ask the business owner.", 403)
  }

  return { payload, staff }
}

/**
 * Like requireStaffPermission, but passes if the caller has ANY ONE of
 * several permissions — for a page or action whose real requirement is a
 * disjunction (e.g. "customer authority" means canManageCustomers OR
 * canIssueLoyalty; a preset can reasonably have one without the other).
 * Also returns the caller's full `permissions` object so a caller that
 * needs a SECOND, more specific check afterward (e.g. order.service.ts's
 * canAdvanceOrderFromStatus, which distinguishes a prep-only transition
 * from a managerial one) doesn't have to re-fetch the role. An owner's
 * `permissions` here is ALL_PERMISSIONS — they bypass every check, so
 * downstream logic never needs its own separate isOwner branch.
 *
 * Kept as its own function rather than folded into requireStaffPermission
 * to avoid touching that function's existing, widely-used `{payload, staff}`
 * return shape.
 */
export async function requireAnyStaffPermission(
  permissions: (keyof StaffPermissions)[],
  tenantId?: string,
) {
  const payload = await requireStaff(tenantId)

  if (payload.isOwner) return { payload, staff: null, permissions: ALL_PERMISSIONS }

  const staff = await prisma.businessStaff.findUnique({
    where: { id: payload.staffId },
    include: { role: true },
  })

  if (!staff) throw new AuthError('Staff member not found')
  if (!staff.isActive) throw new AuthError('Your account has been deactivated', 403)

  const rolePermissions = (staff.role?.permissions ?? {}) as unknown as StaffPermissions
  if (!permissions.some((p) => rolePermissions[p])) {
    throw new AuthError("Your role doesn't have permission to do that — ask the business owner.", 403)
  }

  return { payload, staff, permissions: rolePermissions }
}

// ---------------------------------------------------------------------------
// Platform user (customer) guard
// ---------------------------------------------------------------------------

export async function requirePlatformUser() {
  const payload = await requireAuth()
  if (payload.type !== 'platform_user') {
    throw new AuthError('Platform user access required', 403)
  }

  // Customers authenticate by WhatsApp OTP; there is no AppUser row for them.
  // Session validity is carried by the signed token (M1 adds a session store).
  return payload
}

// ---------------------------------------------------------------------------
// Convenience: wrap an API route handler with auth
// ---------------------------------------------------------------------------

type Handler<T> = (authPayload: TokenPayload) => Promise<T>

export async function withAuth<T>(handler: Handler<T>): Promise<T> {
  const payload = await requireAuth()
  return handler(payload)
}

// ---------------------------------------------------------------------------
// Staff actor — the person behind a session, with their resolved permissions
// ---------------------------------------------------------------------------

/**
 * Who is acting, and exactly what their role allows — resolved by the same
 * rules requireStaffPermission applies (owner bypass decided from the token;
 * otherwise an ACTIVE BusinessStaff row of THIS business, its role's
 * permissions JSON, missing keys reading false). For code that makes several
 * permission decisions in one request — the Business Buddy decides what it
 * may show and suggest — so each decision reads one source of truth instead
 * of re-implementing it.
 */
export interface StaffActor {
  tenantId: string
  /** The session's staffId — for an owner this is their AppUser id. */
  staffId: string
  isOwner: boolean
  permissions: StaffPermissions
}

export async function resolveStaffActor(payload: { type: string; staffId?: string; tenantId?: string; isOwner?: boolean }): Promise<StaffActor> {
  if (payload.type !== 'staff' || !payload.staffId || !payload.tenantId) throw new AuthError('Staff access required', 403)
  if (payload.isOwner) return { tenantId: payload.tenantId, staffId: payload.staffId, isOwner: true, permissions: ALL_PERMISSIONS }

  const staff = await prisma.businessStaff.findUnique({ where: { id: payload.staffId }, include: { role: true } })
  if (!staff) throw new AuthError('Staff member not found')
  if (!staff.isActive) throw new AuthError('Your account has been deactivated', 403)
  if (staff.businessId !== payload.tenantId) throw new AuthError('You do not have access to this business', 403)
  const permissions = { ...NO_PERMISSIONS, ...((staff.role?.permissions ?? {}) as unknown as Partial<StaffPermissions>) }
  return { tenantId: payload.tenantId, staffId: payload.staffId, isOwner: false, permissions }
}

/** The signed-in staff member as an actor. */
export async function requireStaffActor(): Promise<StaffActor> {
  return resolveStaffActor(await requireStaff())
}

/** True when the actor's role grants ANY of the given permissions (owners: always). */
export function actorCan(actor: StaffActor, permission: keyof StaffPermissions | (keyof StaffPermissions)[]): boolean {
  const wanted = Array.isArray(permission) ? permission : [permission]
  return wanted.some((p) => actor.permissions[p] === true)
}

export function assertActorCan(actor: StaffActor, permission: keyof StaffPermissions | (keyof StaffPermissions)[]): void {
  if (!actorCan(actor, permission)) {
    throw new AuthError("Your role doesn't have permission to do that — ask the business owner.", 403)
  }
}
