/**
 * Who is issuing the invoice, and where to pay it.
 *
 * The legal issuer is "Skhokho Laboratory" in full wherever money is
 * involved — never "Skhokho" on its own, which is the product name.
 *
 * Everything else here comes from configuration and is NEVER invented. An
 * unconfigured bank account renders as "ask us for the details" rather than a
 * plausible-looking number, because a wrong account number on an invoice sends
 * a merchant's money to a stranger.
 */

export const ISSUER_LEGAL_NAME = 'Skhokho Laboratory'
export const ISSUER_SHORT_NAME = 'Skhokho Labs'
/** How the issuer is named on a document: the full legal name, with the short form in quotes. */
export const ISSUER_DISPLAY = `${ISSUER_LEGAL_NAME} (“${ISSUER_SHORT_NAME}”)`

export interface BankDetails {
  bankName: string
  accountName: string
  accountNumber: string
  branchCode: string
}

/**
 * EFT details, or null when not configured.
 *
 * All four fields must be present: a partially configured account is worse
 * than none, because it looks payable and isn't.
 */
export function bankDetails(): BankDetails | null {
  const bankName = process.env.BILLING_BANK_NAME?.trim()
  const accountName = process.env.BILLING_BANK_ACCOUNT_NAME?.trim()
  const accountNumber = process.env.BILLING_BANK_ACCOUNT_NUMBER?.trim()
  const branchCode = process.env.BILLING_BANK_BRANCH_CODE?.trim()
  if (!bankName || !accountName || !accountNumber || !branchCode) return null
  return { bankName, accountName, accountNumber, branchCode }
}

/** Postal/registered address line, if configured. */
export function issuerAddress(): string | null {
  return process.env.BILLING_ISSUER_ADDRESS?.trim() || null
}

/** Company registration number, if configured. Never invented. */
export function issuerRegistrationNumber(): string | null {
  return process.env.BILLING_ISSUER_REG_NUMBER?.trim() || null
}
