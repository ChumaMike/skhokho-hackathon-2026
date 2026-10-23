/**
 * PayFast ITN source check (Tab 5).
 *
 * PayFast documents that a payment notification should be accepted only
 * when it comes from one of its own hosts. The notify route already checks
 * the signature and asks PayFast to validate the body; this is the third
 * lock, applied before anything is read from the database: the caller's IP
 * must resolve from one of PAYFAST_ITN_HOSTS.
 *
 * DNS is resolved at most once an hour per host. If NO host can be resolved
 * at all the verdict is UNAVAILABLE, and the route answers 503 so PayFast
 * retries — a DNS blip must never permanently drop a real payment. Off by
 * default outside production (sandbox tests post from localhost); in
 * production it is on unless PAYFAST_ITN_SOURCE_CHECK=off.
 */

import { resolve4, resolve6 } from 'node:dns/promises'

export const PAYFAST_ITN_HOSTS = ['www.payfast.co.za', 'sandbox.payfast.co.za', 'w1w.payfast.co.za', 'w2w.payfast.co.za'] as const

export type SourceVerdict = 'TRUSTED' | 'UNTRUSTED' | 'UNAVAILABLE' | 'SKIPPED'

export type HostResolver = (host: string) => Promise<string[]>

const CACHE_TTL_MS = 60 * 60 * 1000
const cache = new Map<string, { ips: string[]; expiresAt: number }>()
let resolverOverride: HostResolver | null = null

export function setPayfastResolverForTests(resolver: HostResolver | null): void {
  resolverOverride = resolver
  cache.clear()
}

async function defaultResolver(host: string): Promise<string[]> {
  const [v4, v6] = await Promise.allSettled([resolve4(host), resolve6(host)])
  const ips = [...(v4.status === 'fulfilled' ? v4.value : []), ...(v6.status === 'fulfilled' ? v6.value : [])]
  if (ips.length === 0) throw (v4.status === 'rejected' ? v4.reason : v6.status === 'rejected' ? v6.reason : new Error('no addresses'))
  return ips
}

async function resolveHost(host: string, now: number): Promise<string[] | null> {
  const hit = cache.get(host)
  if (hit && hit.expiresAt > now) return hit.ips
  try {
    const ips = (await (resolverOverride ?? defaultResolver)(host)).map(normaliseIp)
    cache.set(host, { ips, expiresAt: now + CACHE_TTL_MS })
    return ips
  } catch {
    // A stale answer beats no answer: keep serving the last known set.
    return hit?.ips ?? null
  }
}

/** Lower-case, strip an IPv4-mapped IPv6 prefix, drop a zone id. */
export function normaliseIp(ip: string): string {
  const trimmed = ip.trim().toLowerCase().split('%')[0]
  return trimmed.startsWith('::ffff:') && /^\d+\.\d+\.\d+\.\d+$/.test(trimmed.slice(7)) ? trimmed.slice(7) : trimmed
}

/** Whether the check runs: production on (unless explicitly off), elsewhere off (unless explicitly on). */
export function sourceCheckEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const flag = env.PAYFAST_ITN_SOURCE_CHECK?.trim().toLowerCase()
  if (flag === 'on' || flag === 'true') return true
  if (flag === 'off' || flag === 'false') return false
  return env.NODE_ENV === 'production'
}

export async function verifyPayfastSource(
  ip: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): Promise<SourceVerdict> {
  if (!sourceCheckEnabled(env)) return 'SKIPPED'
  if (!ip || ip === 'unknown') return 'UNTRUSTED'
  const wanted = normaliseIp(ip)
  const results = await Promise.all(PAYFAST_ITN_HOSTS.map((host) => resolveHost(host, now.getTime())))
  const resolved = results.filter((r): r is string[] => r !== null)
  if (resolved.length === 0) return 'UNAVAILABLE'
  return resolved.some((ips) => ips.includes(wanted)) ? 'TRUSTED' : 'UNTRUSTED'
}
