import { notFound } from 'next/navigation'
import { requireAdmin, type AdminContext } from '@/lib/auth/guards'
import type { AdminPermission } from './permissions'

/**
 * For admin PAGES: the same check as every action and route (MFA session,
 * active admin, current epoch, role permission). Anyone else gets a plain
 * 404, so the console's existence isn't confirmed to outsiders.
 */
export async function adminPage(permission: AdminPermission): Promise<AdminContext> {
  try {
    return await requireAdmin(permission)
  } catch {
    notFound()
  }
}
