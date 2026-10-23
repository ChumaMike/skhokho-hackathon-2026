/**
 * Cross-site request check for cookie-authenticated JSON routes.
 *
 * Our session cookies are SameSite=Lax, which already keeps them off
 * cross-site POSTs in modern browsers. This is the second lock: a
 * state-changing request that carries one of our cookies must come from a
 * page on the same site. Browsers always send `Sec-Fetch-Site` (modern) or
 * `Origin` (every browser, on every POST/PUT/PATCH/DELETE), so a forged
 * request from another site can't hide where it came from. Requests with no
 * browser metadata at all (curl, a server, our own HTTP tests) carry no
 * ambient cookie credential a browser added, so they pass through to the
 * route's own session check as before.
 *
 * Bearer-token requests are not cookie-authenticated and are never blocked
 * here. Pure (takes a plain request shape) so it is unit-testable; the
 * middleware applies it to /api/* writes.
 */

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const SESSION_COOKIE_PREFIX = 'skhokho-'

export type CrossSiteVerdict = { blocked: false } | { blocked: true; reason: 'cross_site' | 'origin_mismatch' }

export interface RequestLike {
  method: string
  headers: { get(name: string): string | null }
}

function hostOf(value: string | null): string | null {
  if (!value) return null
  try {
    return new URL(value).host.toLowerCase()
  } catch {
    return null
  }
}

/** The host the request was actually addressed to — the proxy's forwarded host first, then Host. */
export function requestHost(headers: RequestLike['headers']): string | null {
  const forwarded = headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = forwarded || headers.get('host')
  return host ? host.toLowerCase() : null
}

export function hasSessionCookie(headers: RequestLike['headers']): boolean {
  const cookie = headers.get('cookie')
  return Boolean(cookie && cookie.split(';').some((c) => c.trim().startsWith(SESSION_COOKIE_PREFIX)))
}

export function checkCrossSite(req: RequestLike): CrossSiteVerdict {
  if (!STATE_CHANGING.has(req.method.toUpperCase())) return { blocked: false }
  if (!hasSessionCookie(req.headers)) return { blocked: false }
  if (req.headers.get('authorization')?.startsWith('Bearer ')) return { blocked: false }

  // Fetch metadata: definitive when present.
  const site = req.headers.get('sec-fetch-site')?.toLowerCase()
  if (site === 'cross-site') return { blocked: true, reason: 'cross_site' }
  if (site === 'same-origin' || site === 'same-site' || site === 'none') return { blocked: false }

  // Origin: compared against the host the request was addressed to.
  const origin = req.headers.get('origin')
  if (origin === null) return { blocked: false }
  const originHost = hostOf(origin)
  const host = requestHost(req.headers)
  if (!originHost || !host || originHost !== host) return { blocked: true, reason: 'origin_mismatch' }
  return { blocked: false }
}
