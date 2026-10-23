/**
 * The cross-business switch — POPIA s57.
 *
 * Anything that shows ONE person their memberships, orders or rewards from
 * SEVERAL businesses in one place is the "unique identifier linked across
 * responsible parties" layer, which needs prior authorisation from the
 * Information Regulator (docs/specs/2026-07-14-customer-platform-design.md
 * §2, docs/legal/consent-wording.md Consent 2). Until that authorisation
 * exists this stays OFF: a customer's account works one shop at a time,
 * resolved per business from their verified identifier.
 *
 * Server-side only, read from the environment on every call, OFF unless set
 * to exactly "true" — the same shape as the Skhokholetha switches
 * (src/modules/skhokholetha/flags.ts). Turning it on is a legal decision,
 * not a deploy.
 */

export const CROSS_BUSINESS_FLAG = 'CROSS_BUSINESS_LINKING_ENABLED' as const

export function crossBusinessLinkingEnabled(): boolean {
  return process.env[CROSS_BUSINESS_FLAG] === 'true'
}

export class CrossBusinessDisabledError extends Error {
  constructor() {
    super('Seeing all your shops in one place is not available yet.')
    this.name = 'CrossBusinessDisabledError'
  }
}

/** Throws unless the Regulator-gated layer has been switched on. Every cross-business read calls this first. */
export function requireCrossBusinessLinking(): void {
  if (!crossBusinessLinkingEnabled()) throw new CrossBusinessDisabledError()
}
