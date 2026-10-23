/**
 * Canonical storefront addresses.
 *
 * One business, several ways in — all resolving to the same Business.id:
 *
 *   https://kota-tainment.skhokholabs.app            ← canonical (once STOREFRONT_DOMAIN is set)
 *   https://skhokho.sgdataint.co.za/store/kota-tainment ← legacy / fallback, always served
 *   https://kota-tainment.skhokho.sgdataint.co.za    ← legacy platform subdomain, 308s to canonical
 *
 * STOREFRONT_DOMAIN is the rollout switch: while it's unset (today), the
 * canonical address stays the /store/<slug> path, exactly as before, so
 * shipping this changes no live link until DNS for the new domain exists.
 *
 * Env is read per call (not captured at import) so tests can exercise both
 * modes. Pure: no Prisma.
 */

const DEFAULT_APP_URL = 'http://localhost:3002'

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

/** The platform app origin (console, marketing, legacy /store paths). */
export function appOrigin(): string {
  return stripTrailingSlash(process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL)
}

/**
 * The storefront root domain as configured (may include a dev port, e.g.
 * `localhost:3002`), or null when subdomain storefronts aren't switched on.
 */
export function storefrontDomainSetting(): string | null {
  const raw = process.env.STOREFRONT_DOMAIN?.trim().toLowerCase().replace(/\.$/, '')
  return raw ? raw : null
}

/** STOREFRONT_DOMAIN without any port — the form hostname resolution compares against. */
export function storefrontRootHost(): string | null {
  const setting = storefrontDomainSetting()
  return setting ? setting.split(':')[0] : null
}

function protocolFor(host: string): 'http' | 'https' {
  const bare = host.split(':')[0]
  return bare === 'localhost' || bare.endsWith('.localhost') ? 'http' : 'https'
}

/** `/store/<slug>` — the path-based route that works on the platform host. */
export function legacyStorefrontPath(slug: string): string {
  return `/store/${slug}`
}

/**
 * The host a business's storefront canonically lives on: its live primary
 * custom domain if it has one, else <slug>.<storefront domain>, else null
 * while subdomains are off.
 */
export function canonicalStorefrontHost(slug: string, primaryCustomHost?: string | null): string | null {
  if (primaryCustomHost) return primaryCustomHost
  const setting = storefrontDomainSetting()
  return setting ? `${slug}.${setting}` : null
}

/**
 * Absolute canonical URL for a storefront page. `path` is relative to the
 * storefront root: '' (home), '/about', '/shop', ...
 */
export function canonicalStorefrontUrl(slug: string, path = '', primaryCustomHost?: string | null): string {
  const host = canonicalStorefrontHost(slug, primaryCustomHost)
  if (host) return `${protocolFor(host)}://${host}${path}`
  return `${appOrigin()}${legacyStorefrontPath(slug)}${path}`
}
