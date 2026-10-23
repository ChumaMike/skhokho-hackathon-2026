/**
 * Staff Service — team members of a single business, distinct from the
 * owner (`AppUser`, role OWNER — see /api/platform/login). `BusinessStaff`
 * has existed in the schema since the beginning (createBusiness already
 * creates one row for the owner, mirroring their AppUser credentials) but
 * nothing before Phase C ever created a SECOND row or let one log in —
 * the model was fully built and completely unused for its actual purpose.
 *
 * Invite flow mirrors password reset (src/app/api/platform/forgot-password):
 * a random, never-told-to-anyone password is set at creation time so the
 * row is valid but unusable, alongside a resetToken the invite email
 * carries — "set your password" and "reset your password" are the same
 * mechanism here, just reached from different starting states.
 *
 * `resetToken` stores `hashToken(rawToken)` (auth.service.ts), not the raw
 * value — only the email link holds a usable credential; a DB read never
 * does. `inviteStaff`/`reinviteStaff` still return the raw token so the
 * caller can build the link, exactly once, at generation time.
 */

import crypto from 'node:crypto'
import { z } from 'zod'
import { prisma } from '@/lib/prisma/client'
import { hashPassword, hashToken } from '@/modules/auth/auth.service'
import { STAFF_PRESETS, type StaffPresetId } from '@/modules/staff/staff-presets'
import { assertCanAdd } from '@/modules/billing/limits'

export const InviteStaffSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  preset: z.enum(['MANAGER', 'COUNTER', 'KITCHEN', 'DRIVER', 'SERVICE_PROVIDER', 'STOCK', 'GENERAL']),
  /** Free text, defaults to the preset's suggested title when omitted/blank. */
  jobTitle: z.string().max(100).optional(),
})

const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Resolves a session payload's `staffId` to a REAL `BusinessStaff.id`.
 *
 * For an owner token, `payload.staffId` actually holds `AppUser.id` (see
 * /api/platform/login's comment) — not a valid `BusinessStaff.id`. Passing
 * it straight through to anything that stores it as a real foreign key
 * (`StockMovement.staffId`, in particular) silently fails the FK
 * constraint. Found while wiring `requireStaffPermission` into real call
 * sites: `dashboard/orders/actions.ts`'s `markOrderComplete` has been
 * passing the owner's `AppUser.id` into `completeOrder` → `adjustStock`
 * since that code was written — `completeOrder` swallows the resulting
 * error (a stock-deduction failure must never fail the order completion
 * itself), so this has been silently no-op'ing every stock deduction the
 * owner ever triggered, with nothing surfacing the failure anywhere.
 *
 * For a real staff-login token (`isOwner: false`), `payload.staffId`
 * already is the correct `BusinessStaff.id` — no lookup needed.
 */
export async function resolveActingStaffId(
  businessId: string,
  payload: { staffId: string; isOwner: boolean },
): Promise<string | undefined> {
  if (!payload.isOwner) return payload.staffId
  const owner = await prisma.businessStaff.findFirst({
    where: { businessId, isOwner: true },
    select: { id: true },
  })
  return owner?.id
}

export async function listStaff(businessId: string) {
  return prisma.businessStaff.findMany({
    where: { businessId },
    orderBy: [{ isOwner: 'desc' }, { firstName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      staffRole: true,
      jobTitle: true,
      isOwner: true,
      isActive: true,
      lastLoginAt: true,
      resetToken: true,
      role: { select: { jobPreset: true, presetRole: true, name: true } },
    },
  })
}

/**
 * Creates the BusinessStaff row and a 7-day set-password token. Returns the
 * raw token — the caller (a server action, not this DB-only service) is
 * responsible for building the URL and sending the invite email, matching
 * how forgot-password/route.ts keeps that concern out of the service layer.
 */
export async function inviteStaff(businessId: string, input: z.infer<typeof InviteStaffSchema>) {
  const validated = InviteStaffSchema.parse(input)
  const email = validated.email.toLowerCase()

  const existing = await prisma.businessStaff.findUnique({
    where: { businessId_email: { businessId, email } },
  })
  if (existing) throw new Error('Someone with that email is already on your team.')

  // Plan allowance. Checked after the duplicate check so re-inviting someone
  // already on the team reads as a duplicate, not as a plan problem — and the
  // owner's own row is excluded from the count, because registration must
  // never be refused for a billing reason (see modules/billing/limits.ts).
  await assertCanAdd(businessId, 'max_staff')

  const preset = STAFF_PRESETS[validated.preset as StaffPresetId]

  // Resolve the BusinessRole matching the preset the owner actually picked.
  // jobPreset is the canonical identifier for all seven presets
  // (STAFF_PRESETS/LEGACY_PRESET_ROLE_TO_JOB_PRESET, staff-presets.ts) —
  // checked first. presetRole (the legacy StaffRole mirror, only set for
  // the four presets that predate jobPreset existing) is the backward-
  // compatibility fallback for a business tagged under the older system.
  // isDefault is the last resort, for a business that predates BOTH
  // migrations and hasn't been backfilled yet
  // (prisma/scripts/backfill-role-presets.ts). Never invents permissions,
  // just degrades to the same behaviour every invite had before these fixes.
  const role =
    (await prisma.businessRole.findFirst({
      where: { businessId, jobPreset: preset.id },
    })) ??
    (preset.presetRole &&
      (await prisma.businessRole.findFirst({
        where: { businessId, presetRole: preset.presetRole },
      }))) ??
    (await prisma.businessRole.findFirst({
      where: { businessId, isDefault: true },
    }))

  const unusablePassword = crypto.randomBytes(32).toString('hex')
  const passwordHash = await hashPassword(unusablePassword)
  const token = crypto.randomBytes(32).toString('hex')

  const staff = await prisma.businessStaff.create({
    data: {
      businessId,
      roleId: role?.id,
      email,
      passwordHash,
      firstName: validated.firstName,
      lastName: validated.lastName,
      // Legacy column — kept consistent for anything that still reads it
      // instead of jobTitle/primaryWorkspace. STAFF is the closest safe
      // value for a preset (Kitchen/Driver/Stock) with no real StaffRole.
      staffRole: preset.presetRole ?? 'STAFF',
      jobTitle: validated.jobTitle?.trim() || preset.jobTitle,
      primaryWorkspace: preset.workspace,
      isOwner: false,
      resetToken: hashToken(token),
      resetTokenExpiry: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
    },
  })

  return { staff, token }
}

/**
 * Reassigns an already-invited member to a different preset — the "change
 * role" counterpart to inviteStaff's preset resolution above (same
 * jobPreset -> presetRole -> isDefault fallback chain, so a business on an
 * older un-backfilled role set degrades the same honest way). Never edits
 * a BusinessRole's `permissions` JSON directly: that row is shared by every
 * staff member on that preset, so "change what Thabo can do" always means
 * "move Thabo to a different, already-scoped role," never mutating the
 * role itself.
 */
export async function updateStaffPreset(
  businessId: string,
  staffId: string,
  presetId: StaffPresetId,
  jobTitle?: string,
) {
  const staff = await prisma.businessStaff.findFirst({ where: { id: staffId, businessId } })
  if (!staff) throw new Error('Team member not found')
  if (staff.isOwner) throw new Error("Can't change the owner's role")

  const preset = STAFF_PRESETS[presetId]
  if (!preset) throw new Error('Unknown role')

  const role =
    (await prisma.businessRole.findFirst({ where: { businessId, jobPreset: preset.id } })) ??
    (preset.presetRole &&
      (await prisma.businessRole.findFirst({ where: { businessId, presetRole: preset.presetRole } }))) ??
    (await prisma.businessRole.findFirst({ where: { businessId, isDefault: true } }))

  return prisma.businessStaff.update({
    where: { id: staffId },
    data: {
      roleId: role?.id,
      staffRole: preset.presetRole ?? 'STAFF',
      jobTitle: jobTitle?.trim() || preset.jobTitle,
      primaryWorkspace: preset.workspace,
    },
  })
}

/**
 * Deactivating revokes every credential the person holds: the password
 * becomes unknowable and any unused invite / reset link stops working (and
 * requireStaff refuses their existing session on the next request).
 * Reactivating restores the account but NOT a way in — reactivateStaff
 * sends a fresh invite, so coming back is always a deliberate, new
 * credential.
 */
export async function setStaffActive(businessId: string, staffId: string, isActive: boolean) {
  const staff = await prisma.businessStaff.findFirst({ where: { id: staffId, businessId } })
  if (!staff) throw new Error('Team member not found')
  if (staff.isOwner) throw new Error("Can't deactivate the owner")
  if (isActive) return prisma.businessStaff.update({ where: { id: staffId }, data: { isActive: true } })
  const passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'))
  return prisma.businessStaff.update({
    where: { id: staffId },
    data: { isActive: false, passwordHash, resetToken: null, resetTokenExpiry: null },
  })
}

/** Reactivates a member and issues the fresh invite they need to set a new password. */
export async function reactivateStaff(businessId: string, staffId: string) {
  await setStaffActive(businessId, staffId, true)
  return reinviteStaff(businessId, staffId)
}

/**
 * Resends an invite: rotates the token so an old copy of the email (or one
 * intercepted in transit) stops working, same reasoning as password reset.
 */
export async function reinviteStaff(businessId: string, staffId: string) {
  const staff = await prisma.businessStaff.findFirst({ where: { id: staffId, businessId } })
  if (!staff) throw new Error('Team member not found')
  if (staff.isOwner) throw new Error("The owner doesn't use team invites")
  if (!staff.isActive) throw new Error(`Reactivate ${staff.firstName} first — that sends them a fresh invite.`)

  const token = crypto.randomBytes(32).toString('hex')
  await prisma.businessStaff.update({
    where: { id: staffId },
    data: { resetToken: hashToken(token), resetTokenExpiry: new Date(Date.now() + INVITE_TOKEN_TTL_MS) },
  })
  return { staff, token }
}

/** Completes an invite or a self-service password reset — same token field either way. */
export async function completeStaffSetPassword(token: string, password: string) {
  const staff = await prisma.businessStaff.findFirst({ where: { resetToken: hashToken(token) } })
  if (!staff || !staff.resetTokenExpiry || staff.resetTokenExpiry.getTime() < Date.now()) {
    throw new Error('That link has expired. Ask the business to resend your invite.')
  }
  // A link never turns an account back on: deactivation clears links, and
  // even a link that somehow survived can't be used by an inactive member.
  if (!staff.isActive || staff.isOwner) {
    throw new Error('That link has expired. Ask the business to resend your invite.')
  }

  const passwordHash = await hashPassword(password)
  // Claim the token in the same write, so one link sets one password.
  const claimed = await prisma.businessStaff.updateMany({
    where: { id: staff.id, resetToken: staff.resetToken, isActive: true },
    data: { passwordHash, resetToken: null, resetTokenExpiry: null },
  })
  if (claimed.count === 0) throw new Error('That link has expired. Ask the business to resend your invite.')
  return staff
}
