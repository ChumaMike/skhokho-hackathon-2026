/**
 * PayFast protocol layer.
 *
 * Deliberately knows nothing about businesses, orders or the database. It
 * signs a payload with whatever credentials it is handed, and verifies a
 * notification against whatever credentials it is handed — nothing more.
 *
 * Credentials used to be resolved from process env inside this file, which
 * meant every merchant's customer money settled to one platform account and
 * no function here could express "pay THIS business". They are now an
 * explicit argument on every call. Choosing which account an order belongs to
 * is a question about a business, so it is answered in modules/payments.
 *
 * Scope: product orders. Appointment bookings deliberately stay pay-in-person
 * — the industry norm for local-service booking tools (Fresha and Vagaro
 * don't mandate prepayment either), not a gap. A booking reserves time; it is
 * not a completed sale.
 */

import crypto from 'node:crypto'

export type PayfastEnvironment = 'SANDBOX' | 'LIVE'

/**
 * What it takes to transact as one specific PayFast account.
 *
 * `merchantId` is not a secret — the provider requires it in the payment
 * submission itself. `merchantKey` and `passphrase` are bearer secrets and
 * arrive here already decrypted, for the duration of one call.
 */
export interface PayfastCredentials {
  merchantId: string
  merchantKey: string
  /** Mandatory for LIVE (enforced in the database); optional for sandbox. */
  passphrase?: string
  environment: PayfastEnvironment
}

export function payfastProcessUrl(environment: PayfastEnvironment): string {
  return environment === 'SANDBOX'
    ? 'https://sandbox.payfast.co.za/eng/process'
    : 'https://www.payfast.co.za/eng/process'
}

export function payfastValidateUrl(environment: PayfastEnvironment): string {
  return environment === 'SANDBOX'
    ? 'https://sandbox.payfast.co.za/eng/query/validate'
    : 'https://www.payfast.co.za/eng/query/validate'
}

/**
 * PayFast's encoding is PHP's urlencode(), not JS's encodeURIComponent() —
 * they differ on more than just the space/%20-vs-+ case this already
 * handled: PHP also percent-encodes `! ' ( ) *` and `~`, which
 * encodeURIComponent leaves untouched (they're in its "unreserved" set).
 * A field value containing any of those produces a signature PayFast's
 * own PHP-side recomputation will never match, which surfaces as a bare
 * 400 with no field-level detail — this was invisible in testing until a
 * value actually contained one of them.
 */
function pfEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/~/g, '%7E')
    .replace(/%20/g, '+')
}

function md5(input: string): string {
  return crypto.createHash('md5').update(input).digest('hex')
}

/**
 * Signature for an OUTBOUND payment submission: MD5 over the fields in the
 * order they are listed (PayFast's requirement — not alphabetical, and not
 * the order a plain object happens to iterate), passphrase appended last.
 *
 * Empty values are excluded entirely rather than sent as `key=`, which is
 * correct for the outbound direction only. See signItnPayload for why the
 * inbound direction must not do the same.
 */
function signOutbound(fields: [string, string][], passphrase?: string): string {
  const parts = fields
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${pfEncode(value)}`)
  if (passphrase) parts.push(`passphrase=${pfEncode(passphrase)}`)
  return md5(parts.join('&'))
}

/**
 * Signature for an INBOUND notification: every posted field except
 * `signature`, in the order received, **including empty ones**.
 *
 * This is the one place the two directions genuinely differ, and getting it
 * wrong is invisible in sandbox. A real PayFast account posts a number of
 * empty fields and its signature covers them; dropping them — as the
 * outbound rule does — produces a mismatch that only ever shows up against
 * live merchant traffic, long after the integration looked fine.
 */
function signItnPayload(fields: [string, string][], passphrase?: string): string {
  const parts = fields.map(([key, value]) => `${key}=${pfEncode(value ?? '')}`)
  if (passphrase) parts.push(`passphrase=${pfEncode(passphrase)}`)
  return md5(parts.join('&'))
}

export interface BuildPaymentFieldsInput {
  /**
   * Sent as `m_payment_id`. This is a PAYMENT ATTEMPT reference, never an
   * order id: one order may be attempted several times, and a per-order value
   * would make a late notification impossible to attribute to the attempt
   * that produced it.
   */
  reference: string
  amount: number // rand, not cents
  itemName: string
  returnUrl: string
  cancelUrl: string
  notifyUrl: string
  buyerFirstName?: string
  /**
   * PayFast requires at least one of email_address/cell_number on every
   * submission (confirmed against a real sandbox account — this was the
   * actual cause of a bare 400 with no field-level error, not a signature
   * or credentials problem). Pass whichever the caller actually has; both
   * is fine too.
   */
  buyerEmail?: string
  buyerCellNumber?: string
}

/** Ordered field list for the auto-submitting form — order is part of the signature. */
export function buildPaymentFields(
  input: BuildPaymentFieldsInput,
  credentials: PayfastCredentials,
): [string, string][] {
  const fields: [string, string][] = [
    ['merchant_id', credentials.merchantId],
    ['merchant_key', credentials.merchantKey],
    ['return_url', input.returnUrl],
    ['cancel_url', input.cancelUrl],
    ['notify_url', input.notifyUrl],
    ['name_first', input.buyerFirstName ?? 'Customer'],
    ['email_address', input.buyerEmail ?? ''],
    ['cell_number', input.buyerCellNumber ?? ''],
    ['m_payment_id', input.reference],
    ['amount', input.amount.toFixed(2)],
    ['item_name', input.itemName.slice(0, 100)],
  ]

  fields.push(['signature', signOutbound(fields, credentials.passphrase)])
  return fields
}

export interface PayfastItnFields {
  m_payment_id: string
  pf_payment_id: string
  payment_status: string
  amount_gross: string
  merchant_id?: string
  signature: string
  [key: string]: string | undefined
}

/**
 * Verifies a notification's signature against ONE specific account's
 * passphrase.
 *
 * A passing signature is necessary and never sufficient. It proves only that
 * the sender knew the passphrase — it says nothing about which merchant
 * account the money reached, whether the amount matches, or whether this
 * notification has already been processed. Every one of those is checked
 * separately in the ITN route.
 *
 * `orderedFields` must preserve the order the fields arrived in.
 */
export function verifyItnSignature(
  orderedFields: [string, string][],
  credentials: Pick<PayfastCredentials, 'passphrase'>,
): boolean {
  const withoutSignature = orderedFields.filter(([key]) => key !== 'signature')
  const provided = orderedFields.find(([key]) => key === 'signature')?.[1] ?? ''
  const expected = signItnPayload(withoutSignature, credentials.passphrase)
  // Constant-time, so response timing reveals nothing about how much of a
  // forged signature matched. Length is checked first because timingSafeEqual
  // requires equal-length inputs (and a wrong length is simply a mismatch).
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided.toLowerCase(), 'utf8')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/**
 * Asks PayFast to confirm it really sent this notification, against the host
 * belonging to the SAME account the notification is for.
 *
 * The environment is a parameter rather than a global: a sandbox merchant and
 * a live merchant need different hosts, and asking the wrong one would either
 * reject a genuine payment or accept one PayFast never sent.
 *
 * Fails closed — a network error is not a pass.
 */
export type PayfastValidation = 'VALID' | 'INVALID' | 'UNAVAILABLE'

/** How long to wait for PayFast's check-back before treating it as unavailable. */
export const PAYFAST_VALIDATE_TIMEOUT_MS = 10_000

/**
 * Three outcomes, because they need different answers:
 *   VALID        PayFast confirms it sent this notification.
 *   INVALID      PayFast says it did NOT — refuse it for good.
 *   UNAVAILABLE  We couldn't get an answer (network error, timeout, PayFast
 *                error page, unexpected body). NOT a pass — and not a
 *                refusal either: the notification may be genuine, so the
 *                caller must make PayFast retry it rather than drop it.
 */
export async function validateWithPayfast(rawBody: string, environment: PayfastEnvironment): Promise<PayfastValidation> {
  try {
    const res = await fetch(payfastValidateUrl(environment), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: rawBody,
      signal: AbortSignal.timeout(PAYFAST_VALIDATE_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error('[payfast] validate call returned HTTP', res.status)
      return 'UNAVAILABLE'
    }
    const text = (await res.text()).trim()
    if (text === 'VALID') return 'VALID'
    if (text === 'INVALID') return 'INVALID'
    console.error('[payfast] validate call returned an unexpected body')
    return 'UNAVAILABLE'
  } catch (e) {
    console.error('[payfast] validate call failed:', e instanceof Error ? e.message : e)
    return 'UNAVAILABLE'
  }
}

/* ---------------------------------------------------------------------------
 * Platform account — SGDataInt's own, never a merchant's
 * ------------------------------------------------------------------------ */

/**
 * PayFast's publicly documented sandbox test account. A real working sandbox,
 * not a stub — but it belongs to nobody, so it can only ever serve Skhokho's
 * own testing, never a merchant's customer.
 */
const SANDBOX_MERCHANT_ID = '10000100'
const SANDBOX_MERCHANT_KEY = '46f0cd694581a'

export type PlatformPaymentMode = 'live' | 'sandbox' | 'unconfigured'

/**
 * Whether Skhokho's OWN PayFast account is configured.
 *
 * Deliberately unreachable from merchant checkout. Under merchant-direct
 * settlement a business with no verified connection has no online card option
 * at all — it must never quietly fall back to the platform account, because
 * that would route a merchant's customer money to SGDataInt.
 *
 * Retained as the seam for a later milestone: Skhokho's own subscription and
 * hosting billing, which genuinely is an SGDataInt-owned transaction. Nothing
 * uses it today.
 */
export function platformPaymentMode(): PlatformPaymentMode {
  if (process.env.PAYFAST_SANDBOX === 'true') return 'sandbox'
  if (process.env.PAYFAST_MERCHANT_ID) return 'live'
  return process.env.NODE_ENV === 'production' ? 'unconfigured' : 'sandbox'
}

/**
 * Credentials for an SGDataInt-owned transaction. Throws when unconfigured in
 * production rather than silently using the public sandbox account, which
 * would look like a working payment while no money moved.
 */
export function platformCredentials(): PayfastCredentials {
  const mode = platformPaymentMode()
  if (mode === 'unconfigured') {
    throw new Error(
      "Skhokho's own PayFast account is not configured: set PAYFAST_MERCHANT_ID and " +
        'PAYFAST_MERCHANT_KEY, or PAYFAST_SANDBOX=true to use the test account deliberately.',
    )
  }
  if (mode === 'sandbox') {
    return {
      merchantId: SANDBOX_MERCHANT_ID,
      merchantKey: SANDBOX_MERCHANT_KEY,
      passphrase: undefined,
      environment: 'SANDBOX',
    }
  }
  return {
    merchantId: process.env.PAYFAST_MERCHANT_ID!,
    merchantKey: process.env.PAYFAST_MERCHANT_KEY!,
    passphrase: process.env.PAYFAST_PASSPHRASE,
    environment: 'LIVE',
  }
}
