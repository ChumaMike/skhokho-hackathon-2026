/**
 * The merchant's legal identity for its storefront — the information ECTA
 * section 43 requires an online seller to show (docs/legal/
 * ecta-storefront-information.md): legal name, optional registration
 * number, returns / cancellation text and a complaints contact.
 *
 * Stored under `businesses.settings.legal` (same merge-preserving pattern
 * as ordering / fulfilment in capabilities.ts), so no migration and no new
 * table: it is business configuration, read wherever the business row is.
 *
 * Three consumers:
 *   Dashboard › Settings › Legal  — getLegalInformation / setLegalInformation
 *   storefront footers            — buildEctaInformation (fills fallbacks)
 *   merchant readiness            — legalInformationGaps (what is missing)
 */

import { prisma } from '@/lib/prisma/client'
import { LEGAL_DOCUMENTS } from '@/lib/legal/documents'

export interface LegalInformation {
  /** The registered or natural-person name that contracts with the customer. */
  legalName: string | null
  /** CIPC / close-corporation number — optional; sole proprietors have none. */
  registrationNumber: string | null
  /** Plain-language returns and cancellation terms shown on the storefront. */
  returnsText: string | null
  /** Where a customer complains — a phone, WhatsApp number or email. Falls back to the business's contact details. */
  complaintsContact: string | null
}

export const LEGAL_LIMITS = {
  legalName: 160,
  registrationNumber: 40,
  returnsText: 2000,
  complaintsContact: 200,
} as const

const EMPTY: LegalInformation = { legalName: null, registrationNumber: null, returnsText: null, complaintsContact: null }

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  return s ? s.slice(0, max) : null
}

export function getLegalInformation(business: { settings: unknown }): LegalInformation {
  const settings = (business.settings ?? {}) as { legal?: unknown }
  const raw = settings.legal
  if (!raw || typeof raw !== 'object') return EMPTY
  const l = raw as Record<string, unknown>
  return {
    legalName: cleanString(l.legalName, LEGAL_LIMITS.legalName),
    registrationNumber: cleanString(l.registrationNumber, LEGAL_LIMITS.registrationNumber),
    returnsText: cleanString(l.returnsText, LEGAL_LIMITS.returnsText),
    complaintsContact: cleanString(l.complaintsContact, LEGAL_LIMITS.complaintsContact),
  }
}

export type LegalInformationGap = 'legalName' | 'returnsText' | 'complaintsContact'

export const LEGAL_GAP_LABELS: Record<LegalInformationGap, string> = {
  legalName: 'legal name',
  returnsText: 'returns and cancellation terms',
  complaintsContact: 'complaints contact',
}

/**
 * What the storefront's ECTA block still lacks. A complaints contact counts
 * as present when the business has any contact detail to fall back on —
 * the footer then shows that — so a shop is never asked twice for the same
 * number. Registration number is optional and never a gap.
 */
export function legalInformationGaps(business: {
  settings: unknown
  phone: string | null
  whatsapp: string | null
  email: string | null
}): LegalInformationGap[] {
  const legal = getLegalInformation(business)
  const gaps: LegalInformationGap[] = []
  if (!legal.legalName) gaps.push('legalName')
  if (!legal.returnsText) gaps.push('returnsText')
  if (!legal.complaintsContact && !business.whatsapp && !business.phone && !business.email) gaps.push('complaintsContact')
  return gaps
}

export function validateLegalInformation(input: Partial<LegalInformation>): LegalInformation {
  const legalName = cleanString(input.legalName, Number.MAX_SAFE_INTEGER)
  const registrationNumber = cleanString(input.registrationNumber, Number.MAX_SAFE_INTEGER)
  const returnsText = cleanString(input.returnsText, Number.MAX_SAFE_INTEGER)
  const complaintsContact = cleanString(input.complaintsContact, Number.MAX_SAFE_INTEGER)
  if (legalName && legalName.length > LEGAL_LIMITS.legalName) throw new Error(`Legal name must be ${LEGAL_LIMITS.legalName} characters or fewer.`)
  if (registrationNumber && registrationNumber.length > LEGAL_LIMITS.registrationNumber) throw new Error(`Registration number must be ${LEGAL_LIMITS.registrationNumber} characters or fewer.`)
  if (registrationNumber && !/^[A-Za-z0-9/.\- ]+$/.test(registrationNumber)) throw new Error('Registration number may only contain letters, numbers, slashes, dots and dashes.')
  if (returnsText && returnsText.length > LEGAL_LIMITS.returnsText) throw new Error(`Returns and cancellation text must be ${LEGAL_LIMITS.returnsText} characters or fewer.`)
  if (complaintsContact && complaintsContact.length > LEGAL_LIMITS.complaintsContact) throw new Error(`Complaints contact must be ${LEGAL_LIMITS.complaintsContact} characters or fewer.`)
  return { legalName, registrationNumber, returnsText, complaintsContact }
}

/** Merge-preserving write under settings.legal — never touches other settings keys. */
export async function setLegalInformation(businessId: string, input: Partial<LegalInformation>): Promise<LegalInformation> {
  const legal = validateLegalInformation(input)
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { settings: true } })
  const settings = (business.settings ?? {}) as Record<string, unknown>
  // Spread into a plain record: Prisma's Json input type wants an indexable object, not the interface.
  const legalJson: Record<string, string | null> = { ...legal }
  await prisma.business.update({ where: { id: businessId }, data: { settings: { ...settings, legal: legalJson } } })
  return legal
}

// ---------------------------------------------------------------------------
// The rendered block
// ---------------------------------------------------------------------------

export interface EctaInformation {
  /** The contracting party as shown: legal name, or the trading name when none is set. */
  legalName: string
  /** Shown as "trading as" only when it differs from legalName. */
  tradingAs: string | null
  registrationNumber: string | null
  addressLine: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  returnsText: string | null
  complaintsContact: string | null
  /** True when the legal name was not supplied and the trading name stands in — the readiness gap. */
  usingTradingNameAsLegalName: boolean
  terms: { path: string; version: string }
  privacy: { path: string; version: string }
}

export interface EctaSourceBusiness {
  name: string
  settings: unknown
  phone: string | null
  whatsapp: string | null
  email: string | null
  address: string | null
  suburb: string | null
  city: string | null
  province?: string | null
  postalCode?: string | null
}

/** Everything the footer block shows, with the documented fallbacks applied. Pure. */
export function buildEctaInformation(business: EctaSourceBusiness): EctaInformation {
  const legal = getLegalInformation(business)
  const legalName = legal.legalName ?? business.name
  const tradingAs = legal.legalName && legal.legalName.trim().toLowerCase() !== business.name.trim().toLowerCase() ? business.name : null
  const addressParts = [business.address, business.suburb, business.city].filter((p): p is string => Boolean(p && p.trim()))
  const tail = [business.province, business.postalCode].filter((p): p is string => Boolean(p && p.trim())).join(' ')
  const addressLine = addressParts.length || tail ? [...addressParts, tail].filter(Boolean).join(', ') : null
  const complaintsContact = legal.complaintsContact ?? business.whatsapp ?? business.phone ?? business.email ?? null
  return {
    legalName,
    tradingAs,
    registrationNumber: legal.registrationNumber,
    addressLine,
    phone: business.phone,
    whatsapp: business.whatsapp,
    email: business.email,
    returnsText: legal.returnsText,
    complaintsContact,
    usingTradingNameAsLegalName: !legal.legalName,
    terms: { path: LEGAL_DOCUMENTS.terms.path, version: LEGAL_DOCUMENTS.terms.version },
    privacy: { path: LEGAL_DOCUMENTS.privacy.path, version: LEGAL_DOCUMENTS.privacy.version },
  }
}
