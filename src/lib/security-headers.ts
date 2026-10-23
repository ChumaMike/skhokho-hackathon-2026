/**
 * Content Security Policy, HSTS and Permissions-Policy for every response
 * (Tab 5). Built here, pure, so the policy is unit-tested and next.config.ts
 * only wires it.
 *
 * Posture: a transitional CSP. Scripts are limited to this origin and the
 * Google Maps loader; 'unsafe-inline' remains for scripts because the app
 * has inline scripts (the theme bootstrap in layout.tsx, Next's own
 * hydration data) and no nonce plumbing yet — the next step is a per-request
 * nonce from the middleware. Even so the policy already stops a stray script
 * tag from loading anything off-site, pins form posts to us and PayFast,
 * forbids plugins and base-tag hijacks, and keeps every page out of frames
 * except the console's own storefront preview.
 *
 * External origins the app really uses: Google Maps (loader script + JSON
 * APIs), Vercel Blob (product images), PayFast (form POST navigation only —
 * never framed, never fetched from the browser). Fonts are self-hosted at
 * build time (next/font).
 */

const MAPS = 'https://maps.googleapis.com'
const MAPS_STATIC = 'https://maps.gstatic.com'
const PAYFAST = ['https://www.payfast.co.za', 'https://sandbox.payfast.co.za']
const BLOB = 'https://*.public.blob.vercel-storage.com'

export interface CspOptions {
  /** Development needs eval (React Refresh) and a websocket for HMR. */
  dev: boolean
  /** Who may frame the page: nobody, or the same origin (the console's storefront preview). */
  frameAncestors?: 'none' | 'self'
}

export function buildContentSecurityPolicy(opts: CspOptions): string {
  const frameAncestors = opts.frameAncestors === 'self' ? "'self'" : "'none'"
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", MAPS, ...(opts.dev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", MAPS, MAPS_STATIC, BLOB, ...(opts.dev ? ['ws:', 'wss:'] : [])],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'media-src': ["'self'", 'https:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'", ...PAYFAST],
    'frame-src': ["'none'"],
    'frame-ancestors': [frameAncestors],
  }
  if (!opts.dev) directives['upgrade-insecure-requests'] = []
  return Object.entries(directives)
    .map(([name, values]) => (values.length ? `${name} ${values.join(' ')}` : name))
    .join('; ')
}

/** Two years, subdomains included. `preload` is deliberately left off: submitting the apex to the preload list is a one-way decision for the whole domain. */
export const STRICT_TRANSPORT_SECURITY = 'max-age=63072000; includeSubDomains'

/** The driver workspace uses geolocation; nothing uses camera, microphone or the Payment Request API. */
export const PERMISSIONS_POLICY = 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()'

export interface HeaderPair {
  key: string
  value: string
}

/** The Tab 5 set for every path; the preview path swaps in the frame-able CSP. */
export function securityHeaders(opts: CspOptions): HeaderPair[] {
  return [
    { key: 'Content-Security-Policy', value: buildContentSecurityPolicy(opts) },
    { key: 'Strict-Transport-Security', value: STRICT_TRANSPORT_SECURITY },
    { key: 'Permissions-Policy', value: PERMISSIONS_POLICY },
  ]
}
