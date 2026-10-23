/**
 * One-off backfill, extended across two migrations:
 *
 * 1. (2026-09-09) `BusinessRole.presetRole` so the staff-invite role picker
 *    resolves to a real, distinct role instead of always falling back to
 *    whichever row has `isDefault: true` — the bug the P0 audit found
 *    (`inviteStaff` ignored the selected `staffRole` entirely).
 * 2. (2026-09-10) `BusinessRole.jobPreset` — the newer, primary preset
 *    identifier covering all seven staff presets
 *    (src/modules/staff/staff-presets.ts), including three
 *    (Kitchen/Driver/Stock) with no `StaffRole`/`presetRole` equivalent at
 *    all, since `StaffRole` is frozen and never gains new values.
 *
 * `createBusiness` seeds all of this for every NEW business. This script
 * does the equivalent for businesses created before either change:
 *
 *   - Tags the existing owner role with `presetRole: 'OWNER'` — identified
 *     via the owner's own `BusinessStaff.roleId` (whatever that role is
 *     actually called), never by matching `name === 'Owner'`.
 *   - Tags the existing `isDefault: true` role with `presetRole: 'STAFF'`
 *     and `jobPreset: 'GENERAL'`.
 *   - For each of the four legacy-shaped presets (Manager/Counter/
 *     ServiceProvider, keyed by their `presetRole`), tags the matching
 *     existing row with `jobPreset` if one exists, or creates it if not.
 *   - Creates the three job-based presets with no `presetRole` at all
 *     (Kitchen/Driver/Stock) if missing, tagged only via `jobPreset`.
 *
 * This NEVER reassigns any `BusinessStaff.roleId` — every existing staff
 * member keeps the exact role (and therefore the exact permissions) they
 * already had. It only adds identifying tags to rows that already exist,
 * and adds new rows nothing currently points at. No historical employee's
 * access changes as a result of running this.
 *
 * Not run automatically by any build/deploy/migration step:
 *
 *   npx tsx prisma/scripts/backfill-role-presets.ts          # dry run, prints a diff
 *   npx tsx prisma/scripts/backfill-role-presets.ts --apply  # writes it
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '../../src/lib/prisma/client'
import { STAFF_PRESETS } from '../../src/modules/staff/staff-presets'

interface RoleRow {
  id: string
  name: string
  isDefault: boolean
  presetRole: string | null
  jobPreset: string | null
}

async function main() {
  const apply = process.argv.includes('--apply')

  const businesses = await prisma.business.findMany({ select: { id: true, name: true } })

  let tagged = 0
  let created = 0

  for (const business of businesses) {
    const roles: RoleRow[] = await prisma.businessRole.findMany({
      where: { businessId: business.id },
      select: { id: true, name: true, isDefault: true, presetRole: true, jobPreset: true },
    })
    const byPresetRole = new Map(roles.filter((r) => r.presetRole).map((r) => [r.presetRole, r]))
    const byJobPreset = new Map(roles.filter((r) => r.jobPreset).map((r) => [r.jobPreset, r]))

    async function tagPresetRole(role: RoleRow, presetRole: string) {
      tagged++
      role.presetRole = presetRole
      byPresetRole.set(presetRole, role)
      console.log(
        `${apply ? 'TAGGING' : 'WOULD TAG'} role ${role.id} (business ${business.id}, "${business.name}") as presetRole=${presetRole}`,
      )
      if (apply) await prisma.businessRole.update({ where: { id: role.id }, data: { presetRole: presetRole as never } })
    }

    async function tagJobPreset(role: RoleRow, jobPreset: string) {
      tagged++
      role.jobPreset = jobPreset
      byJobPreset.set(jobPreset, role)
      console.log(
        `${apply ? 'TAGGING' : 'WOULD TAG'} role ${role.id} (business ${business.id}, "${business.name}") as jobPreset=${jobPreset}`,
      )
      if (apply) await prisma.businessRole.update({ where: { id: role.id }, data: { jobPreset } })
    }

    // --- OWNER: tag the role the owner's own BusinessStaff row actually uses.
    if (!byPresetRole.has('OWNER')) {
      const ownerStaff = await prisma.businessStaff.findFirst({
        where: { businessId: business.id, isOwner: true },
        select: { roleId: true },
      })
      const ownerRole = ownerStaff?.roleId ? roles.find((r) => r.id === ownerStaff.roleId) : undefined
      if (ownerRole && !ownerRole.presetRole) {
        await tagPresetRole(ownerRole, 'OWNER')
      } else if (!ownerRole) {
        console.warn(`Business ${business.id} ("${business.name}") has no owner BusinessStaff with a role — skipping OWNER tag.`)
      }
    }

    // --- STAFF/GENERAL: tag the isDefault row with both identifiers.
    if (!byPresetRole.has('STAFF') || !byJobPreset.has('GENERAL')) {
      const defaultRole = roles.find((r) => r.isDefault)
      if (defaultRole) {
        if (!defaultRole.presetRole) await tagPresetRole(defaultRole, 'STAFF')
        if (!defaultRole.jobPreset) await tagJobPreset(defaultRole, 'GENERAL')
      } else {
        console.warn(`Business ${business.id} ("${business.name}") has no isDefault role — skipping STAFF/GENERAL tag.`)
      }
    }

    // --- Every preset in the registry: tag an existing matching row via
    // jobPreset, or create one if none exists. GENERAL is already handled
    // above (it's the isDefault row); everything else either reuses an
    // existing presetRole-tagged row (Manager/Counter/ServiceProvider) or
    // is a genuinely new row (Kitchen/Driver/Stock, which have no
    // presetRole at all).
    for (const preset of Object.values(STAFF_PRESETS)) {
      if (preset.id === 'GENERAL' || byJobPreset.has(preset.id)) continue

      const existingByPresetRole = preset.presetRole ? byPresetRole.get(preset.presetRole) : undefined
      if (existingByPresetRole) {
        await tagJobPreset(existingByPresetRole, preset.id)
        continue
      }

      created++
      console.log(
        `${apply ? 'CREATING' : 'WOULD CREATE'} ${preset.id} role for business ${business.id} ("${business.name}")`,
      )
      if (apply) {
        await prisma.businessRole.create({
          data: {
            businessId: business.id,
            name: preset.name,
            isDefault: false,
            presetRole: preset.presetRole,
            jobPreset: preset.id,
            permissions: preset.permissions as unknown as Prisma.InputJsonValue,
          },
        })
      }
    }
  }

  console.log(
    `\n${businesses.length} business(es) checked. ${tagged} role(s) ${apply ? 'tagged' : 'need tagging'}, ` +
      `${created} role(s) ${apply ? 'created' : 'need creating'}.` +
      (apply ? '' : ' Re-run with --apply to write these changes.'),
  )
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
