/**
 * Storefront slug policy — the single source of truth for what a business's
 * public address label may be.
 *
 * A slug is a LOOKUP KEY, never an identity: Business.id stays the only
 * tenant identity, and a slug can change (see slug.service.ts, which keeps
 * the old one in business_slug_history so links keep working). The slug is
 * used in two places that both impose rules:
 *
 *   https://<slug>.skhokholabs.app        — a DNS label (RFC 1035)
 *   https://skhokho.sgdataint.co.za/store/<slug> — an app route segment
 *
 * so a valid slug is: 3-63 chars, a-z / 0-9 / single hyphens, no leading or
 * trailing hyphen, not punycode (`xn--`, homograph risk), and not reserved.
 *
 * Pure and dependency-free (no Prisma) so it can be unit tested and imported
 * from middleware-adjacent code without pulling in a database client.
 */

export const SLUG_MIN_LENGTH = 3
export const SLUG_MAX_LENGTH = 63 // DNS label limit

/**
 * Reserved labels, grouped by WHY they're reserved — the reason is the
 * policy, the list is just its current application. Exact match, except
 * BRAND, which also blocks `<brand>-…` prefixes (impersonation).
 *
 * Offensive names are deliberately NOT handled by a blocklist here: a new
 * business is created PENDING_VERIFICATION and is not publicly reachable
 * (every resolver and storefront read requires status ACTIVE) until it is
 * activated — that activation step is the review point, and a static word
 * list is both easy to evade and prone to blocking legitimate names.
 */
export const RESERVED_SLUG_POLICY = {
  /** Hostnames the platform itself needs, or that mail/DNS/TLS tooling treats specially. */
  INFRASTRUCTURE: [
    'www', 'api', 'app', 'admin', 'administrator', 'root', 'system', 'internal',
    'mail', 'email', 'webmail', 'smtp', 'imap', 'pop', 'pop3', 'mx', 'ns', 'ns1', 'ns2', 'dns',
    'ftp', 'sftp', 'ssh', 'vpn', 'cdn', 'static', 'assets', 'media', 'img', 'images', 'files',
    'uploads', 'status', 'docs', 'help', 'support', 'blog', 'bookings', 'auth', 'sso', 'oauth',
    'login', 'logout', 'signin', 'signout', 'signup', 'register', 'account', 'accounts',
    'billing', 'payments', 'checkout', 'dashboard', 'console', 'portal', 'platform',
    'dev', 'staging', 'test', 'preview', 'demo', 'sandbox', 'localhost', 'autodiscover',
    'autoconfig', 'postmaster', 'hostmaster', 'webmaster', 'abuse', 'security', 'noreply',
    'no-reply',
  ],
  /** Top-level app routes and /store/<static> segments — a slug equal to one of these would be shadowed by the real route. */
  APP_ROUTES: [
    'store', 'pay', 'order', 'orders', 'tenant', 'discover', 'showcase', 'product', 'review',
    'terms', 'privacy', 'join', 'staff', 'staff-login', 'forgot-password', 'reset-password',
    'for-businesses', 'how-it-works', 'not-found',
  ],
  /** The platform's own names — a merchant must never look like Skhokho itself. */
  BRAND: ['skhokho', 'skhokholabs', 'skhokho-labs', 'sgdataint', 'agentive', 'agentive-labs'],
  /** Payment providers, banks and government — names customers associate with money or authority. */
  IMPERSONATION: [
    'payfast', 'ozow', 'snapscan', 'zapper', 'yoco', 'paystack', 'capitec', 'fnb', 'absa',
    'nedbank', 'standardbank', 'standard-bank', 'tymebank', 'discovery', 'sars', 'sassa',
    'gov', 'government', 'saps', 'police',
  ],
} as const

export type ReservedSlugCategory = keyof typeof RESERVED_SLUG_POLICY

const RESERVED_EXACT = new Map<string, ReservedSlugCategory>()
for (const [category, names] of Object.entries(RESERVED_SLUG_POLICY) as [ReservedSlugCategory, readonly string[]][]) {
  for (const name of names) RESERVED_EXACT.set(name, category)
}

/** Which policy reserves `slug`, or null if none does. */
export function reservedSlugCategory(slug: string): ReservedSlugCategory | null {
  const exact = RESERVED_EXACT.get(slug)
  if (exact) return exact
  if (RESERVED_SLUG_POLICY.BRAND.some((brand) => slug.startsWith(`${brand}-`))) return 'BRAND'
  return null
}

export type SlugProblem = 'TOO_SHORT' | 'TOO_LONG' | 'INVALID_CHARACTERS' | 'PUNYCODE' | 'RESERVED'

export type SlugValidation = { ok: true } | { ok: false; problem: SlugProblem; category?: ReservedSlugCategory }

const SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function validateSlug(slug: string): SlugValidation {
  if (slug.length < SLUG_MIN_LENGTH) return { ok: false, problem: 'TOO_SHORT' }
  if (slug.length > SLUG_MAX_LENGTH) return { ok: false, problem: 'TOO_LONG' }
  if (slug.startsWith('xn--')) return { ok: false, problem: 'PUNYCODE' }
  if (!SLUG_SHAPE.test(slug)) return { ok: false, problem: 'INVALID_CHARACTERS' }
  const category = reservedSlugCategory(slug)
  if (category) return { ok: false, problem: 'RESERVED', category }
  return { ok: true }
}

/** Plain-language reason for an owner-facing form. */
export function describeSlugProblem(problem: SlugProblem): string {
  switch (problem) {
    case 'TOO_SHORT':
      return `Your web address needs at least ${SLUG_MIN_LENGTH} letters or numbers.`
    case 'TOO_LONG':
      return `Your web address can be at most ${SLUG_MAX_LENGTH} characters.`
    case 'INVALID_CHARACTERS':
      return 'Use only lowercase letters, numbers and single dashes.'
    case 'PUNYCODE':
      return "That web address can't start with “xn--”."
    case 'RESERVED':
      return 'That web address is reserved. Please pick another one.'
  }
}

/**
 * Turn any text (usually a business name) into slug-shaped text. Never
 * validates — callers decide what to do with a result that's too short or
 * reserved. "Kota-Tainment (Soweto)" → "kota-tainment-soweto",
 * "Café Süd & Co." → "cafe-sud-and-co".
 */
export function normalizeSlug(input: string): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return truncateSlug(slug, SLUG_MAX_LENGTH)
}

/** Cut to `max` chars, preferring a word (hyphen) boundary, never ending on a hyphen. */
function truncateSlug(slug: string, max: number): string {
  if (slug.length <= max) return slug
  const cut = slug.slice(0, max)
  const lastHyphen = cut.lastIndexOf('-')
  const atBoundary = lastHyphen >= SLUG_MIN_LENGTH ? cut.slice(0, lastHyphen) : cut
  return atBoundary.replace(/-+$/g, '')
}

function withSuffix(base: string, suffix: string): string {
  return `${truncateSlug(base, SLUG_MAX_LENGTH - suffix.length - 1)}-${suffix}`
}

export type SlugContext = {
  suburb?: string | null
  city?: string | null
}

/** How many numbered fallbacks (`base-2` … `base-N`) to offer before giving up. */
export const MAX_NUMBERED_CANDIDATES = 50

/**
 * Deterministic, human-readable candidates for a new business, in order of
 * preference — the first one nobody holds wins (see slug.service.ts):
 *
 *   kota-tainment → kota-tainment-soweto → kota-tainment-johannesburg
 *     → kota-tainment-2 … kota-tainment-50
 *
 * Every returned candidate passes validateSlug. A name that normalizes to
 * nothing usable (too short, non-Latin script, reserved) borrows the
 * location to become valid ("Zo" in Soweto → "zo-soweto"), and falls back to
 * "my-shop" only as a last resort — never to an internal id.
 */
export function slugCandidates(name: string, context: SlugContext = {}): string[] {
  const locations = [context.suburb, context.city]
    .map((value) => (value ? normalizeSlug(value) : ''))
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index)

  let base = normalizeSlug(name)
  if (!validateSlug(base).ok && base.length < SLUG_MIN_LENGTH) {
    // Too short on its own: lean on the location before going generic.
    base = [base, ...locations].filter(Boolean).join('-') || 'my-shop'
    if (base.length < SLUG_MIN_LENGTH) base = 'my-shop'
  }

  const candidates: string[] = [base]
  for (const location of locations) {
    if (!base.endsWith(location)) candidates.push(withSuffix(base, location))
  }
  for (let n = 2; n <= MAX_NUMBERED_CANDIDATES; n++) candidates.push(withSuffix(base, String(n)))

  const valid = candidates.filter((candidate, index, all) => validateSlug(candidate).ok && all.indexOf(candidate) === index)
  // Every variant reserved (e.g. a business literally named "Skhokho", whose
  // `skhokho-…` prefixes are brand-blocked too): start again from the generic base.
  return valid.length > 0 || base === 'my-shop' ? valid : slugCandidates('my-shop', context)
}
