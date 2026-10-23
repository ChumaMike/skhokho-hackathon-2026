/**
 * Reads BusinessNotification for the dashboard.
 *
 * Read state is PER STAFF MEMBER (business_notification_reads): one teammate
 * opening a notification never hides it from another. `staffId` is the
 * session's staffId — a BusinessStaff id, or the owner's AppUser id for the
 * owner token — so it's unique per person either way. The legacy
 * business-wide `isRead` column is left untouched for older readers.
 */

import { prisma } from '@/lib/prisma/client'

export interface BusinessNotificationRow {
  id: string
  type: string
  title: string
  message: string
  isRead: boolean
  createdAt: Date
  /** The order this is about, when it is about one (from `data.orderId`). */
  orderId?: string | null
}

const SELECT = { id: true, type: true, title: true, message: true, isRead: true, createdAt: true, data: true } as const

function orderIdOf(data: unknown): string | null {
  const d = data as { orderId?: unknown } | null
  return d && typeof d.orderId === 'string' ? d.orderId : null
}

/** Latest notifications with THIS person's read state. */
export async function listRecentNotificationsFor(businessId: string, staffId: string, opts?: { limit?: number }): Promise<BusinessNotificationRow[]> {
  const rows = await prisma.businessNotification.findMany({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
    take: opts?.limit ?? 20,
    select: { ...SELECT, reads: { where: { staffId }, select: { staffId: true } } },
  })
  return rows.map((r) => ({ id: r.id, type: r.type, title: r.title, message: r.message, isRead: r.reads.length > 0, createdAt: r.createdAt, orderId: orderIdOf(r.data) }))
}

export async function countUnreadNotificationsFor(businessId: string, staffId: string): Promise<number> {
  return prisma.businessNotification.count({ where: { businessId, reads: { none: { staffId } } } })
}

/** Marks everything currently unread for this person. Tenant-scoped; idempotent. */
export async function markAllNotificationsReadFor(businessId: string, staffId: string): Promise<void> {
  const unread = await prisma.businessNotification.findMany({ where: { businessId, reads: { none: { staffId } } }, select: { id: true } })
  if (unread.length === 0) return
  await prisma.businessNotificationRead.createMany({ data: unread.map((n) => ({ notificationId: n.id, staffId })), skipDuplicates: true })
}

export async function markNotificationReadFor(businessId: string, staffId: string, notificationId: string): Promise<void> {
  // The notification must belong to this business — an id from elsewhere matches nothing.
  const n = await prisma.businessNotification.findFirst({ where: { id: notificationId, businessId }, select: { id: true } })
  if (!n) return
  await prisma.businessNotificationRead.createMany({ data: [{ notificationId: n.id, staffId }], skipDuplicates: true })
}

// --- legacy business-wide readers, kept for existing call sites -------------

export async function listRecentNotifications(businessId: string, opts?: { limit?: number }): Promise<BusinessNotificationRow[]> {
  const rows = await prisma.businessNotification.findMany({ where: { businessId }, orderBy: { createdAt: 'desc' }, take: opts?.limit ?? 20, select: SELECT })
  return rows.map((r) => ({ id: r.id, type: r.type, title: r.title, message: r.message, isRead: r.isRead, createdAt: r.createdAt, orderId: orderIdOf(r.data) }))
}

export async function countUnreadNotifications(businessId: string): Promise<number> {
  return prisma.businessNotification.count({ where: { businessId, isRead: false } })
}

export async function markAllNotificationsRead(businessId: string): Promise<void> {
  await prisma.businessNotification.updateMany({ where: { businessId, isRead: false }, data: { isRead: true, readAt: new Date() } })
}
