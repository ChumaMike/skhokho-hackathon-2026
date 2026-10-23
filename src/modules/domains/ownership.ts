/**
 * Domain ownership proof — the gate before any custom domain may route.
 *
 * A merchant proves control of a domain by publishing a TXT record only the
 * domain's real controller can create:
 *
 *   _skhokho-verify.kotatainment.co.za  TXT  "skhokho-verify=<random token>"
 *
 * The token is random per business-and-domain, so proving one business's
 * claim says nothing about another's. A Host header, a form field, or a
 * hosting provider merely accepting the hostname is never proof.
 */

import { randomBytes } from 'node:crypto'
import { resolveTxt } from 'node:dns/promises'
import { challengeName, challengeValue } from './domain-names'

/** Looks up TXT records: chunks per record, as node:dns returns them. Injectable for tests. */
export type TxtResolver = (name: string) => Promise<string[][]>

let resolverOverride: TxtResolver | null = null

export function setTxtResolverForTests(resolver: TxtResolver | null): void {
  resolverOverride = resolver
}

function resolver(): TxtResolver {
  return resolverOverride ?? resolveTxt
}

/** Unguessable, URL- and DNS-safe. */
export function mintVerificationToken(): string {
  return randomBytes(18).toString('base64url')
}

/** `transient`: the resolver itself failed (SERVFAIL, timeout, refused) — nothing is known about the record, so it must not count as a failed proof. */
export type OwnershipCheck = { verified: true } | { verified: false; reason: string; transient?: boolean }

/** Codes that mean "the record is not there" — a definitive answer. Everything else is the resolver failing to answer. */
const DEFINITIVE_MISSING = new Set(['ENOTFOUND', 'ENODATA'])

export async function checkTxtOwnership(hostname: string, token: string): Promise<OwnershipCheck> {
  const name = challengeName(hostname)
  const expected = challengeValue(token)
  let records: string[][]
  try {
    records = await resolver()(name)
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code && DEFINITIVE_MISSING.has(code)) return { verified: false, reason: `No TXT record found at ${name} yet.` }
    return { verified: false, reason: `Couldn't look up ${name} right now (${code ?? 'DNS error'}).`, transient: true }
  }
  // A TXT record may be split into several strings; they join into one value.
  const values = records.map((chunks) => chunks.join('').trim())
  return values.includes(expected)
    ? { verified: true }
    : { verified: false, reason: `The TXT record at ${name} doesn't match yet. It should be exactly: ${expected}` }
}
