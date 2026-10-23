/**
 * Platform-admin pages live under /platform-admin. On the platform host they
 * are reached at that path; on the admin host (admin.<platform>) middleware
 * adds the prefix itself, so the same page is reached WITHOUT it.
 */

export const ADMIN_PREFIX = '/platform-admin'

/** `/platform-admin/x` → `/x` (and `/platform-admin` → `/`); null when the path has no prefix. */
export function stripAdminPrefix(pathname: string): string | null {
  if (pathname === ADMIN_PREFIX) return '/'
  if (pathname.startsWith(`${ADMIN_PREFIX}/`)) return pathname.slice(ADMIN_PREFIX.length)
  return null
}

/** Where an admin page is reached on the host the visitor is using. */
export function adminPath(path: `/${string}`, onAdminHost: boolean): string {
  return onAdminHost ? path : `${ADMIN_PREFIX}${path === '/' ? '' : path}`
}
