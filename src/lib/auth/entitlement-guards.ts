/**
 * Plan checks for dashboard routes and actions.
 *
 * Two independent questions, always both asked, in this order:
 *   1. May this PERSON do it?        → BusinessRole.permissions (guards.ts)
 *   2. Does this BUSINESS's plan include it? → entitlements
 *
 * A plan never grants a person anything their role doesn't allow, and a
 * permission never unlocks a feature the business's plan doesn't include.
 * The business is always the one in the signed session.
 */

import { AuthError, requireStaff, requireStaffPermission, resolveStaffActor } from './guards'
import type { StaffPermissions } from '@/types'
import { getBusinessEntitlements } from '@/modules/billing/subscription.service'
import { hasFeature, type Entitlements } from '@/modules/billing/entitlements'
import { featureLabel, type BooleanFeature } from '@/modules/billing/features'

/**
 * A 403 like any other AuthError (handleApiError and the dashboard's
 * existing catch blocks treat it the same way), but identifiable so a page
 * can show an upgrade message instead of a permissions one.
 */
export class EntitlementError extends AuthError {
  constructor(readonly feature: BooleanFeature) {
    super(`${featureLabel(feature)} isn't included in your plan yet.`, 403)
  }
}

export function assertFeature(entitlements: Entitlements, feature: BooleanFeature): void {
  if (!hasFeature(entitlements, feature)) throw new EntitlementError(feature)
}

/**
 * Signed-in staff member (optionally with `permission`) whose business has
 * `feature`. Authorization is checked first, so a person without permission
 * learns nothing about the business's plan.
 */
export async function requireStaffFeature(feature: BooleanFeature, permission?: keyof StaffPermissions) {
  const payload = permission ? (await requireStaffPermission(permission)).payload : await requireStaff()
  const entitlements = await getBusinessEntitlements(payload.tenantId)
  assertFeature(entitlements, feature)
  return { payload, entitlements }
}

/**
 * The signed-in person, as an actor, for a feature their business must have
 * (the Business Buddy). Plan first via requireStaffFeature, then the same
 * staff lookup requireStaffPermission makes — the actor carries THEIR
 * permissions, which every buddy read and action then checks.
 */
export async function requireStaffActorWithFeature(feature: BooleanFeature) {
  const { payload, entitlements } = await requireStaffFeature(feature)
  return { actor: await resolveStaffActor(payload), entitlements }
}
