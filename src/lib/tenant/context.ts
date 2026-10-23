/**
 * Tenant Context — hostname resolution
 *
 * Maps an incoming Host header to one of five outcomes. Hostnames and slugs
 * are LOOKUP mechanisms only — every `tenant` outcome carries Business.id,
 * which stays the one authoritative tenant identity.
 *
 *   admin.<platform>                    → platform_admin
 *   <platform> / www.<platform>         → platform_root  (marketing + console)
 *   <slug>.<storefront domain>          → tenant, STOREFRONT       (canonical, e.g. kota.skhokholabs.app)
 *   <slug>.<platform>                   → tenant — or a 308 to <slug>.<storefront domain>
 *                                         once STOREFRONT_DOMAIN is set (legacy subdomain)
 *   <slug>.bookings|admin.<platform>    → tenant, surface BOOKINGS / ADMIN
 *   <old-slug>.<root>                   → 308 to the business's current slug (slug history)
 *   <storefront domain> / www.          → 308 to the platform app (no console on the storefront domain)
 *   www.nomsahair.co.za                 → tenant (ACTIVE business_domains row, or the
 *                                         legacy Business.customDomain column — STOREFRONT)
 *   anything else                       → platform_root (see step 6 for why not a 404)
 *
 * Only ACTIVE businesses ever resolve. Unknown or inactive hosts never fall
 * back to another tenant.
 *
 * ⚠️ RUNTIME: this module queries Postgres via Prisma, so middleware calling
 * `resolveHostname` must run on the Node.js runtime (src/middleware.ts
 * exports `runtime = 'nodejs'`). Prisma cannot run on Edge.
 */

import { prisma } from '@/lib/prisma/client'
import type { DomainSurface } from '@prisma/client'
import { reservedSlugCategory, RESERVED_SLUG_POLICY } from '@/modules/tenant/slug-policy'
import { appOrigin, storefrontDomainSetting, storefrontRootHost } from '@/modules/tenant/storefront-url'
import { BoundedTtlCache } from './bounded-cache'
import { isPlatformAppHost } from './platform-hosts'

export const PLATFORM_DOMAIN = process.env.PLATFORM_DOMAIN ?? 'skhokho.sgdataint.co.za'
export const ADMIN_DOMAIN = process.env.ADMIN_DOMAIN ?? `admin.${PLATFORM_DOMAIN}`

/**
 * Labels that can never resolve as a tenant subdomain. Derived from the one
 * slug policy (src/modules/tenant/slug-policy.ts) so allocation and
 * resolution can never disagree.
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set(Object.values(RESERVED_SLUG_POLICY).flat())

export type ResolvedTenant = {
  id: string
  slug: string
  name: string
  status: string
  customDomain: string | null
}

/** A parsed platform subdomain: the business slug plus which surface it names. */
export type SubdomainMatch = { slug: string; surface: DomainSurface }

/** Which root a platform subdomain sat under — decides canonical redirects. */
type RootKind = 'storefront' | 'legacy' | 'localhost'

export type RedirectReason = 'storefront_apex' | 'legacy_subdomain' | 'slug_moved' | 'canonical_domain'

export type HostnameResolution =
  | { type: 'platform_admin' }
  | { type: 'platform_root' }
  | { type: 'tenant'; tenant: ResolvedTenant; surface: DomainSurface }
  /** `host` with the request's own path/query kept, unless `url` (absolute) is given. */
  | { type: 'redirect'; reason: RedirectReason; host?: string; url?: string }
  | { type: 'not_found'; reason: string }

// ---------------------------------------------------------------------------
// Request headers middleware injects for tenant requests. Middleware deletes
// every one of these from the INCOMING request on every branch, so a client
// can never supply them — they're only ever trustworthy because of that.
// ---------------------------------------------------------------------------

export const TENANT_HEADERS = {
  id: 'x-tenant-id',
  slug: 'x-tenant-slug',
  name: 'x-tenant-name',
  surface: 'x-tenant-surface',
} as const

export const TENANT_HEADER_NAMES: readonly string[] = Object.values(TENANT_HEADERS)

const SURFACES: ReadonlySet<string> = new Set<DomainSurface>(['STOREFRONT', 'BOOKINGS', 'ADMIN'])

/**
 * The tenant middleware resolved for this request from its hostname, or null
 * on the platform host. For Server Components / route handlers that sit
 * behind middleware (NOT /api/*, which the middleware matcher skips — API
 * routes resolve the host themselves, see storefront-request.ts).
 */
export function tenantFromHeaders(h: Headers): { id: string; slug: string; surface: DomainSurface } | null {
  const id = h.get(TENANT_HEADERS.id)
  const slug = h.get(TENANT_HEADERS.slug)
  const surface = h.get(TENANT_HEADERS.surface)
  if (!id || !slug || !surface || !SURFACES.has(surface)) return null
  return { id, slug, surface: surface as DomainSurface }
}

// ---------------------------------------------------------------------------
// Cache — hostname lookups happen on every request, tenants change rarely.
// Bounded (see bounded-cache.ts): the key is the attacker-controlled Host.
// Per instance: other instances converge within the TTL after a change.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000
export const MAX_CACHE_ENTRIES = 1_000
const cache = new BoundedTtlCache<unknown>(MAX_CACHE_ENTRIES, CACHE_TTL_MS)
const cacheGet = <T>(key: string) => cache.get(key) as T | undefined
const cacheSet = (key: string, value: unknown) => cache.set(key, value)

/** Drop a hostname from the cache — call after a tenant's slug/domain changes. */
export function invalidateHostname(hostname: string): void {
  cache.delete(normalizeHostname(hostname))
}

export function clearHostnameCache(): void {
  cache.clear()
}

// ---------------------------------------------------------------------------
// Hostname parsing
// ---------------------------------------------------------------------------

/** Strip port/FQDN trailing dot and lowercase. `Nomsa.SKHOKHO.co.za.:3000` → `nomsa.skhokho.co.za` */
export function normalizeHostname(hostname: string): string {
  return hostname.split(':')[0].trim().toLowerCase().replace(/\.$/, '')
}

/**
 * Split a raw subdomain label on a trailing `.bookings` / `.admin` surface
 * infix. `nomsa.bookings` → `{ slug: "nomsa", surface: "BOOKINGS" }`;
 * `nomsa` alone → `{ slug: "nomsa", surface: "STOREFRONT" }`. A label with
 * a dot that isn't a recognized surface infix is treated as one opaque slug
 * (which can never exist — slugs can't contain dots) rather than guessed at.
 */
function parseSurfaceInfix(label: string): SubdomainMatch {
  const lastDot = label.lastIndexOf('.')
  if (lastDot === -1) return { slug: label, surface: 'STOREFRONT' }

  const prefix = label.slice(0, lastDot)
  const infix = label.slice(lastDot + 1)
  if (infix === 'bookings') return { slug: prefix, surface: 'BOOKINGS' }
  if (infix === 'admin') return { slug: prefix, surface: 'ADMIN' }
  return { slug: label, surface: 'STOREFRONT' }
}

/** Every root a tenant subdomain may sit under, most canonical first. */
function platformRoots(): { root: string; kind: RootKind }[] {
  const roots: { root: string; kind: RootKind }[] = []
  const storefront = storefrontRootHost()
  const legacy = normalizeHostname(PLATFORM_DOMAIN)
  if (storefront && storefront !== 'localhost') roots.push({ root: storefront, kind: 'storefront' })
  if (legacy !== storefront) roots.push({ root: legacy, kind: 'legacy' })
  return roots
}

function matchPlatformSubdomain(host: string): (SubdomainMatch & { root: string; kind: RootKind }) | null {
  const normalized = normalizeHostname(host)

  // Local development: <slug>[.surface].localhost
  if (normalized.endsWith('.localhost')) {
    const sub = normalized.slice(0, -'.localhost'.length)
    return sub ? { ...parseSurfaceInfix(sub), root: 'localhost', kind: 'localhost' } : null
  }

  for (const { root, kind } of platformRoots()) {
    if (normalized === root || !normalized.endsWith(`.${root}`)) continue
    const sub = normalized.slice(0, -(root.length + 1))
    if (sub) return { ...parseSurfaceInfix(sub), root, kind }
  }
  return null
}

/**
 * Return the parsed slug+surface if `host` sits under a platform root (the
 * storefront domain or the legacy platform domain), else null. Handles
 * localhost development (`nomsa.localhost`, `nomsa.bookings.localhost`).
 */
export function extractSubdomain(host: string): SubdomainMatch | null {
  const match = matchPlatformSubdomain(host)
  return match ? { slug: match.slug, surface: match.surface } : null
}

/** Rebuild a platform hostname for `slug`, keeping the surface infix and root. */
function platformHost(slug: string, surface: DomainSurface, root: string): string {
  const infix = surface === 'BOOKINGS' ? '.bookings' : surface === 'ADMIN' ? '.admin' : ''
  return `${slug}${infix}.${root}`
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export async function resolveHostname(hostname: string): Promise<HostnameResolution> {
  const host = normalizeHostname(hostname)

  if (!host) return { type: 'not_found', reason: 'Empty Host header' }

  const cached = cacheGet<HostnameResolution>(host)
  if (cached) return cached

  const resolution = await resolveUncached(host)
  // Errors throw before reaching here, so transient failures are never cached.
  cacheSet(host, resolution)
  return resolution
}

const TENANT_SELECT = { id: true, slug: true, name: true, status: true, customDomain: true } as const

async function resolveUncached(host: string): Promise<HostnameResolution> {
  const platform = normalizeHostname(PLATFORM_DOMAIN)
  const admin = normalizeHostname(ADMIN_DOMAIN)
  const storefrontRoot = storefrontRootHost()

  // 1. Platform admin (the platform's own admin, not a business's ADMIN
  // surface — that's `<slug>.admin.<platform>`, handled in step 4 below)
  if (host === admin || host === 'admin.localhost') {
    return { type: 'platform_admin' }
  }

  // 2. Marketing root
  if (host === platform || host === `www.${platform}` || host === 'localhost') {
    return { type: 'platform_root' }
  }

  // 2b. The bare storefront domain hosts no business and no console — the
  // console stays on the platform host so its host-only session cookies are
  // never sent to merchant storefronts.
  if (storefrontRoot && storefrontRoot !== 'localhost' && (host === storefrontRoot || host === `www.${storefrontRoot}`)) {
    return { type: 'redirect', reason: 'storefront_apex', url: `${appOrigin()}/` }
  }

  // 3. Tenant by verified custom domain (business_domains) — checked before
  // subdomain parsing since a merchant-owned hostname has no relation to any
  // platform root. Only ACTIVE rows resolve — PENDING/VERIFYING/FAILED/
  // REVOKED domains must not route traffic.
  const domainRow = await prisma.businessDomain.findFirst({
    // Exact match only. An apex hostname and its www hostname are separate
    // globally unique mappings and may legitimately belong to different
    // businesses. Treating www as an implicit alias makes resolution
    // nondeterministic when both rows exist and can cross tenant boundaries.
    where: { hostname: host, status: 'ACTIVE' },
    select: { surface: true, isPrimary: true, business: { select: TENANT_SELECT } },
  })
  if (domainRow) {
    if (domainRow.business.status !== 'ACTIVE') {
      return { type: 'not_found', reason: `Business is ${domainRow.business.status.toLowerCase()}` }
    }
    // One canonical custom address per surface: the others (apex ⇄ www)
    // send visitors to it — same business, guaranteed by the lookup above.
    if (!domainRow.isPrimary) {
      const primary = await prisma.businessDomain.findFirst({
        where: { businessId: domainRow.business.id, surface: domainRow.surface, isPrimary: true, status: 'ACTIVE' },
        select: { hostname: true },
      })
      if (primary && primary.hostname !== host) return { type: 'redirect', reason: 'canonical_domain', host: primary.hostname }
    }
    return { type: 'tenant', tenant: domainRow.business, surface: domainRow.surface }
  }

  // 4. Tenant by platform-issued subdomain, surface-aware, under either root.
  const subdomain = matchPlatformSubdomain(host)
  if (subdomain) {
    if (reservedSlugCategory(subdomain.slug)) {
      return { type: 'not_found', reason: `Reserved subdomain: ${subdomain.slug}` }
    }

    const tenant = await prisma.business.findUnique({ where: { slug: subdomain.slug }, select: TENANT_SELECT })

    if (!tenant) {
      // A slug the business gave up: send old links to its current address.
      const moved = await findMovedSlug(subdomain.slug)
      if (moved) {
        const root = subdomain.kind === 'legacy' && storefrontDomainSetting() && subdomain.surface === 'STOREFRONT'
          ? storefrontDomainSetting()!
          : subdomain.root
        return { type: 'redirect', reason: 'slug_moved', host: platformHost(moved, subdomain.surface, root) }
      }
      return { type: 'not_found', reason: `No business at ${subdomain.slug}` }
    }
    if (tenant.status !== 'ACTIVE') {
      return { type: 'not_found', reason: `Business is ${tenant.status.toLowerCase()}` }
    }

    // The legacy platform subdomain's storefront has one canonical home once
    // the storefront domain is switched on. Bookings/admin surfaces have no
    // counterpart there yet, so they keep resolving in place.
    const storefrontSetting = storefrontDomainSetting()
    if (subdomain.kind === 'legacy' && subdomain.surface === 'STOREFRONT' && storefrontSetting && storefrontRoot !== 'localhost') {
      return { type: 'redirect', reason: 'legacy_subdomain', host: `${tenant.slug}.${storefrontSetting}` }
    }

    return { type: 'tenant', tenant, surface: subdomain.surface }
  }

  // 5. Tenant by legacy Business.customDomain — kept as a fallback during
  // the business_domains transition (step 3 above supersedes it once a
  // business's domain is backfilled into business_domains). Nothing in the
  // app writes this column any more (UpdateBusinessSchema no longer accepts
  // it), so only rows set before that change can match. STOREFRONT only.
  const legacyTenant = await prisma.business.findFirst({ where: { customDomain: host }, select: TENANT_SELECT })

  if (legacyTenant) {
    if (legacyTenant.status !== 'ACTIVE') {
      return { type: 'not_found', reason: `Business is ${legacyTenant.status.toLowerCase()}` }
    }
    return { type: 'tenant', tenant: legacyTenant, surface: 'STOREFRONT' }
  }

  // 6. The Skhokho app itself (marketing, login, dashboard) only ever renders
  // on a KNOWN platform host — the configured platform/app hosts, local dev,
  // and the deployment's own *.vercel.app / preview URLs (platform-hosts.ts).
  if (isPlatformAppHost(host)) return { type: 'platform_root' }

  // Anything else fails closed. A merchant domain that isn't live yet, or a
  // host nobody configured, must never show the real login page — that
  // would hand a look-alike domain a working phishing copy of the console.
  const pendingDomain = await prisma.businessDomain.findUnique({ where: { hostname: host }, select: { status: true } })
  if (pendingDomain) return { type: 'not_found', reason: `Domain not live yet (${pendingDomain.status.toLowerCase()})` }
  return { type: 'not_found', reason: 'Unknown host' }
}

async function findMovedSlug(slug: string): Promise<string | null> {
  const row = await prisma.businessSlugHistory.findUnique({
    where: { slug },
    select: { business: { select: { slug: true, status: true } } },
  })
  if (!row || row.business.status !== 'ACTIVE') return null
  return row.business.slug
}

export type StorefrontPathResolution = { type: 'current' } | { type: 'moved'; slug: string } | { type: 'unknown' }

/**
 * For the legacy /store/<slug> path on the platform host: is `slug` a live
 * slug, a retired one (→ 308 to the current slug), or unknown (the page's
 * own notFound handles it)? Shares the bounded cache under a `path:` key,
 * which can never collide with a hostname (hostnames never contain ':').
 */
export async function resolveStorefrontPathSlug(slug: string): Promise<StorefrontPathResolution> {
  const key = `path:${slug}`
  const cached = cacheGet<StorefrontPathResolution>(key)
  if (cached) return cached

  let resolution: StorefrontPathResolution
  const live = await prisma.business.findUnique({ where: { slug }, select: { id: true } })
  if (live) {
    resolution = { type: 'current' }
  } else {
    const moved = await findMovedSlug(slug)
    resolution = moved ? { type: 'moved', slug: moved } : { type: 'unknown' }
  }

  cacheSet(key, resolution)
  return resolution
}
