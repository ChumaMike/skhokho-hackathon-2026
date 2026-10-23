import { z } from 'zod'
import type { PaymentEnvironment, PaymentConnectionStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { encryptSecret, decryptSecret } from '@/lib/crypto/secret-box'
import type { PayfastCredentials } from '@/lib/payfast'

/**
 * A business's own payment-provider account.
 *
 * Every function takes `businessId` first and scopes every query by it — the
 * same discipline as the rest of modules/. There is deliberately no
 * "find connection by id" that isn't also filtered by business: the whole
 * point of merchant-direct settlement is that one business can never reach
 * another's receiving account.
 *
 * Secrets leave this module in exactly one shape — a PayfastCredentials
 * object handed to a signing or verification call — and never in a view
 * model, a log line, an error message or a server action's return value.
 */

/* ---------------------------------------------------------------------------
 * Input validation
 * ------------------------------------------------------------------------ */

/**
 * PayFast's own integration guides warn specifically about stray whitespace
 * when merchants copy these out of their dashboard, and a trailing space
 * produces a "signature mismatch" that looks like a code fault rather than a
 * typo. Trimmed before validation, not after.
 */
const trimmed = z.string().transform((v) => v.trim())

export const SaveConnectionSchema = z
  .object({
    environment: z.enum(['SANDBOX', 'LIVE']),
    merchantId: trimmed.pipe(
      z
        .string()
        .regex(/^\d{5,20}$/, 'Merchant ID should be the number from your PayFast account, digits only.'),
    ),
    merchantKey: trimmed.pipe(
      z
        .string()
        .regex(/^[A-Za-z0-9]{8,64}$/, 'Merchant Key should be the letters-and-numbers value from your PayFast account.'),
    ),
    // Optional in the shape because sandbox accounts may not have one; the
    // refine below makes it mandatory for LIVE, mirroring the database CHECK.
    passphrase: trimmed.optional(),
  })
  .refine((v) => v.environment !== 'LIVE' || (v.passphrase?.length ?? 0) >= 8, {
    path: ['passphrase'],
    message:
      'A security passphrase is required for a live account — set one in PayFast under Settings, then enter it here.',
  })

export type SaveConnectionInput = z.infer<typeof SaveConnectionSchema>

/* ---------------------------------------------------------------------------
 * View models — safe to render, safe to return from a server action
 * ------------------------------------------------------------------------ */

export interface ConnectionView {
  id: string
  environment: PaymentEnvironment
  status: PaymentConnectionStatus
  /** Partial, e.g. `••••0100`. Enough to recognise, not enough to reuse. */
  merchantIdMasked: string
  hasPassphrase: boolean
  verifiedAt: Date | null
  lastError: string | null
  updatedAt: Date
}

/**
 * Shows the last four characters only. The merchant ID is not itself a
 * secret, but displaying it in full invites an owner to screenshot a support
 * request containing their whole account identity, and recognising which
 * account is connected needs far less than that.
 */
function maskMerchantId(merchantId: string): string {
  const tail = merchantId.slice(-4)
  return `${'•'.repeat(Math.max(0, merchantId.length - 4))}${tail}`
}

function toView(row: {
  id: string
  environment: PaymentEnvironment
  status: PaymentConnectionStatus
  merchantId: string
  passphraseCipher: string | null
  verifiedAt: Date | null
  lastError: string | null
  updatedAt: Date
}): ConnectionView {
  return {
    id: row.id,
    environment: row.environment,
    status: row.status,
    merchantIdMasked: maskMerchantId(row.merchantId),
    // Whether one exists, never what it is. A stored passphrase is never
    // rendered back, not even masked.
    hasPassphrase: row.passphraseCipher !== null,
    verifiedAt: row.verifiedAt,
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  }
}

const VIEW_SELECT = {
  id: true,
  environment: true,
  status: true,
  merchantId: true,
  passphraseCipher: true,
  verifiedAt: true,
  lastError: true,
  updatedAt: true,
} as const

/* ---------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------ */

/** Every active (non-retired) connection this business holds. */
export async function listConnections(businessId: string): Promise<ConnectionView[]> {
  const rows = await prisma.businessPaymentConnection.findMany({
    where: { businessId, provider: 'PAYFAST', retiredAt: null },
    select: VIEW_SELECT,
    orderBy: { environment: 'asc' },
  })
  return rows.map(toView)
}

export async function getConnection(
  businessId: string,
  environment: PaymentEnvironment,
): Promise<ConnectionView | null> {
  const row = await prisma.businessPaymentConnection.findFirst({
    where: { businessId, provider: 'PAYFAST', environment, retiredAt: null },
    select: VIEW_SELECT,
  })
  return row ? toView(row) : null
}

/**
 * The connection a checkout would actually settle to, or null.
 *
 * Resolved from the business, never from anything a customer submitted.
 * Returns the row rather than a view because `resolveCheckoutPayment` needs
 * the real status and environment to decide — still no secrets.
 */
export async function getReceivingConnection(
  businessId: string,
): Promise<{ id: string; status: PaymentConnectionStatus; environment: PaymentEnvironment } | null> {
  return prisma.businessPaymentConnection.findFirst({
    where: { businessId, provider: 'PAYFAST', environment: 'LIVE', retiredAt: null },
    select: { id: true, status: true, environment: true },
  })
}

/* ---------------------------------------------------------------------------
 * Writes
 * ------------------------------------------------------------------------ */

/**
 * Saves credentials for one environment, retiring whatever was there.
 *
 * Rotation is never an in-place overwrite: the previous row is marked
 * SUPERSEDED and kept, because a notification for a payment already in flight
 * must still be verifiable against the credentials it was submitted under.
 * Overwriting would silently break exactly those payments — the ones where
 * money has already left a customer's account.
 *
 * Always lands as PENDING_VERIFICATION. Saving credentials is not evidence
 * that the account can receive money.
 */
export async function saveConnection(
  businessId: string,
  input: SaveConnectionInput,
): Promise<ConnectionView> {
  const validated = SaveConnectionSchema.parse(input)

  const merchantKey = encryptSecret(validated.merchantKey)
  const passphrase = validated.passphrase ? encryptSecret(validated.passphrase) : null

  return prisma.$transaction(
    async (tx) => {
    await tx.businessPaymentConnection.updateMany({
      where: { businessId, provider: 'PAYFAST', environment: validated.environment, retiredAt: null },
      data: { status: 'SUPERSEDED', retiredAt: new Date() },
    })

    const row = await tx.businessPaymentConnection.create({
      data: {
        businessId,
        provider: 'PAYFAST',
        environment: validated.environment,
        merchantId: validated.merchantId,
        merchantKeyCipher: merchantKey.payload,
        passphraseCipher: passphrase?.payload ?? null,
        keyVersion: merchantKey.keyVersion,
        status: 'PENDING_VERIFICATION',
      },
      select: VIEW_SELECT,
    })
      return toView(row)
    },
    { timeout: 15_000, maxWait: 10_000 },
  )
}

/**
 * Turns a connection off without discarding it. The owner keeps their
 * credentials; checkout simply stops offering card. Re-enabling returns it to
 * whatever it had proven before, so disabling is not a way to lose a
 * verification.
 */
export async function setConnectionEnabled(
  businessId: string,
  environment: PaymentEnvironment,
  enabled: boolean,
): Promise<void> {
  const current = await prisma.businessPaymentConnection.findFirst({
    where: { businessId, provider: 'PAYFAST', environment, retiredAt: null },
    select: { id: true, status: true, verifiedAt: true },
  })
  if (!current) throw new Error('There is no payment connection to change.')

  const next: PaymentConnectionStatus = enabled
    ? current.verifiedAt
      ? 'VERIFIED'
      : 'PENDING_VERIFICATION'
    : 'DISABLED'

  await prisma.businessPaymentConnection.update({
    where: { id: current.id },
    data: { status: next },
  })
}

/**
 * Disconnects. A state change and never a delete — the row carries the
 * receiving identity for every payment made through it, which is the
 * reconciliation and dispute record.
 */
export async function disconnect(businessId: string, environment: PaymentEnvironment): Promise<void> {
  await prisma.businessPaymentConnection.updateMany({
    where: { businessId, provider: 'PAYFAST', environment, retiredAt: null },
    data: { status: 'SUPERSEDED', retiredAt: new Date() },
  })
}

/**
 * Promotes a connection to VERIFIED on the strength of one specific completed
 * attempt, recorded so "verified" is always traceable to an event rather than
 * to someone having pressed a button.
 */
export async function markConnectionVerified(connectionId: string, attemptId: string): Promise<boolean> {
  // Only a live (non-retired) connection can become VERIFIED: a verification
  // payment that lands after the owner rotated or disconnected proves an
  // account nobody is using any more, and must not resurrect it.
  const updated = await prisma.businessPaymentConnection.updateMany({
    where: { id: connectionId, retiredAt: null },
    data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedByAttemptId: attemptId, lastError: null },
  })
  return updated.count > 0
}

export async function recordConnectionError(connectionId: string, message: string): Promise<void> {
  await prisma.businessPaymentConnection.update({
    where: { id: connectionId },
    data: { status: 'INVALID', lastError: message.slice(0, 300) },
  })
}

/* ---------------------------------------------------------------------------
 * Credentials — the only path by which secrets leave this module
 * ------------------------------------------------------------------------ */

/**
 * Decrypts one connection's credentials for a single signing or verification
 * call.
 *
 * Takes a connection id rather than a business id on purpose: a notification
 * must be verified against the exact connection its attempt was created with,
 * including one already SUPERSEDED by a rotation. Scoping this by "the
 * business's current connection" would fail precisely the in-flight payments
 * rotation is supposed to protect.
 *
 * The caller is responsible for having reached this id through an attempt it
 * already trusts — never from anything in an inbound notification.
 */
export async function loadCredentials(connectionId: string): Promise<PayfastCredentials> {
  const row = await prisma.businessPaymentConnection.findUnique({
    where: { id: connectionId },
    select: { merchantId: true, merchantKeyCipher: true, passphraseCipher: true, environment: true },
  })
  if (!row) throw new Error('Payment connection not found.')

  return {
    merchantId: row.merchantId,
    merchantKey: decryptSecret(row.merchantKeyCipher),
    passphrase: row.passphraseCipher ? decryptSecret(row.passphraseCipher) : undefined,
    environment: row.environment,
  }
}
