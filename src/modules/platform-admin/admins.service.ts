/**
 * Managing platform admins (super admins only). A role change bumps the
 * target's session epoch, so their open sessions end and the new role applies
 * from their next sign-in. Guard rails: never your own role, never the last
 * super admin.
 */

import type { PlatformAdminRole } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { AdminCommandError } from './command'
import { ROLE_PERMISSIONS } from './permissions'

export async function listAdmins() {
  return prisma.platformAdmin.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      role: true,
      mfaEnabledAt: true,
      createdAt: true,
      user: { select: { id: true, email: true, isActive: true, lastLoginAt: true } },
      _count: { select: { recoveryCodes: { where: { usedAt: null } } } },
    },
  })
}

export async function setAdminRole(actorUserId: string, targetAdminId: string, role: PlatformAdminRole) {
  if (!(role in ROLE_PERMISSIONS)) throw new AdminCommandError('Unknown role.')
  const target = await prisma.platformAdmin.findUnique({ where: { id: targetAdminId }, select: { id: true, userId: true, role: true } })
  if (!target) throw new AdminCommandError('Admin not found.')
  if (target.userId === actorUserId) throw new AdminCommandError("You can't change your own role.")
  if (target.role === role) throw new AdminCommandError('That is already their role.')
  if (target.role === 'SUPER_ADMIN') {
    const supers = await prisma.platformAdmin.count({ where: { role: 'SUPER_ADMIN', user: { isActive: true } } })
    if (supers <= 1) throw new AdminCommandError("You can't demote the last super admin.")
  }
  await prisma.platformAdmin.update({ where: { id: target.id }, data: { role, sessionEpoch: { increment: 1 } } })
  return { from: target.role, to: role }
}
