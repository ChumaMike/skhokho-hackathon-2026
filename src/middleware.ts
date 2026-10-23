/**
 * Next.js Middleware — Tenant Routing
 *
 * Resolves the Host header server-side (src/lib/tenant/context.ts) and
 * routes the request. ONE storefront route tree serves every address:
 *
 *   kota.skhokholabs.app/basket          → rewrite /store/kota/basket   (canonical)
 *   www.kotatainment.co.za/basket        → rewrite /store/kota/basket   (ACTIVE custom domain)
 *   skhokho.sgdataint.co.za/store/kota   → served as-is                 (legacy / fallback)
 *   kota.skhokho.sgdataint.co.za/…       → 308 kota.skhokholabs.app/…   (once STOREFRONT_DOMAIN is set)
 *   <old-slug> host or /store/<old-slug> → 308 to the current slug
 *   admin.<platform>                     → /platform-admin/…
 *   platform host                        → no rewrite (marketing + console)
 *
 * Tenant safety:
 *  - Every incoming x-tenant-* header is deleted on EVERY branch, then set
 *    only from the server-side resolution — a client can never choose the
 *    tenant a page renders for.
 *  - On a tenant host, every path is pinned under that tenant's own
 *    /store/<slug>. /store/<other-slug>, /dashboard, /login etc. can't be
 *    reached there: they rewrite under the pinned prefix and 404. That also
 *    keeps the console's server actions off merchant hostnames.
 *  - /store/pay|order/<orderId> pass through with the tenant headers set;
 *    those pages refuse orders that belong to another business.
 *
 * ⚠️ RUNTIME: resolveHostname queries Postgres via Prisma, which cannot run
 * on the Edge runtime — this must run on Node (`runtime = 'nodejs'` below).
 * On Next.js 15.5 Node middleware is detected from this export directly.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { DomainSurface } from '@prisma/client'
import {
  resolveHostname,
  resolveStorefrontPathSlug,
  TENANT_HEADERS,
  TENANT_HEADER_NAMES,
  type ResolvedTenant,
} from '@/lib/tenant/context'
import { stripAdminPrefix } from '@/lib/tenant/admin-paths'
import { checkCrossSite } from '@/lib/auth/origin'

export const runtime = 'nodejs'

// Paths that never need tenant resolution. The matcher below already
// excludes _next/favicon at the routing level; this is a second, cheaper
// skip so those paths never trigger a hostname lookup at all.
// /robots.txt and /sitemap.xml are NOT here: on a merchant's own host they
// are that storefront's robots and sitemap (see routeTenantRequest).
const PUBLIC_PATHS = new Set(['/_next', '/static', '/favicon.ico'])

/** Per-storefront crawler files, served by src/app/store/[slug]/{sitemap.xml,robots.txt}. */
const CRAWLER_FILES = new Set(['/sitemap.xml', '/robots.txt'])

/** A request for a file in /public (e.g. /homepage/hero.webp) — never rewritten into a storefront. */
const STATIC_FILE = /\/[^/]+\.[a-z0-9]+$/i

/** /store/<segment> paths that are routes of their own, not a business slug. */
const ORDER_KEYED_SEGMENTS = new Set(['pay', 'order'])

/** A caller-supplied request id is kept only if it looks like one; otherwise a fresh UUID. */
const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/

/**
 * Every request gets a correlation id (`x-request-id`): passed to the page/route
 * (structured logs and audit events record it) and echoed on the response, so
 * a user-reported problem can be traced through the logs.
 */
export async function middleware(request: NextRequest) {
  const incoming = request.headers.get('x-request-id')
  const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID()
  const res = await routeRequest(request, requestId)
  res.headers.set('x-request-id', requestId)
  return res
}

async function routeRequest(request: NextRequest, requestId: string) {
  const { pathname } = request.nextUrl

  // Never trust a client-sent tenant header, on any branch.
  const requestHeaders = new Headers(request.headers)
  for (const name of TENANT_HEADER_NAMES) requestHeaders.delete(name)
  requestHeaders.set('x-request-id', requestId)
  const pass = () => NextResponse.next({ request: { headers: requestHeaders } })

  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith('/_next/')) {
    return pass()
  }

  const resolution = await resolveHostname(request.headers.get('host') ?? '')

  // API routes are never rewritten into a storefront — each binds its own
  // tenant (hostTenantConflict / the signed session). On a host that isn't
  // Skhokho's (unknown, or a merchant domain not live yet) they don't exist
  // at all: no login or registration endpoint on a look-alike domain.
  if (pathname.startsWith('/api/')) {
    if (resolution.type === 'not_found') return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    // ---- Tab 5 ----
    // A state-changing API call that carries one of our session cookies must
    // come from our own site (src/lib/auth/origin.ts): fetch metadata or the
    // Origin header has to agree with the host addressed. The PayFast ITN and
    // cron calls carry no cookie and are untouched; Bearer-token calls are
    // not cookie-authenticated and are untouched. Server actions get the same
    // protection from Next itself.
    const crossSite = checkCrossSite(request)
    if (crossSite.blocked) {
      return NextResponse.json({ ok: false, error: 'Request refused: wrong origin.' }, { status: 403, headers: { 'x-request-id': requestId } })
    }
    // ---- end Tab 5 ----
    return pass()
  }

  switch (resolution.type) {
    case 'platform_admin': {
      // The admin host already lives under /platform-admin. A path that carries
      // the prefix itself (links and redirects written for the platform host)
      // would otherwise be prefixed twice and 404 — send it to the clean URL.
      const stripped = stripAdminPrefix(pathname)
      if (stripped !== null) return sameHostRedirect(stripped, request)
      const url = request.nextUrl.clone()
      url.pathname = `/platform-admin${pathname}`
      return NextResponse.rewrite(url, { request: { headers: requestHeaders } })
    }

    case 'platform_root': {
      // Legacy path route: send a retired slug to the business's current one.
      const match = /^\/store\/([^/]+)(\/.*)?$/.exec(pathname)
      if (match && !ORDER_KEYED_SEGMENTS.has(match[1])) {
        const slugResolution = await resolveStorefrontPathSlug(match[1])
        if (slugResolution.type === 'moved') {
          return sameHostRedirect(`/store/${slugResolution.slug}${match[2] ?? ''}`, request)
        }
      }
      return pass()
    }

    case 'redirect': {
      const url = new URL(resolution.url ?? request.url)
      if (!resolution.url && resolution.host) {
        // A target with its own port (dev: kota.localhost:3002) replaces the
        // whole host; otherwise keep the request's port (none in production).
        if (resolution.host.includes(':')) url.host = resolution.host
        else url.hostname = resolution.host
      }
      return NextResponse.redirect(url, 308)
    }

    case 'tenant':
      return routeTenantRequest(request, requestHeaders, resolution.tenant, resolution.surface)

    case 'not_found':
    default: {
      const url = request.nextUrl.clone()
      url.pathname = '/not-found'
      return NextResponse.rewrite(url, { request: { headers: requestHeaders } })
    }
  }
}

function routeTenantRequest(
  request: NextRequest,
  requestHeaders: Headers,
  tenant: ResolvedTenant,
  surface: DomainSurface,
) {
  const { pathname } = request.nextUrl
  const ownPrefix = `/store/${tenant.slug}`

  // BOOKINGS/ADMIN surfaces resolve correctly but have no page tree of
  // their own yet, so every surface renders the storefront for now; the
  // header lets a later phase branch without touching resolution again.
  requestHeaders.set(TENANT_HEADERS.id, tenant.id)
  requestHeaders.set(TENANT_HEADERS.slug, tenant.slug)
  requestHeaders.set(TENANT_HEADERS.surface, surface)
  const withTenant = { request: { headers: requestHeaders } }

  // ---- Tab 7 (storefront websites): per-storefront crawler files ----
  // kota.skhokholabs.app/sitemap.xml → that storefront's own sitemap (and robots.txt).
  if (CRAWLER_FILES.has(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = `${ownPrefix}${pathname}`
    return NextResponse.rewrite(url, withTenant)
  }

  if (STATIC_FILE.test(pathname)) return NextResponse.next(withTenant)

  // An old-style link carrying this tenant's own prefix (bookmarks, emails,
  // links built before this host existed) → the clean URL on this host.
  if (pathname === ownPrefix || pathname.startsWith(`${ownPrefix}/`)) {
    return sameHostRedirect(pathname.slice(ownPrefix.length) || '/', request)
  }

  const segment = /^\/store\/([^/]+)\//.exec(pathname)?.[1]
  if (segment && ORDER_KEYED_SEGMENTS.has(segment)) return NextResponse.next(withTenant)

  // Any other /store/… (another business's slug, or nothing) does not exist here.
  if (pathname === '/store' || pathname.startsWith('/store/')) {
    const url = request.nextUrl.clone()
    url.pathname = '/not-found'
    return NextResponse.rewrite(url, withTenant)
  }

  const url = request.nextUrl.clone()
  url.pathname = pathname === '/' ? ownPrefix : `${ownPrefix}${pathname}`
  return NextResponse.rewrite(url, withTenant)
}

/**
 * A 308 that stays on the host the visitor actually requested. Built from
 * the Host header (which resolution has already matched) rather than
 * nextUrl's host, which can be an internal/proxy-facing address. Next
 * requires an absolute Location from middleware. Query string is kept.
 */
function sameHostRedirect(path: string, request: NextRequest) {
  const url = request.nextUrl.clone()
  url.pathname = path
  const host = request.headers.get('host')
  if (host) url.host = host
  return NextResponse.redirect(url, 308)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
