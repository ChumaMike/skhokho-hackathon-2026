/**
 * VAT, in two modes, with no assumption made about which one is real.
 *
 * The VAT registration status of Skhokho Laboratory is NOT yet confirmed, so
 * Phase A is built to operate correctly either way and to refuse to guess:
 *
 *   NOT REGISTERED  no VAT line, no VAT number, the document is an "Invoice".
 *   REGISTERED      a VAT line, the VAT number printed, and the document is a
 *                   "Tax Invoice". Advertised prices are VAT-INCLUSIVE, so VAT
 *                   is derived from the total rather than added to it.
 *
 * Switched by configuration, never by a code change:
 *
 *   BILLING_VAT_NUMBER   the real registration number. Its presence is what
 *                        turns registered mode on — there is no boolean to set
 *                        inconsistently, and no number is ever invented.
 *   BILLING_VAT_RATE_BP  rate in basis points; defaults to 1500 (15%).
 *
 * Deliberate consequence: a document can never be labelled "Tax Invoice"
 * without a real VAT number being configured, because the label and the number
 * come from the same switch. Issuing a non-compliant tax invoice would have to
 * be credited and reissued.
 */

/** Integer cents in, integer cents out. No floats touch money. */
export type VatMode =
  | { registered: false }
  | { registered: true; vatNumber: string; rateBasisPoints: number }

const DEFAULT_RATE_BP = 1500

export function vatMode(): VatMode {
  const vatNumber = process.env.BILLING_VAT_NUMBER?.trim()
  if (!vatNumber) return { registered: false }
  const raw = Number(process.env.BILLING_VAT_RATE_BP)
  const rateBasisPoints = Number.isInteger(raw) && raw > 0 && raw < 10_000 ? raw : DEFAULT_RATE_BP
  return { registered: true, vatNumber, rateBasisPoints }
}

/** "Tax Invoice" only in registered mode — see the note above. */
export function invoiceDocumentTitle(mode: VatMode = vatMode()): string {
  return mode.registered ? 'Tax Invoice' : 'Invoice'
}

export interface VatSplit {
  /** What the merchant pays. Always the advertised figure. */
  totalCents: number
  /** Total less VAT. Equals totalCents when not registered. */
  subtotalCents: number
  /** 0 when not registered. */
  vatCents: number
}

/**
 * Splits a VAT-INCLUSIVE total into subtotal and VAT.
 *
 * Inclusive because the advertised prices (R 599.00, R 1 299.00) are what a
 * merchant pays: a spaza shop that is not VAT registered cannot claim input
 * VAT and only cares what leaves its account, so the advertised number must be
 * the real one.
 *
 * VAT is computed once, on the invoice TOTAL rather than per line, and rounded
 * to the cent — one rounding, so the arithmetic is deterministic and testable.
 * Per-line rounding on a multi-line invoice can leave the lines not summing to
 * the total, which is the classic way a VAT return stops balancing.
 */
export function splitInclusive(totalCents: number, mode: VatMode = vatMode()): VatSplit {
  if (!mode.registered) {
    return { totalCents, subtotalCents: totalCents, vatCents: 0 }
  }
  // vat = total * rate / (10000 + rate), rounded half-up, in integer maths.
  const { rateBasisPoints: rate } = mode
  const vatCents = Math.round((totalCents * rate) / (10_000 + rate))
  return { totalCents, subtotalCents: totalCents - vatCents, vatCents }
}

/** The rate as a human string for the invoice ("15%", "15.5%"). */
export function vatRateLabel(mode: VatMode = vatMode()): string | null {
  if (!mode.registered) return null
  const pct = mode.rateBasisPoints / 100
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0$/, '')}%`
}

/**
 * Whether a real production invoice may be issued at all.
 *
 * Phase A can generate and render invoices in either mode, but the VAT status
 * of Skhokho Laboratory is unconfirmed, so issuing real documents stays gated
 * on an explicit acknowledgement that the mode in force is the correct one.
 * Without it, drafts and previews work and nothing is sent to a merchant.
 */
export function invoiceIssuingEnabled(): boolean {
  return process.env.BILLING_TAX_STATUS_CONFIRMED === 'true'
}

export class InvoiceIssuingBlockedError extends Error {
  constructor() {
    super(
      'Invoices are not being issued yet: the VAT status of Skhokho Laboratory ' +
        'has not been confirmed. Set BILLING_TAX_STATUS_CONFIRMED=true once it has.',
    )
    this.name = 'InvoiceIssuingBlockedError'
  }
}
