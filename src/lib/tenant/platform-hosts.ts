/**
 * The ONE authoritative answer to "is this hostname ours (the platform's)?".
 *
 * Two questions, deliberately separate:
 *
 *   isPlatformOwnedHost(host) — may a merchant ever claim/attach/detach it?
 *     No for anything under a platform-owned registrable domain (apex): the
 *     marketing/app domain, the storefront root, the admin domain, the app
 *     origin, any extra domain the platform declares (PLATFORM_OWNED_DOMAINS),
 *     and hosting-provider domains (*.vercel.app …). Reserving the whole apex
 *     — not a list of label prefixes — means admin., api., www., mail.,
 *     support., billing., login., signup., dashboard., status., docs. and any
 *     future infrastructure host under it are covered without enumerating
 *     them (merchant SUBDOMAINS under the storefront root are separately
 *     governed by the slug policy's reserved labels).
 *
 *   isPlatformAppHost(host) — may the Skhokho app (marketing, login,
 *     dashboard) be served on it? Only exact, known platform hosts. Any other
 *     host that isn't a resolved tenant fails closed — so an attacker's
 *     look-alike domain can never show the real login page.
 */

import { apexOf } from '@/modules/domains/domain-names'

/** Hosting-provider domains a merchant can never own. */
const PROVIDER_SUFFIXES = ['vercel.app', 'vercel.dev', 'vercel.com', 'now.sh']

const DEFAULT_PLATFORM_DOMAIN = 'skhokho.sgdataint.co.za'

function bareHost(raw: string | undefined | null): string | null {
  if (!raw) return null
  let host = raw.trim().toLowerCase()
  if (!host) return null
  host = host.replace(/^[a-z]+:\/\//, '').split('/')[0].replace(/:\d+$/, '').replace(/\.$/, '')
  return host || null
}

function list(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((h) => bareHost(h))
    .filter((h): h is string => Boolean(h))
}

/** Every hostname the platform itself is configured to serve, exactly. */
export function configuredPlatformHosts(): string[] {
  const platform = bareHost(process.env.PLATFORM_DOMAIN) ?? DEFAULT_PLATFORM_DOMAIN
  const admin = bareHost(process.env.ADMIN_DOMAIN) ?? `admin.${platform}`
  const storefront = bareHost(process.env.STOREFRONT_DOMAIN)
  const app = bareHost(process.env.NEXT_PUBLIC_APP_URL)
  return [...new Set([platform, `www.${platform}`, admin, app, storefront, ...list(process.env.PLATFORM_EXTRA_HOSTS)].filter((h): h is string => Boolean(h)))]
}

/** Registrable domains the platform owns outright — nothing under them is a merchant's. */
export function platformOwnedApexes(): string[] {
  const hosts = [...configuredPlatformHosts(), ...list(process.env.PLATFORM_OWNED_DOMAINS)].filter((h) => h !== 'localhost')
  return [...new Set(hosts.map((h) => apexOf(h)))]
}

function underAny(host: string, roots: string[]): boolean {
  return roots.some((root) => host === root || host.endsWith(`.${root}`))
}

export function isPlatformOwnedHost(rawHost: string): boolean {
  const host = bareHost(rawHost)
  if (!host) return true // nothing sensible to claim
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  return underAny(host, [...platformOwnedApexes(), ...PROVIDER_SUFFIXES])
}

/**
 * Hosts on which the Skhokho app itself (not a storefront) may render:
 * the configured platform hosts, local development, and the hosting
 * provider's own deployment/preview URLs (*.vercel.app — only the project
 * owner can point those at this deployment).
 */
export function isPlatformAppHost(rawHost: string): boolean {
  const host = bareHost(rawHost)
  if (!host) return false
  if (host === 'localhost' || host === '127.0.0.1') return true
  if (configuredPlatformHosts().includes(host)) return true
  return host.endsWith('.vercel.app')
}
