/**
 * One-off backfill: Phase 5 added 7 new StaffPermissions keys
 * (canReadBookings, canManageBookings, canIssueLoyalty, canAdjustLoyalty,
 * canInviteStaff, canManageDomains, canManageBilling — see
 * docs/specs/2026-09-02-multi-tenant-domain-architecture.md and
 * src/types/index.ts). Any `BusinessRole` row written before this phase
 * simply lacks these keys; `requireStaffPermission` already reads a
 * missing key as falsy, so nothing is insecure by leaving old rows alone —
 * this script only exists to *restore* the access those roles already had
 * under the old, coarser gates, expressed through the new finer-grained
 * ones, for a business owner who wants that continuity instead of having
 * to manually re-grant it.
 *
 * Each new key is mirrored from whichever existing key most recently
 * gated the same action in the app code, NOT re-derived from first
 * principles — the goal is "what could this role already do," not "what
 * should this role be able to do":
 *
 *   canManageBookings / canReadBookings  <- canManageOrders
 *     (appointments/actions.ts gated booking complete/cancel on
 *     canManageOrders before Phase 5 added a dedicated key)
 *   canIssueLoyalty / canAdjustLoyalty   <- canManageCustomers
 *     (customers/actions.ts gated BOTH stampMember and redeemMember on
 *     canManageCustomers before Phase 5 split them — mirroring to the same
 *     key for both preserves exactly the access a role had, even though
 *     createBusiness's new default Staff seed now sets canAdjustLoyalty
 *     false by default for newly created businesses)
 *   canInviteStaff                       <- canManageStaff
 *     (staff/actions.ts hardcodes requireOwner regardless of this key
 *     today, so it has no runtime effect yet — mirrored for when it does)
 *   canManageDomains / canManageBilling  <- canManageSettings
 *     (no dedicated settings sub-page exists for either yet; canManageSettings
 *     is the closest existing "can touch business-level config" key)
 *
 * NOT run automatically by any build/deploy/migration step, and not run by
 * whoever wrote it, on purpose — a human should read the mapping above,
 * decide whether restoring old-shape access is actually wanted for this
 * business's data, and run it deliberately:
 *
 *   npx tsx prisma/scripts/backfill-permission-keys.ts          # dry run, prints a diff
 *   npx tsx prisma/scripts/backfill-permission-keys.ts --apply  # writes it
 */

import { prisma } from '../../src/lib/prisma/client'
import type { StaffPermissions } from '../../src/types'

type LegacyPermissions = Partial<StaffPermissions> & {
  canManageOrders?: boolean
  canManageCustomers?: boolean
  canManageStaff?: boolean
  canManageSettings?: boolean
}

const NEW_KEYS = [
  'canReadBookings',
  'canManageBookings',
  'canIssueLoyalty',
  'canAdjustLoyalty',
  'canInviteStaff',
  'canManageDomains',
  'canManageBilling',
] as const satisfies readonly (keyof StaffPermissions)[]

function deriveNewKeys(existing: LegacyPermissions): Pick<StaffPermissions, (typeof NEW_KEYS)[number]> {
  const bookings = existing.canManageOrders ?? false
  const loyalty = existing.canManageCustomers ?? false
  return {
    canReadBookings: bookings,
    canManageBookings: bookings,
    canIssueLoyalty: loyalty,
    canAdjustLoyalty: loyalty,
    canInviteStaff: existing.canManageStaff ?? false,
    canManageDomains: existing.canManageSettings ?? false,
    canManageBilling: existing.canManageSettings ?? false,
  }
}

async function main() {
  const apply = process.argv.includes('--apply')

  const roles = await prisma.businessRole.findMany({
    select: { id: true, businessId: true, name: true, permissions: true },
  })

  let toUpdate = 0
  for (const role of roles) {
    const existing = (role.permissions ?? {}) as LegacyPermissions
    const alreadyBackfilled = NEW_KEYS.every((k) => typeof existing[k] === 'boolean')
    if (alreadyBackfilled) continue

    toUpdate++
    const derived = deriveNewKeys(existing)
    const next = { ...existing, ...derived }

    console.log(
      `${apply ? 'UPDATING' : 'WOULD UPDATE'} role ${role.id} (business ${role.businessId}, "${role.name}"):`,
      derived,
    )

    if (apply) {
      await prisma.businessRole.update({ where: { id: role.id }, data: { permissions: next } })
    }
  }

  console.log(
    `\n${toUpdate} of ${roles.length} role(s) ${apply ? 'updated' : 'need updating'}.` +
      (apply ? '' : ' Re-run with --apply to write these changes.'),
  )
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
