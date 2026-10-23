import { NextResponse } from 'next/server'
import { requireAnyStaffPermission, AuthError } from '@/lib/auth/guards'
import { prisma } from '@/lib/prisma/client'
import { countUnreadNotificationsFor } from '@/modules/dashboard/notifications'

export const runtime = 'nodejs'

/**
 * The live-orders heartbeat the dashboard polls (every ~12 s while the tab
 * is visible). Tenant-scoped by the session; needs the same permission as
 * seeing orders at all. Deliberately tiny: counts and the newest order's id/
 * time — never an order list — so a busy shop polling all day costs a few
 * indexed counts per poll.
 */
export async function GET() {
  let payload, permissions
  try {
    ;({ payload, permissions } = await requireAnyStaffPermission(['canManageOrders', 'canPrepareOrders']))
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 401
    return NextResponse.json({ ok: false }, { status, headers: { 'cache-control': 'no-store' } })
  }
  const businessId = payload.tenantId
  const [pending, active, newest, unread] = await Promise.all([
    prisma.order.count({ where: { businessId, status: 'PENDING' } }),
    prisma.order.count({ where: { businessId, status: { in: ['CONFIRMED', 'PROCESSING', 'READY'] } } }),
    prisma.order.findFirst({ where: { businessId, status: { notIn: ['CANCELLED'] } }, orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true } }),
    permissions.canManageOrders ? countUnreadNotificationsFor(businessId, payload.staffId) : Promise.resolve(0),
  ])
  return NextResponse.json(
    {
      ok: true,
      pendingOrders: pending,
      activeOrders: active,
      newestOrderId: newest?.id ?? null,
      newestOrderAt: newest?.createdAt.toISOString() ?? null,
      unreadNotifications: unread,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
