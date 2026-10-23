/**
 * Platform admin permissions. Least privilege by default: a new admin is
 * SUPPORT until a SUPER_ADMIN promotes them. The role is read from the
 * database on every request, never trusted from a token.
 *
 *   SUPER_ADMIN  everything, incl. admin users, MFA resets, audit & security
 *   OPERATIONS   businesses, drivers (incl. documents & decisions), deliveries, domains, AI
 *   FINANCE      payments, payouts & ledger adjustments (read-only elsewhere)
 *   SUPPORT      read-only views needed to help a merchant or driver
 *
 * Sensitive data needs a specific permission: driver documents, customer
 * delivery addresses, audit and security logs are not part of any "view".
 */

import type { PlatformAdminRole } from '@prisma/client'

export const ADMIN_PERMISSIONS = [
  'overview',
  'health',
  'businesses.view',
  'businesses.manage',
  'users.view',
  'orders.view',
  'orders.customerDetails',
  'payments.view',
  'payments.manage',
  'drivers.view',
  'drivers.manage',
  'drivers.documents',
  'deliveries.view',
  'deliveries.intervene',
  'payouts.view',
  'payouts.manage',
  /**
   * Platform billing — merchant subscriptions and invoices owed to Skhokho
   * Laboratory. Deliberately separate from `payments.view` (a merchant's own
   * customer payments) and `payouts.*` (driver earnings): three different
   * money streams that must never be conflated, including in who may see them.
   */
  'billing.view',
  'billing.manage',
  'domains.view',
  'ai.view',
  'ai.manage',
  'security.view',
  'audit.view',
  'admins.manage',
  'settings.view',
  // Tab 5
  'privacy.manage',
  'businesses.erase',
] as const

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number]

const COMMON: AdminPermission[] = ['overview', 'health', 'businesses.view', 'orders.view', 'domains.view', 'settings.view']

export const ROLE_PERMISSIONS: Record<PlatformAdminRole, ReadonlySet<AdminPermission>> = {
  SUPER_ADMIN: new Set(ADMIN_PERMISSIONS),
  OPERATIONS: new Set<AdminPermission>([
    ...COMMON,
    'businesses.manage',
    'users.view',
    'payments.view',
    'drivers.view',
    'drivers.manage',
    'drivers.documents',
    'deliveries.view',
    'deliveries.intervene',
    'orders.customerDetails',
    'payouts.view',
    'ai.view',
    'ai.manage',
    'privacy.manage',
  ]),
  // Platform billing is Finance's own job: they are the only role that may
  // record a settlement, comp a business or write an invoice off. OPERATIONS
  // deliberately does not get billing.manage — moving a merchant onto a paid
  // plan is a financial act, not an operational one.
  //
  // Rebase note: `payments.manage` comes from another tab and is kept. Taking
  // only this tab's version of the line would have silently removed it.
  FINANCE: new Set<AdminPermission>([...COMMON, 'payments.view', 'payments.manage', 'payouts.view', 'payouts.manage', 'billing.view', 'billing.manage', 'drivers.view', 'deliveries.view']),
  SUPPORT: new Set<AdminPermission>([...COMMON, 'users.view', 'drivers.view', 'deliveries.view', 'payments.view', 'ai.view']),
}

export function can(role: PlatformAdminRole, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role].has(permission)
}

export const ROLE_LABELS: Record<PlatformAdminRole, string> = {
  SUPER_ADMIN: 'Super admin',
  OPERATIONS: 'Operations',
  FINANCE: 'Finance',
  SUPPORT: 'Support',
}
