/**
 * Skhokholetha drivers — onboarding, verification, availability, location.
 *
 * Two separate dimensions, never mixed:
 *   verificationStatus  DRAFT → PENDING_REVIEW → APPROVED | REJECTED, and SUSPENDED
 *   availability        OFFLINE | ONLINE | BUSY | PAUSED
 *
 * Invariant (enforced here, server-side, on every path): only an APPROVED,
 * eligible driver can be ONLINE or receive offers. The client never sets
 * availability directly — it asks to go online/offline and the server decides.
 */

import { createHash, randomBytes } from 'node:crypto'
import type { DriverDocumentKind, DriverProfile, DriverVehicle, DriverDocument, Prisma, VehicleType } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/lib/prisma/client'
import { TX_OPTIONS } from './tx'
import { hashPassword, hashToken } from '@/modules/auth/auth.service'
import { encryptSecret } from '@/lib/crypto/secret-box'
import { normalizeSAPhone } from '@/lib/utils'
import { DRIVER_ACTIVE_STATUSES } from './state-machine'
import { isValidLatLng } from './pricing'
import { requireLetha } from './flags'
import { acceptedCurrentLegal, driverLegalConfig, type DriverLegalConfig } from './legal'

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
export const EMAIL_VERIFY_TTL_MS = 48 * 60 * 60 * 1000
const MOTORISED: readonly VehicleType[] = ['SCOOTER', 'MOTORCYCLE', 'CAR', 'BAKKIE']

export class DriverError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DriverError'
  }
}

// ---------------------------------------------------------------------------
// Eligibility (pure)
// ---------------------------------------------------------------------------

export function requiredDocuments(vehicleType: VehicleType | null): DriverDocumentKind[] {
  if (!vehicleType) return ['ID_DOCUMENT']
  return MOTORISED.includes(vehicleType) ? ['ID_DOCUMENT', 'DRIVERS_LICENCE', 'VEHICLE_REGISTRATION'] : ['ID_DOCUMENT']
}

type DocLite = Pick<DriverDocument, 'kind' | 'status' | 'expiresOn'>

/** The latest document of each kind (newest upload wins). */
function latestByKind(documents: (DocLite & { uploadedAt: Date })[]): Map<DriverDocumentKind, DocLite> {
  const map = new Map<DriverDocumentKind, DocLite & { uploadedAt: Date }>()
  for (const d of documents) {
    const prev = map.get(d.kind)
    if (!prev || d.uploadedAt > prev.uploadedAt) map.set(d.kind, d)
  }
  return map
}

export interface ApplicationReadiness {
  ready: boolean
  missing: string[]
}

/** What a DRAFT application still needs before it can be submitted. */
type LegalFields = Pick<DriverProfile, 'agreementAcceptedAt' | 'agreementVersion' | 'privacyAcceptedAt' | 'privacyVersion'>

export function applicationReadiness(
  profile: Pick<DriverProfile, 'displayName' | 'phone' | 'payoutAccountCipher'> & LegalFields,
  emailVerified: boolean,
  vehicles: Pick<DriverVehicle, 'type' | 'isActive'>[],
  documents: (DocLite & { uploadedAt: Date })[],
  legal: DriverLegalConfig = driverLegalConfig(),
): ApplicationReadiness {
  const missing: string[] = []
  if (!emailVerified) missing.push('Confirm your email address')
  if (!profile.displayName?.trim()) missing.push('Your name')
  if (!profile.phone) missing.push('Your cellphone number')
  const vehicle = vehicles.find((v) => v.isActive)
  if (!vehicle) missing.push('Your vehicle')
  const latest = latestByKind(documents)
  for (const kind of requiredDocuments(vehicle?.type ?? null)) {
    const doc = latest.get(kind)
    if (!doc || doc.status === 'REJECTED') missing.push(`Upload: ${DOCUMENT_LABELS[kind]}`)
  }
  if (!profile.payoutAccountCipher) missing.push('Your payout bank account')
  if (!legal.ok) missing.push('Driver terms and privacy notice are not published yet')
  else if (!acceptedCurrentLegal(profile, legal)) missing.push('Accept the driver terms and privacy notice')
  return { ready: missing.length === 0, missing }
}

export const DOCUMENT_LABELS: Record<DriverDocumentKind, string> = {
  ID_DOCUMENT: 'ID document',
  DRIVERS_LICENCE: "Driver's licence",
  VEHICLE_REGISTRATION: 'Vehicle registration',
}

export interface OperatingEligibility {
  eligible: boolean
  reasons: string[]
}

/**
 * Whether a driver may work (go ONLINE / receive offers / accept) right now.
 * Re-checked on every one of those actions — approval alone isn't enough
 * if a document has since expired or the vehicle was removed.
 */
export function operatingEligibility(
  profile: Pick<DriverProfile, 'verificationStatus' | 'locationConsentAt'> & LegalFields,
  vehicles: Pick<DriverVehicle, 'type' | 'isActive'>[],
  documents: (DocLite & { uploadedAt: Date })[],
  now: Date = new Date(),
  legal: DriverLegalConfig = driverLegalConfig(),
): OperatingEligibility {
  const reasons: string[] = []
  if (profile.verificationStatus !== 'APPROVED') reasons.push(`Your driver account is ${profile.verificationStatus.toLowerCase().replace('_', ' ')}`)
  const vehicle = vehicles.find((v) => v.isActive)
  if (!vehicle) reasons.push('No active vehicle')
  const latest = latestByKind(documents)
  for (const kind of requiredDocuments(vehicle?.type ?? null)) {
    const doc = latest.get(kind)
    if (!doc || doc.status !== 'ACCEPTED') reasons.push(`${DOCUMENT_LABELS[kind]} not verified`)
    else if (doc.expiresOn && doc.expiresOn < now) reasons.push(`${DOCUMENT_LABELS[kind]} has expired`)
  }
  if (!profile.locationConsentAt) reasons.push('Location sharing not allowed yet')
  // A newly published terms/privacy version must be accepted before working again.
  if (!acceptedCurrentLegal(profile, legal)) reasons.push('Accept the current driver terms and privacy notice')
  return { eligible: reasons.length === 0, reasons }
}

async function loadForEligibility(driverId: string, tx: Prisma.TransactionClient = prisma) {
  return tx.driverProfile.findUniqueOrThrow({
    where: { id: driverId },
    include: {
      vehicles: { select: { type: true, isActive: true } },
      documents: { select: { kind: true, status: true, expiresOn: true, uploadedAt: true } },
      user: { select: { emailVerifiedAt: true, isActive: true } },
    },
  })
}

export async function getOperatingEligibility(driverId: string, now: Date = new Date()) {
  const d = await loadForEligibility(driverId)
  return operatingEligibility(d, d.vehicles, d.documents, now)
}

// ---------------------------------------------------------------------------
// Sign-up and contact verification
// ---------------------------------------------------------------------------

export const DriverSignupSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    email: z.string().trim().toLowerCase().email().max(254),
    phone: z.string().trim().min(10).max(20),
    password: z.string().min(8).max(200),
  })
  .strict()

function newEmailVerifyToken(now: Date) {
  const token = randomBytes(32).toString('hex')
  return { token, hash: hashToken(token), expiresAt: new Date(now.getTime() + EMAIL_VERIFY_TTL_MS) }
}

/** A brand-new person signing up to drive: one AppUser + one DRAFT profile. */
export async function signUpDriver(raw: unknown, now: Date = new Date()) {
  requireLetha('driverSignup')
  const input = DriverSignupSchema.parse(raw)
  const phone = normalizeSAPhone(input.phone)
  if (!phone) throw new DriverError('Enter a South African cellphone number, like 082 123 4567.')
  if (await prisma.appUser.findUnique({ where: { email: input.email }, select: { id: true } })) {
    // Same message either way would be better for enumeration, but an existing
    // Skhokho user is told to sign in and become a driver from their account.
    throw new DriverError('That email already has a Skhokho account — sign in to add driving to it.')
  }
  const passwordHash = await hashPassword(input.password)
  const verify = newEmailVerifyToken(now)
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.appUser.create({ data: { email: input.email, passwordHash, role: 'DRIVER' }, select: { id: true, email: true } })
    const driver = await tx.driverProfile.create({
      data: {
        userId: user.id,
        displayName: `${input.firstName} ${input.lastName}`,
        phone,
        emailVerifyTokenHash: verify.hash,
        emailVerifyExpiresAt: verify.expiresAt,
      },
      select: { id: true },
    })
    return { user, driver }
  }, TX_OPTIONS)
  return { userId: result.user.id, driverId: result.driver.id, email: result.user.email, verifyToken: verify.token }
}

/** An existing Skhokho user (e.g. a business owner) adds driving to their account. */
export async function becomeDriver(userId: string, raw: { displayName: string; phone: string }) {
  requireLetha('driverSignup')
  const user = await prisma.appUser.findUniqueOrThrow({ where: { id: userId }, select: { id: true, isActive: true, emailVerifiedAt: true } })
  if (!user.isActive) throw new DriverError('This account is not active.')
  const phone = normalizeSAPhone(raw.phone)
  if (!phone) throw new DriverError('Enter a South African cellphone number, like 082 123 4567.')
  const existing = await prisma.driverProfile.findUnique({ where: { userId }, select: { id: true } })
  if (existing) return existing.id
  const created = await prisma.driverProfile.create({
    data: { userId, displayName: raw.displayName.trim().slice(0, 120), phone },
    select: { id: true },
  })
  return created.id
}

export async function verifyDriverEmail(token: string, now: Date = new Date()): Promise<boolean> {
  if (!token) return false
  const driver = await prisma.driverProfile.findFirst({ where: { emailVerifyTokenHash: hashToken(token) }, select: { id: true, userId: true, emailVerifyExpiresAt: true } })
  if (!driver || !driver.emailVerifyExpiresAt || driver.emailVerifyExpiresAt < now) return false
  await prisma.$transaction([
    prisma.appUser.update({ where: { id: driver.userId }, data: { emailVerifiedAt: now } }),
    prisma.driverProfile.update({ where: { id: driver.id }, data: { emailVerifyTokenHash: null, emailVerifyExpiresAt: null } }),
  ])
  return true
}

export async function reissueEmailVerification(driverId: string, now: Date = new Date()) {
  const verify = newEmailVerifyToken(now)
  await prisma.driverProfile.update({ where: { id: driverId }, data: { emailVerifyTokenHash: verify.hash, emailVerifyExpiresAt: verify.expiresAt } })
  return verify.token
}

// ---------------------------------------------------------------------------
// Application steps (DRAFT or REJECTED only — an application under review or
// approved can't be quietly changed underneath the reviewer)
// ---------------------------------------------------------------------------

async function editableDriver(driverId: string) {
  const d = await prisma.driverProfile.findUniqueOrThrow({ where: { id: driverId }, select: { id: true, verificationStatus: true } })
  if (d.verificationStatus !== 'DRAFT' && d.verificationStatus !== 'REJECTED') {
    throw new DriverError('Your application is with our team — it can’t be changed right now.')
  }
  return d
}

export const DriverProfileSchema = z.object({ displayName: z.string().trim().min(2).max(120), phone: z.string().trim().min(10).max(20) }).strict()

export async function updateDriverProfile(driverId: string, raw: unknown) {
  await editableDriver(driverId)
  const input = DriverProfileSchema.parse(raw)
  const phone = normalizeSAPhone(input.phone)
  if (!phone) throw new DriverError('Enter a South African cellphone number, like 082 123 4567.')
  await prisma.driverProfile.update({ where: { id: driverId }, data: { displayName: input.displayName, phone } })
}

export const DriverVehicleSchema = z
  .object({
    type: z.enum(['BICYCLE', 'SCOOTER', 'MOTORCYCLE', 'CAR', 'BAKKIE']),
    registration: z.string().trim().max(20).optional(),
    makeModel: z.string().trim().max(80).optional(),
  })
  .strict()

/** Sets the driver's one active vehicle (the previous one is retired, not deleted). */
export async function setDriverVehicle(driverId: string, raw: unknown) {
  await editableDriver(driverId)
  const input = DriverVehicleSchema.parse(raw)
  if (MOTORISED.includes(input.type) && !input.registration) throw new DriverError('Enter the vehicle registration number.')
  await prisma.$transaction([
    prisma.driverVehicle.updateMany({ where: { driverId, isActive: true }, data: { isActive: false } }),
    prisma.driverVehicle.create({
      data: { driverId, type: input.type, registration: input.registration?.toUpperCase() || null, makeModel: input.makeModel || null },
    }),
  ])
}

export const DriverPayoutSchema = z
  .object({
    bankName: z.string().trim().min(2).max(60),
    accountHolder: z.string().trim().min(2).max(120),
    branchCode: z.string().trim().regex(/^\d{6}$/, 'Branch code is 6 digits'),
    accountNumber: z.string().trim().regex(/^\d{6,16}$/, 'Account number is 6 to 16 digits'),
  })
  .strict()

/** Bank details: the account number is sealed at rest; only its last 4 digits stay readable. */
export async function setDriverPayout(driverId: string, raw: unknown) {
  await editableDriver(driverId)
  const input = DriverPayoutSchema.parse(raw)
  const sealed = encryptSecret(input.accountNumber)
  await prisma.driverProfile.update({
    where: { id: driverId },
    data: {
      payoutBankName: input.bankName,
      payoutAccountHolder: input.accountHolder,
      payoutBranchCode: input.branchCode,
      payoutAccountCipher: sealed.payload,
      payoutAccountLast4: input.accountNumber.slice(-4),
    },
  })
}

/**
 * Records acceptance of the CURRENTLY configured terms and privacy notice.
 * The versions the driver was shown must match what's configured right now —
 * an acceptance is never stored for a version that doesn't exist. Not limited
 * to DRAFT: an approved driver re-accepts here when a new version is published.
 */
export async function acceptDriverLegal(
  driverId: string,
  seen: { termsVersion: string; privacyVersion: string },
  audit: { ip?: string | null; userAgent?: string | null } = {},
  now: Date = new Date(),
) {
  const legal = driverLegalConfig()
  if (!legal.ok) throw new DriverError('The driver terms and privacy notice are not published yet, so they can’t be accepted.')
  if (seen.termsVersion !== legal.terms.version || seen.privacyVersion !== legal.privacy.version) {
    throw new DriverError('The terms changed while you were reading — please read the current versions and accept again.')
  }
  const ipHash = audit.ip ? createHash('sha256').update(`driver-legal:${audit.ip}`).digest('hex') : null
  const userAgent = audit.userAgent?.slice(0, 300) ?? null
  await prisma.$transaction(async (tx) => {
    const d = await tx.driverProfile.findUniqueOrThrow({ where: { id: driverId }, select: { verificationStatus: true } })
    if (d.verificationStatus === 'SUSPENDED') throw new DriverError('Your driver account is on hold.')
    for (const doc of [legal.terms, legal.privacy]) {
      await tx.driverLegalAcceptance.upsert({
        where: { driverId_kind_version: { driverId, kind: doc.kind, version: doc.version } },
        update: {},
        create: { driverId, kind: doc.kind, version: doc.version, documentUrl: doc.url, acceptedAt: now, ipHash, userAgent },
      })
    }
    await tx.driverProfile.update({
      where: { id: driverId },
      data: { agreementVersion: legal.terms.version, agreementAcceptedAt: now, privacyVersion: legal.privacy.version, privacyAcceptedAt: now },
    })
  }, { timeout: 15_000, maxWait: 10_000 })
}

// --- documents --------------------------------------------------------------

const ALLOWED_TYPES: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
}

/** A display-safe file name: no paths, no control characters, bounded length. */
export function safeFileName(raw: string, contentType: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? '').replace(/[^A-Za-z0-9._ -]/g, '').replace(/\.{2,}/g, '.').trim().slice(0, 80)
  const ext = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[contentType] ?? ''
  const stem = base.replace(/\.[A-Za-z0-9]+$/, '') || 'document'
  return `${stem}${ext}`
}

export async function uploadDriverDocument(
  driverId: string,
  input: { kind: string; fileName: string; contentType: string; bytes: Buffer; expiresOn?: string | null },
) {
  await editableDriver(driverId)
  const kind = z.enum(['ID_DOCUMENT', 'DRIVERS_LICENCE', 'VEHICLE_REGISTRATION']).parse(input.kind)
  const check = ALLOWED_TYPES[input.contentType]
  if (!check) throw new DriverError('Upload a PDF, JPG, PNG or WEBP file.')
  if (input.bytes.length === 0) throw new DriverError('That file is empty.')
  if (input.bytes.length > MAX_DOCUMENT_BYTES) throw new DriverError('Files must be 5 MB or smaller.')
  if (!check(input.bytes)) throw new DriverError("That file isn't really the type it says it is.")
  let expiresOn: Date | null = null
  if (input.expiresOn) {
    const d = new Date(`${input.expiresOn}T00:00:00Z`)
    if (Number.isNaN(d.getTime())) throw new DriverError('Enter a valid expiry date.')
    expiresOn = d
  }
  const doc = await prisma.driverDocument.create({
    data: {
      driverId,
      kind,
      fileName: safeFileName(input.fileName, input.contentType),
      contentType: input.contentType,
      sizeBytes: input.bytes.length,
      sha256: createHash('sha256').update(input.bytes).digest('hex'),
      content: new Uint8Array(input.bytes),
      expiresOn,
    },
    select: { id: true, kind: true, fileName: true, sizeBytes: true, status: true, uploadedAt: true },
  })
  return doc
}

/** The driver's own view of their documents — metadata only, never the bytes. */
export async function listOwnDocuments(driverId: string) {
  return prisma.driverDocument.findMany({
    where: { driverId },
    orderBy: { uploadedAt: 'desc' },
    select: { id: true, kind: true, fileName: true, sizeBytes: true, status: true, expiresOn: true, uploadedAt: true, reviewNote: true },
  })
}

// --- submit -------------------------------------------------------------------

export async function submitDriverApplication(driverId: string, now: Date = new Date()) {
  requireLetha('driverSignup')
  await editableDriver(driverId)
  const d = await loadForEligibility(driverId)
  const readiness = applicationReadiness(d, Boolean(d.user.emailVerifiedAt), d.vehicles, d.documents)
  if (!readiness.ready) throw new DriverError(`Still needed: ${readiness.missing.join('; ')}.`)
  const updated = await prisma.driverProfile.updateMany({
    where: { id: driverId, verificationStatus: { in: ['DRAFT', 'REJECTED'] } },
    data: { verificationStatus: 'PENDING_REVIEW', submittedAt: now, reviewNote: null },
  })
  if (updated.count === 0) throw new DriverError('Your application has already been submitted.')
}

// ---------------------------------------------------------------------------
// Admin review (platform admins only — callers check requireSuperAdmin)
// ---------------------------------------------------------------------------

export async function listDriverApplications(status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'DRAFT' = 'PENDING_REVIEW') {
  return prisma.driverProfile.findMany({
    where: { verificationStatus: status },
    orderBy: { submittedAt: 'asc' },
    select: {
      id: true,
      displayName: true,
      verificationStatus: true,
      availability: true,
      submittedAt: true,
      reviewedAt: true,
      vehicles: { where: { isActive: true }, select: { type: true, registration: true } },
    },
  })
}

/** Admin view of one application. Bank account: last 4 digits only. Documents: metadata (bytes via the download route). */
export async function getDriverApplication(driverId: string) {
  return prisma.driverProfile.findUnique({
    where: { id: driverId },
    select: {
      id: true,
      displayName: true,
      phone: true,
      verificationStatus: true,
      availability: true,
      submittedAt: true,
      reviewedAt: true,
      reviewNote: true,
      suspendedAt: true,
      suspensionReason: true,
      payoutBankName: true,
      payoutAccountHolder: true,
      payoutBranchCode: true,
      payoutAccountLast4: true,
      agreementVersion: true,
      agreementAcceptedAt: true,
      user: { select: { email: true, emailVerifiedAt: true } },
      vehicles: { orderBy: { createdAt: 'desc' }, select: { id: true, type: true, registration: true, makeModel: true, isActive: true } },
      documents: {
        orderBy: { uploadedAt: 'desc' },
        select: { id: true, kind: true, fileName: true, contentType: true, sizeBytes: true, status: true, expiresOn: true, uploadedAt: true, reviewNote: true },
      },
    },
  })
}

export async function reviewDriverDocument(adminId: string, documentId: string, decision: 'ACCEPTED' | 'REJECTED', note?: string, now: Date = new Date()) {
  await prisma.driverDocument.update({
    where: { id: documentId },
    data: { status: decision, reviewedAt: now, reviewedBy: adminId, reviewNote: note?.slice(0, 300) ?? null },
  })
}

/** Approval needs the switch on, published legal documents, and the driver's acceptance of the current versions. */
function requireApprovalGate(d: LegalFields) {
  requireLetha('driverApprovals')
  const legal = driverLegalConfig()
  if (!legal.ok) throw new DriverError(`Driver approvals are blocked until the driver terms and privacy notice are configured (${legal.missing.join(', ')}).`)
  if (!acceptedCurrentLegal(d, legal)) throw new DriverError('The driver hasn’t accepted the current terms and privacy notice.')
}

export async function approveDriver(adminId: string, driverId: string, now: Date = new Date()) {
  const d = await loadForEligibility(driverId)
  if (d.verificationStatus !== 'PENDING_REVIEW') throw new DriverError('Only a submitted application can be approved.')
  requireApprovalGate(d)
  const latest = latestByKind(d.documents)
  const vehicle = d.vehicles.find((v) => v.isActive)
  const unverified = requiredDocuments(vehicle?.type ?? null).filter((k) => latest.get(k)?.status !== 'ACCEPTED')
  if (unverified.length) throw new DriverError(`Accept these documents first: ${unverified.map((k) => DOCUMENT_LABELS[k]).join(', ')}.`)
  const updated = await prisma.driverProfile.updateMany({
    where: { id: driverId, verificationStatus: 'PENDING_REVIEW' },
    data: { verificationStatus: 'APPROVED', reviewedAt: now, reviewedBy: adminId, reviewNote: null },
  })
  if (updated.count === 0) throw new DriverError('This application changed — reload and try again.')
}

export async function rejectDriver(adminId: string, driverId: string, note: string, now: Date = new Date()) {
  if (!note.trim()) throw new DriverError('Tell the driver what to fix.')
  const updated = await prisma.driverProfile.updateMany({
    where: { id: driverId, verificationStatus: 'PENDING_REVIEW' },
    data: { verificationStatus: 'REJECTED', reviewedAt: now, reviewedBy: adminId, reviewNote: note.slice(0, 500) },
  })
  if (updated.count === 0) throw new DriverError('Only a submitted application can be rejected.')
}

/** Suspension takes effect immediately: the driver goes OFFLINE and their pending offers are withdrawn. */
export async function suspendDriver(adminId: string, driverId: string, reason: string, now: Date = new Date()) {
  if (!reason.trim()) throw new DriverError('Give a reason for the suspension.')
  await prisma.$transaction(async (tx) => {
    const updated = await tx.driverProfile.updateMany({
      where: { id: driverId, verificationStatus: { in: ['APPROVED', 'PENDING_REVIEW'] } },
      data: { verificationStatus: 'SUSPENDED', suspendedAt: now, suspensionReason: reason.slice(0, 500), reviewedBy: adminId, availability: 'OFFLINE', lastLat: null, lastLng: null, lastLocationAt: null },
    })
    if (updated.count === 0) throw new DriverError('Only an approved or pending driver can be suspended.')
    await tx.deliveryOffer.updateMany({ where: { driverId, status: 'PENDING' }, data: { status: 'WITHDRAWN', respondedAt: now } })
  }, TX_OPTIONS)
}

export async function reinstateDriver(adminId: string, driverId: string, now: Date = new Date()) {
  requireApprovalGate(await loadForEligibility(driverId))
  const updated = await prisma.driverProfile.updateMany({
    where: { id: driverId, verificationStatus: 'SUSPENDED' },
    data: { verificationStatus: 'APPROVED', suspendedAt: null, suspensionReason: null, reviewedAt: now, reviewedBy: adminId },
  })
  if (updated.count === 0) throw new DriverError('Only a suspended driver can be reinstated.')
}

// ---------------------------------------------------------------------------
// Availability — the server decides
// ---------------------------------------------------------------------------

export async function grantLocationConsent(driverId: string, now: Date = new Date()) {
  await prisma.driverProfile.update({ where: { id: driverId }, data: { locationConsentAt: now } })
}

/** Withdrawing consent also takes the driver offline and forgets their position. */
export async function withdrawLocationConsent(driverId: string) {
  const active = await prisma.networkDelivery.count({ where: { driverId, status: { in: [...DRIVER_ACTIVE_STATUSES] } } })
  if (active > 0) throw new DriverError('Finish your current delivery first.')
  await prisma.driverProfile.update({
    where: { id: driverId },
    data: { locationConsentAt: null, availability: 'OFFLINE', lastLat: null, lastLng: null, lastLocationAt: null },
  })
}

/**
 * A request to go online or offline. Online only if every eligibility rule
 * passes NOW; never while holding a delivery (the system manages BUSY).
 */
export async function requestAvailability(driverId: string, wantOnline: boolean, now: Date = new Date()): Promise<{ availability: string }> {
  const d = await loadForEligibility(driverId)
  if (!d.user.isActive) throw new DriverError('This account is not active.')
  const active = await prisma.networkDelivery.count({ where: { driverId, status: { in: [...DRIVER_ACTIVE_STATUSES] } } })
  if (active > 0) throw new DriverError('You have a delivery in progress — finish it first.')

  if (wantOnline) requireLetha('network')
  if (!wantOnline) {
    await prisma.driverProfile.update({ where: { id: driverId }, data: { availability: 'OFFLINE', lastLat: null, lastLng: null, lastLocationAt: null } })
    await prisma.deliveryOffer.updateMany({ where: { driverId, status: 'PENDING' }, data: { status: 'WITHDRAWN', respondedAt: now } })
    return { availability: 'OFFLINE' }
  }

  const eligibility = operatingEligibility(d, d.vehicles, d.documents, now)
  if (!eligibility.eligible) throw new DriverError(`You can't go online yet: ${eligibility.reasons.join('; ')}.`)
  // Conditional: never flips a SUSPENDED/BUSY driver online in a race.
  const updated = await prisma.driverProfile.updateMany({
    where: { id: driverId, verificationStatus: 'APPROVED', availability: { in: ['OFFLINE', 'PAUSED', 'ONLINE'] } },
    data: { availability: 'ONLINE' },
  })
  if (updated.count === 0) throw new DriverError("You can't go online right now.")
  return { availability: 'ONLINE' }
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

/** How often each mode accepts a position (the app is told the same). */
export const LOCATION_INTERVAL_SECONDS = { waiting: 180, active: 20 } as const
/** A position older than this is ignored for dispatch. */
export const STALE_LOCATION_MS = 10 * 60 * 1000

export const LocationSchema = z
  .object({ lat: z.number(), lng: z.number(), accuracyM: z.number().min(0).max(10_000).optional() })
  .strict()

/**
 * Records a driver's position. Only while ONLINE/BUSY with consent — an
 * OFFLINE driver's position is never stored. Waiting: the latest coarse
 * position on the profile (rounded to ~100 m) for dispatch. Active delivery:
 * also the latest exact position on that delivery (cleared when it ends).
 * No history is kept anywhere.
 */
export async function recordDriverPosition(driverId: string, raw: unknown, now: Date = new Date()) {
  const input = LocationSchema.parse(raw)
  if (!isValidLatLng(input)) throw new DriverError('That location is not valid.')
  const d = await prisma.driverProfile.findUniqueOrThrow({ where: { id: driverId }, select: { availability: true, locationConsentAt: true, verificationStatus: true } })
  if (!d.locationConsentAt) throw new DriverError('Allow location sharing first.')
  if (d.verificationStatus !== 'APPROVED' || (d.availability !== 'ONLINE' && d.availability !== 'BUSY')) {
    return { stored: false as const, nextInSeconds: null }
  }
  const coarse = (v: number) => Math.round(v * 1000) / 1000
  await prisma.driverProfile.update({ where: { id: driverId }, data: { lastLat: coarse(input.lat), lastLng: coarse(input.lng), lastLocationAt: now } })
  const active = await prisma.networkDelivery.updateMany({
    where: { driverId, status: { in: [...DRIVER_ACTIVE_STATUSES] } },
    data: { driverLat: input.lat, driverLng: input.lng, driverLocationAt: now },
  })
  return { stored: true as const, nextInSeconds: active.count > 0 ? LOCATION_INTERVAL_SECONDS.active : LOCATION_INTERVAL_SECONDS.waiting }
}
