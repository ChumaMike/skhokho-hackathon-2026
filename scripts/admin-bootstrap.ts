/**
 * Break-glass / bootstrap for platform admins — run by an operator who
 * already has database credentials (that access IS the authorisation; there
 * is no web path to do this). Records a SYSTEM audit event every time.
 *
 *   npx tsx --env-file=.env.local scripts/admin-bootstrap.ts create-admin <email> "<reason>" --confirm
 *   npx tsx --env-file=.env.local scripts/admin-bootstrap.ts grant-super  <email> "<reason>" --confirm
 *   npx tsx --env-file=.env.local scripts/admin-bootstrap.ts reset-mfa    <email> "<reason>" --confirm
 *
 * create-admin  create the ADMIN app user for that email (no demo seed, no SQL). A strong
 *               one-time password is generated and printed ONCE; the person changes it
 *               after signing in and enrols MFA on first sign-in. They start as SUPPORT —
 *               run grant-super for the first (and any further) super admin.
 * grant-super   make an existing ADMIN app user a SUPER_ADMIN (first admin, or recovery
 *               when no super admin can sign in). Their sessions end.
 * reset-mfa     clear an admin's authenticator + recovery codes when NO other super admin
 *               can do it in the console. Their sessions end; they enrol on next sign-in.
 *
 * Check which database DATABASE/POSTGRES_* points at before running.
 */

import { randomBytes } from 'node:crypto'
import { prisma } from '../src/lib/prisma/client'
import { recordAudit } from '../src/modules/platform-admin/audit'
import { hashPassword } from '../src/modules/auth/auth.service'

const COMMANDS = ['create-admin', 'grant-super', 'reset-mfa'] as const
type Command = (typeof COMMANDS)[number]

const AUDIT_ACTION: Record<Command, string> = {
  'create-admin': 'admin_bootstrap_create_admin',
  'grant-super': 'admin_bootstrap_grant_super',
  'reset-mfa': 'admin_bootstrap_mfa_reset',
}

/** 24 characters from an unambiguous alphabet — long enough that it is only ever pasted, never typed from memory. */
function oneTimePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*'
  const bytes = randomBytes(24)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

async function main() {
  const [command, rawEmail, reason, confirm] = process.argv.slice(2)
  if (!COMMANDS.includes(command as Command) || !rawEmail || !reason || reason.trim().length < 5 || confirm !== '--confirm') {
    console.error('usage: admin-bootstrap.ts <create-admin|grant-super|reset-mfa> <email> "<reason (5+ chars)>" --confirm')
    process.exit(2)
  }
  const email = rawEmail.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('That is not an email address.')
    process.exit(2)
  }

  let adminId: string
  if (command === 'create-admin') {
    const existing = await prisma.appUser.findUnique({ where: { email }, select: { id: true } })
    if (existing) {
      console.error('An app user with that email already exists. Use grant-super / reset-mfa, or a different email.')
      process.exit(1)
    }
    const password = oneTimePassword()
    // Hash before the transaction (bcrypt takes a few hundred ms) and allow a cold
    // Neon compute its wake-up time: Prisma's default 5 s budget expired on a cold
    // database during rehearsal, leaving the rows committed but the password unprinted.
    const passwordHash = await hashPassword(password)
    const created = await prisma.$transaction(
      async (tx) => {
        const user = await tx.appUser.create({
          data: { email, role: 'ADMIN', passwordHash, emailVerifiedAt: new Date() },
          select: { id: true },
        })
        const admin = await tx.platformAdmin.create({ data: { userId: user.id }, select: { id: true } })
        return admin
      },
      { maxWait: 20_000, timeout: 30_000 },
    )
    adminId = created.id
    console.log(`created ADMIN app user ${email} (platform admin ${adminId}, role SUPPORT).`)
    console.log('One-time password (shown once, never stored in plain text — hand it over out of band and have it changed on first sign-in):')
    console.log(password)
  } else {
    const user = await prisma.appUser.findUnique({ where: { email }, select: { id: true, role: true, isActive: true } })
    if (!user || user.role !== 'ADMIN' || !user.isActive) {
      console.error('No active ADMIN app user with that email. (create-admin makes one.)')
      process.exit(1)
    }
    const admin = await prisma.platformAdmin.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id }, select: { id: true } })
    adminId = admin.id
    if (command === 'grant-super') {
      await prisma.platformAdmin.update({ where: { id: admin.id }, data: { role: 'SUPER_ADMIN', sessionEpoch: { increment: 1 } } })
    } else {
      await prisma.$transaction([
        prisma.platformAdmin.update({ where: { id: admin.id }, data: { mfaSecretCipher: null, mfaPendingCipher: null, mfaEnabledAt: null, mfaLastStep: null, sessionEpoch: { increment: 1 } } }),
        prisma.adminRecoveryCode.deleteMany({ where: { adminId: admin.id } }),
      ])
    }
  }

  await recordAudit(
    { category: 'SYSTEM', action: AUDIT_ACTION[command as Command], actor: { type: 'system', id: 'operator-script' }, resource: { type: 'platform_admin', id: adminId }, reason },
    { strict: true },
  )
  console.log(`done: ${command} for admin ${adminId}`)
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
