/**
 * Per-request storefront context — which tenant (if any) THIS request's
 * hostname resolved to, and therefore how storefront links should be built.
 *
 * Two request paths reach one storefront route tree (src/app/store/[slug]):
 *
 *   skhokho.sgdataint.co.za/store/kota/basket  → links keep the /store/kota prefix
 *   kota.skhokholabs.app/basket                → middleware rewrites to /store/kota/basket;
 *                                                links must NOT carry the prefix
 *
 * Trust: the x-tenant-* headers read here are set by src/middleware.ts after
 * server-side hostname resolution, and middleware deletes any client-sent
 * copies first — so they can't be forged on pages. /api/* is outside the
 * middleware matcher, so API routes never read those headers; they resolve
 * the Host themselves via `hostTenantConflict`.
 */

import { headers } from 'next/headers'
import { resolveHostname, tenantFromHeaders } from './context'
import { legacyStorefrontPath } from '@/modules/tenant/storefront-url'

export type RequestTenant = { id: string; slug: string }

/**
 * Pure core of storefrontBasePath: '' only when this request arrived on
 * `slug`'s OWN tenant host. Any mismatch falls back to the explicit
 * /store/<slug> prefix — which, on a foreign tenant host, middleware 404s,
 * so the fallback can never produce a working cross-tenant link.
 */
export function basePathFor(slug: string, tenant: RequestTenant | null): string {
  return tenant && tenant.slug === slug ? '' : legacyStorefrontPath(slug)
}

/** The tenant middleware resolved for the current page request, or null on the platform host. */
export async function requestTenant(): Promise<RequestTenant | null> {
  const tenant = tenantFromHeaders(await headers())
  return tenant ? { id: tenant.id, slug: tenant.slug } : null
}

/** Link prefix for the current request: '' on the business's own host, '/store/<slug>' otherwise. */
export async function storefrontBasePath(slug: string): Promise<string> {
  return basePathFor(slug, await requestTenant())
}

/**
 * Order-keyed pages (/store/pay, /store/order) are reachable on tenant hosts
 * too. On a tenant host they must only ever show THAT tenant's orders —
 * never let kota.skhokholabs.app/store/order/<B's order> render B's order
 * under A's address. On the platform host, any business's order is fine
 * (the order id itself remains the access secret, as before).
 */
export function orderVisibleOnRequest(orderBusinessId: string, tenant: RequestTenant | null): boolean {
  return !tenant || tenant.id === orderBusinessId
}

/**
 * Public store APIs take businessId from the client by design (no session
 * on a storefront). This binds it to the host: a request arriving on a
 * tenant's hostname may only act on that tenant. On the platform host (the
 * legacy /store/<slug> pages) any ACTIVE business is allowed, as before —
 * the services themselves still refuse inactive businesses.
 *
 * Returns true when the request must be refused.
 */
export async function hostTenantConflict(request: Request, businessId: string): Promise<boolean> {
  const tenant = await apiRequestTenant(request)
  return tenant !== null && tenant.id !== businessId
}

/** The tenant a raw API request's Host resolves to, or null (platform host / unknown). */
export async function apiRequestTenant(request: Request): Promise<RequestTenant | null> {
  const resolution = await resolveHostname(request.headers.get('host') ?? '')
  return resolution.type === 'tenant' ? { id: resolution.tenant.id, slug: resolution.tenant.slug } : null
}
