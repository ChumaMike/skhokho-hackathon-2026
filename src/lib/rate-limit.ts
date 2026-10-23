/**
 * Rate limiting — ONE implementation, shared across every server instance.
 *
 * Design
 *   Store      Postgres (the database every guarded action already needs),
 *              table rate_limit_buckets. No new vendor. Works across all
 *              serverless instances, unlike an in-memory counter.
 *   Algorithm  Fixed window: one row per (key, window start), incremented
 *              atomically with INSERT … ON CONFLICT DO UPDATE … RETURNING.
 *              Simple, one round trip, exact within a window. (A burst of up
 *              to 2× the limit across a window boundary is possible —
 *              acceptable for abuse control, not billing.)
 *   Keys       sha256(rule + ':' + identifier). Identifiers are the client
 *              IP and, where it matters, the targeted account (email /
 *              business+email / business+phone / staff id). Only the HASH is
 *              stored — no IPs, emails or phone numbers in this table.
 *   Client IP  x-vercel-forwarded-for → x-real-ip → first x-forwarded-for.
 *              Vercel overwrites these at its edge, so a client can't spoof
 *              them (https://vercel.com/docs/headers/request-headers).
 *   Failure    If the limiter's own query fails it ALLOWS the request and
 *              logs. Every guarded action needs the same database anyway,
 *              so failing closed would add nothing but a second outage
 *              mode; failing open never weakens authentication itself.
 *   Cleanup    Rows older than 2 days are deleted by the daily cron.
 *
 * False positives: limits are set well above any human pace (a person
 * mistyping a password a few times, a busy shop's checkout on shared mobile
 * NAT). Per-account limits are stricter than per-IP ones because carrier
 * NAT puts many South African phones behind one IP.
 */

import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma/client'

export interface RateRule {
  limit: number
  windowSeconds: number
}

/** Every limit in one place. */
export const RATE_RULES = {
  // Owner and staff sign-in.
  loginIp: { limit: 30, windowSeconds: 15 * 60 },
  loginAccount: { limit: 10, windowSeconds: 15 * 60 },
  // Account recovery and set-password links.
  recoveryIp: { limit: 10, windowSeconds: 60 * 60 },
  recoveryAccount: { limit: 3, windowSeconds: 60 * 60 },
  tokenUseIp: { limit: 20, windowSeconds: 15 * 60 },
  // Creating a business.
  signupIp: { limit: 5, windowSeconds: 60 * 60 },
  // A customer joining a business's loyalty programme.
  customerRegisterIp: { limit: 30, windowSeconds: 60 * 60 },
  customerRegisterPhone: { limit: 5, windowSeconds: 60 * 60 },
  // Customer sign-in by one-time code: sending a code costs a message, and a
  // code is guessable only by brute force — per IP and per number/address.
  customerCodeIp: { limit: 20, windowSeconds: 15 * 60 },
  customerCodeIdentifier: { limit: 5, windowSeconds: 15 * 60 },
  customerVerifyIp: { limit: 40, windowSeconds: 15 * 60 },
  customerVerifyIdentifier: { limit: 10, windowSeconds: 15 * 60 },
  // Signed-in customer actions (cancel, reorder lookups, joining rewards).
  customerActionIp: { limit: 60, windowSeconds: 10 * 60 },
  // Storefront actions.
  checkoutIp: { limit: 20, windowSeconds: 10 * 60 },
  quoteIp: { limit: 120, windowSeconds: 10 * 60 },
  bookingIp: { limit: 10, windowSeconds: 10 * 60 },
  // Quote / enquiry / pickup / callback forms (Tab 7, api/store/lead).
  leadIp: { limit: 10, windowSeconds: 10 * 60 },
  reviewIp: { limit: 10, windowSeconds: 60 * 60 },
  storefrontEventsIp: { limit: 60, windowSeconds: 60 },
  // AI chat — a person's daily allowance (cost control).
  buddyChatStaff: { limit: 100, windowSeconds: 24 * 60 * 60 },
  // Every external AI call, per person — abuse brake underneath the monthly allowance (src/lib/ai/anthropic.ts).
  aiCallStaff: { limit: 60, windowSeconds: 60 * 60 },
  // Skhokholetha.
  deliveryCodeDriver: { limit: 10, windowSeconds: 10 * 60 },
  driverLocation: { limit: 30, windowSeconds: 60 },
  driverSignupIp: { limit: 5, windowSeconds: 60 * 60 },
  trackingIp: { limit: 120, windowSeconds: 60 },
  documentUploadDriver: { limit: 20, windowSeconds: 60 * 60 },
  // Platform admin second factor: per admin account and per IP.
  adminMfaAccount: { limit: 5, windowSeconds: 15 * 60 },
  adminMfaIp: { limit: 20, windowSeconds: 15 * 60 },
  // One request-triggered dispatch tick per window, platform-wide (dispatch.service.ts).
  dispatchTick: { limit: 1, windowSeconds: 5 },
  // Tab 7 (social products): composing a share card costs CPU; crawlers and share sheets fetch it once per link.
  shareImageIp: { limit: 60, windowSeconds: 60 },
  // Tab 7 (social products): one completed share is one call; a script hammering it only inflates its own shop's number.
  shareCountIp: { limit: 30, windowSeconds: 60 },
} as const satisfies Record<string, RateRule>

export type RateRuleName = keyof typeof RATE_RULES

export interface RateResult {
  allowed: boolean
  /** Seconds until the window resets (when blocked). */
  retryAfterSeconds: number
}

export const RATE_LIMITED_MESSAGE = 'Too many attempts. Please wait a few minutes and try again.'

/** The client IP, as set by Vercel's edge (not spoofable by the client there). */
export function clientIp(source: { headers: Headers } | Headers): string {
  const h = source instanceof Headers ? source : source.headers
  const raw = h.get('x-vercel-forwarded-for') ?? h.get('x-real-ip') ?? h.get('x-forwarded-for') ?? ''
  return raw.split(',')[0].trim() || 'unknown'
}

function bucketKey(rule: RateRuleName, identifier: string): string {
  return createHash('sha256').update(`${rule}:${identifier.trim().toLowerCase()}`).digest('hex')
}

/** Counts one attempt against `rule` for `identifier`. */
export async function consumeRateLimit(rule: RateRuleName, identifier: string, now: Date = new Date()): Promise<RateResult> {
  const { limit, windowSeconds } = RATE_RULES[rule]
  const windowMs = windowSeconds * 1000
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs)
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000))
  try {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "rate_limit_buckets" ("key", "window_start", "count")
      VALUES (${bucketKey(rule, identifier)}, ${windowStart}, 1)
      ON CONFLICT ("key", "window_start") DO UPDATE SET "count" = "rate_limit_buckets"."count" + 1
      RETURNING "count"`
    const count = Number(rows[0]?.count ?? 0)
    // First request over the limit in this window → one security event (not one per request).
    if (count === limit + 1 && rule !== 'dispatchTick') void recordRateLimitTrip(rule, identifier)
    return { allowed: count <= limit, retryAfterSeconds }
  } catch (e) {
    console.error('[rate-limit] limiter unavailable, allowing request:', rule, e instanceof Error ? e.message : e)
    return { allowed: true, retryAfterSeconds: 0 }
  }
}

/**
 * Counts one attempt against each (rule, identifier) pair; blocked if ANY is
 * over its limit. Every pair is counted (so a blocked IP still accrues
 * against the account being targeted). Empty identifiers are skipped.
 */
export async function checkRateLimits(checks: [RateRuleName, string | null | undefined][], now: Date = new Date()): Promise<RateResult> {
  let blocked: RateResult | null = null
  for (const [rule, identifier] of checks) {
    if (!identifier) continue
    const result = await consumeRateLimit(rule, identifier, now)
    if (!result.allowed && (!blocked || result.retryAfterSeconds > blocked.retryAfterSeconds)) blocked = result
  }
  return blocked ?? { allowed: true, retryAfterSeconds: 0 }
}

async function recordRateLimitTrip(rule: RateRuleName, identifier: string) {
  // Lazy import: the audit module imports Prisma and logging; keep this file's import graph small.
  const { securityEvent } = await import('@/modules/platform-admin/audit')
  // The identifier (an IP, email or id) is stored only as part of a one-way hash.
  await securityEvent('rate_limit_triggered', { outcome: 'DENIED', actor: { type: 'anonymous' }, metadata: { rule, subject: bucketKey(rule, identifier).slice(0, 16) } })
}

/** A standard 429 for JSON routes. */
export function rateLimitedResponse(result: RateResult, body: unknown = { ok: false, error: RATE_LIMITED_MESSAGE }): Response {
  return Response.json(body, { status: 429, headers: { 'Retry-After': String(result.retryAfterSeconds) } })
}

/** Deletes finished windows. Run daily. */
export async function purgeRateLimitBuckets(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
  const deleted = await prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: cutoff } } })
  return deleted.count
}

export { HONEYPOT_FIELD, honeypotTripped } from './honeypot'
