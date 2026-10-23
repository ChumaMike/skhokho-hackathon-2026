/**
 * Domain-name helpers — pure.
 *
 * The registrable ("apex") domain matters twice: it's where the ownership
 * TXT record lives (one proof covers kotatainment.co.za and
 * www.kotatainment.co.za), and it's what a registrar sells. South African
 * second-level registries (co.za, org.za, …) mean the apex of
 * www.kotatainment.co.za is kotatainment.co.za, not co.za.
 */

/** Second-level public suffixes we know of; anything else is treated as a normal TLD. */
const SECOND_LEVEL_SUFFIXES = new Set([
  // .za second-level domains (ZACR and others)
  'co.za', 'org.za', 'net.za', 'web.za', 'gov.za', 'ac.za', 'nom.za', 'edu.za', 'law.za', 'mil.za',
  // common elsewhere, so a merchant's existing foreign domain resolves correctly
  'co.uk', 'org.uk', 'com.au', 'net.au', 'co.nz', 'com.na', 'co.bw', 'co.zw', 'co.ke', 'com.ng',
])

/** The public suffix of a hostname (co.za, com, …). */
export function publicSuffix(hostname: string): string {
  const labels = hostname.split('.')
  const lastTwo = labels.slice(-2).join('.')
  return labels.length >= 3 && SECOND_LEVEL_SUFFIXES.has(lastTwo) ? lastTwo : labels[labels.length - 1]
}

/** The registrable domain: www.kotatainment.co.za → kotatainment.co.za. */
export function apexOf(hostname: string): string {
  const suffix = publicSuffix(hostname)
  const labels = hostname.split('.')
  const suffixLabels = suffix.split('.').length
  return labels.slice(-(suffixLabels + 1)).join('.')
}

export function isApex(hostname: string): boolean {
  return apexOf(hostname) === hostname
}

/** The usual partner of a hostname: apex ↔ www.apex; anything deeper has none. */
export function wwwPartner(hostname: string): string | null {
  const apex = apexOf(hostname)
  if (hostname === apex) return `www.${apex}`
  if (hostname === `www.${apex}`) return apex
  return null
}

/** DNS name of the ownership challenge for a hostname — always at the apex. */
export function challengeName(hostname: string): string {
  return `_skhokho-verify.${apexOf(hostname)}`
}

/** The TXT value the merchant publishes. Prefixed so it's recognisable among other TXT records. */
export function challengeValue(token: string): string {
  return `skhokho-verify=${token}`
}

/**
 * A merchant's search words → a domain label, e.g. "Kota Tainment!" →
 * "kotatainment". Hyphens are kept as a separate variant by the caller.
 */
export function labelFromQuery(query: string, keepHyphens = false): string {
  const base = query
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.[a-z.]+$/, '') // a typed suffix ("kota.co.za") is the caller's to re-add
    .replace(/&/g, keepHyphens ? '-and-' : 'and')
    .replace(/[^a-z0-9]+/g, keepHyphens ? '-' : '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return base.slice(0, 63).replace(/-$/, '')
}
