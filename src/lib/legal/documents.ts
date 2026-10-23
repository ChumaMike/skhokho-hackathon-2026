/**
 * The platform's customer-facing legal documents and their CURRENT versions.
 *
 * This file is the single place the app learns which version of the Terms of
 * Service and the Privacy Notice is in force. The text itself lives in
 * docs/legal/*.md (the canonical, attorney-reviewed copy); the app renders a
 * generated copy (src/lib/legal/generated/, produced by
 * scripts/legal/sync-legal-texts.mjs). legal-texts.test.ts fails if the
 * generated copy or the version string drifts from the markdown.
 *
 * Client-safe: no Node imports, so CheckoutView (a client component) can
 * send the version it showed the customer.
 *
 * Bump the version here AND in the "**Version:**" line of the markdown when
 * the published text changes. Customers who accepted an older version at
 * checkout keep that version on their order; a stale checkout page (opened
 * before a bump) is asked to reload and accept the current text — the same
 * rule the driver legal gate applies (src/modules/skhokholetha/legal.ts).
 */

export type LegalDocumentKey = 'terms' | 'privacy'

export interface LegalDocument {
  key: LegalDocumentKey
  /** Short title used in links and page headings. */
  title: string
  /** Route inside the app. */
  path: '/terms' | '/privacy'
  /** The version string a customer accepts; same shape as DRIVER_TERMS_VERSION. */
  version: string
  /** Where the canonical markdown lives, relative to the app root. */
  source: string
  /** True until counsel approves and the founder publishes. */
  draft: boolean
}

/** Same rule as the driver legal gate: short, URL-safe, no spaces. */
export const LEGAL_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/

export const TERMS_VERSION = 'v0.1-draft-2026-10-21'
export const PRIVACY_VERSION = 'v0.1-draft-2026-10-21'

export const LEGAL_DOCUMENTS: Record<LegalDocumentKey, LegalDocument> = {
  terms: {
    key: 'terms',
    title: 'Terms of Service',
    path: '/terms',
    version: TERMS_VERSION,
    source: 'docs/legal/terms-of-service.md',
    draft: true,
  },
  privacy: {
    key: 'privacy',
    title: 'Privacy Notice',
    path: '/privacy',
    version: PRIVACY_VERSION,
    source: 'docs/legal/privacy-notice.md',
    draft: true,
  },
}

/**
 * Whether a version string a customer's browser posted is the one in force.
 * `undefined` (an old client that never sent one) is NOT accepted: every
 * acceptance we store must name the text that was shown.
 */
export function isCurrentTermsVersion(version: string | undefined | null): version is string {
  return typeof version === 'string' && version === TERMS_VERSION
}

/** The plain sentence shown when a stale page posts an older version. */
export const TERMS_OUTDATED_MESSAGE = 'Our terms were updated while this page was open. Please reload the page and accept the current terms to continue.'
