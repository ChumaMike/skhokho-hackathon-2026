/**
 * Domain Service — custom domains a business connects (or buys) for its
 * storefront, alongside its free <slug>.<storefront domain> address.
 *
 * State machine per hostname (business_domains):
 *
 *   PENDING ──(ownership proven)──▶ VERIFYING ──(DNS points at us + SSL ready)──▶ ACTIVE
 *      ▲                                                                            │
 *      └──────────── re-verified ◀── FAILED ◀── (ownership lost on re-check, ×3) ───┘
 *
 * Only ACTIVE routes traffic (src/lib/tenant/context.ts). Ownership is proven
 * by a TXT record only the domain's controller can publish (ownership.ts),
 * or by having registered it for this business ourselves — never by a Host
 * header, a form field, or a hosting provider accepting the name. Every
 * function is scoped by the caller's businessId (from the signed session).
 *
 * The hosting project only learns about a hostname AFTER ownership is
 * proven (checkDomain attaches it), so an unverified claim never gets a
 * certificate or traffic. A hostname is only ever detached by the row that
 * attached it (providerAttached) — never a platform host, never a hostname
 * that was already on the project.
 */

import { z } from 'zod'
import type { BusinessDomain, DomainSurface, DomainVerificationMethod, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma/client'
import { clearHostnameCache, invalidateHostname, normalizeHostname } from '@/lib/tenant/context'
import { isPlatformOwnedHost } from '@/lib/tenant/platform-hosts'
import { getHostingProvider, type DnsRecord } from './domain-provider'
import { apexOf, challengeName, challengeValue, wwwPartner } from './domain-names'
import { checkTxtOwnership, mintVerificationToken, type OwnershipCheck } from './ownership'

const RESERVED_TLDS = new Set(['local', 'localhost', 'internal', 'test', 'example', 'invalid'])
const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/
const LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/

/** An unverified claim by another business blocks a hostname this long, then can be taken over by its real owner. */
export const CLAIM_TTL_MS = 72 * 60 * 60 * 1000
/** Consecutive failed ownership re-checks before an ACTIVE domain stops routing. */
export const MAX_FAILED_CHECKS = 3
/** How often live domains are re-verified. */
export const RECHECK_INTERVAL_MS = 12 * 60 * 60 * 1000

/**
 * Rejects malformed, localhost, private/reserved, and platform-owned
 * hostnames before a `BusinessDomain` row is ever created.
 */
export function isValidCustomDomainHostname(rawHost: string): boolean {
  const host = normalizeHostname(rawHost)
  if (!host || host.length > 253) return false
  if (host.includes(':')) return false // IPv6 literal — normalizeHostname only strips a numeric :port
  if (IPV4_PATTERN.test(host)) return false
  if (host === 'localhost' || host.endsWith('.localhost')) return false

  const labels = host.split('.')
  if (labels.length < 2) return false // require an actual registrable domain, not a bare label
  if (!labels.every((label) => LABEL_PATTERN.test(label))) return false
  if (RESERVED_TLDS.has(labels[labels.length - 1])) return false

  // Nothing under a platform-owned domain (app, admin, api, www, mail, the
  // storefront root, hosting-provider domains…) — see platform-hosts.ts.
  if (isPlatformOwnedHost(host)) return false

  return true
}

export const AddDomainSchema = z.object({
  hostname: z.string().min(1).max(253).refine(isValidCustomDomainHostname, {
    message: 'Enter a real domain name you own (not a Skhokho address, an IP, or a local/test domain).',
  }),
  surface: z.enum(['STOREFRONT', 'BOOKINGS', 'ADMIN']).default('STOREFRONT'),
  /** Also connect the www/apex partner (kotatainment.co.za ⇄ www.kotatainment.co.za). */
  includePartner: z.boolean().default(true),
})

export class DomainUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DomainUnavailableError'
  }
}

export class DomainNotFoundError extends Error {
  constructor() {
    super('Domain not found')
    this.name = 'DomainNotFoundError'
  }
}

export async function listDomains(businessId: string) {
  return prisma.businessDomain.findMany({
    // A REVOKED row is a removed domain kept only so re-adding can't renew the claim window (Tab 5).
    where: { businessId, status: { not: 'REVOKED' } },
    orderBy: [{ surface: 'asc' }, { isPrimary: 'desc' }, { createdAt: 'asc' }],
    include: { registration: { select: { id: true, status: true, domain: true } } },
  })
}

/**
 * Whether `hostname` may be claimed by `businessId`, clearing another
 * business's abandoned (unverified, older than the claim window) claim.
 * Returns the stale row to release, if any. Throws if it's genuinely held.
 */
async function claimable(
  tx: Prisma.TransactionClient,
  hostname: string,
  businessId: string,
  now: Date,
  /** Registered for this business ourselves — proof that outranks any unverified claim. */
  provenByRegistration = false,
): Promise<{ ownRow: BusinessDomain | null; stale: BusinessDomain | null }> {
  // A hostname another business still routes through the legacy column.
  const legacyOwner = await tx.business.findFirst({ where: { customDomain: hostname, id: { not: businessId } }, select: { id: true } })
  if (legacyOwner) {
    throw new DomainUnavailableError(`${hostname} is already connected to another Skhokho business. If it's yours, contact support.`)
  }

  const existing = await tx.businessDomain.findUnique({ where: { hostname } })
  if (!existing) return { ownRow: null, stale: null }
  if (existing.businessId === businessId) return { ownRow: existing, stale: null }
  // Tab 5 — a domain its previous claimant removed holds nothing for anyone else.
  if (existing.status === 'REVOKED') return { ownRow: null, stale: existing }
  if (existing.ownershipStatus === 'VERIFIED' || existing.status === 'ACTIVE') {
    throw new DomainUnavailableError(`${hostname} is already connected to another Skhokho business. If it's yours, contact support.`)
  }
  if (!provenByRegistration && existing.createdAt.getTime() > now.getTime() - CLAIM_TTL_MS) {
    throw new DomainUnavailableError(`${hostname} is being connected by another account. If it's yours, please try again in a few days or contact support.`)
  }
  return { ownRow: null, stale: existing }
}

/**
 * Connects a domain (and, by default, its www/apex partner) to a business.
 * Rows start PENDING; nothing routes until checkDomain proves ownership,
 * DNS and SSL. One random token per business+apex, so a single TXT record
 * proves both kotatainment.co.za and www.kotatainment.co.za.
 */
export async function addDomain(
  businessId: string,
  input: z.input<typeof AddDomainSchema>,
  options: { method?: DomainVerificationMethod; registrationId?: string; now?: Date } = {},
): Promise<BusinessDomain[]> {
  const validated = AddDomainSchema.parse(input)
  const now = options.now ?? new Date()
  const hostname = normalizeHostname(validated.hostname)
  const apex = apexOf(hostname)
  const partner = validated.includePartner ? wwwPartner(hostname) : null
  const viaRegistrar = options.method === 'REGISTRAR'

  const released: BusinessDomain[] = []
  const created = await prisma.$transaction(
    async (tx) => {
      // Reuse this business's token for the apex, so one TXT record covers every hostname under it.
      const sibling = await tx.businessDomain.findFirst({ where: { businessId, apexDomain: apex, verificationToken: { not: null } }, select: { verificationToken: true } })
      const token = sibling?.verificationToken ?? mintVerificationToken()

      const rows: BusinessDomain[] = []
      for (const [index, name] of [hostname, partner].entries()) {
        if (!name) continue
        let claim: Awaited<ReturnType<typeof claimable>>
        try {
          claim = await claimable(tx, name, businessId, now, viaRegistrar)
        } catch (e) {
          // The requested hostname must be available; its partner is best-effort.
          if (index === 0) throw e
          continue
        }
        if (claim.ownRow && claim.ownRow.status === 'REVOKED') {
          // Tab 5 — re-adding a domain this business removed REVIVES the row,
          // keeping its original createdAt, so removing and re-adding can never
          // renew the 72h claim window against the real owner. Ownership is
          // proven afresh (the TXT may be gone); the token is kept so an
          // existing record still counts.
          rows.push(
            await tx.businessDomain.update({
              where: { id: claim.ownRow.id },
              data: {
                status: 'PENDING',
                surface: validated.surface,
                isPrimary: false,
                ownershipStatus: viaRegistrar ? 'VERIFIED' : 'PENDING',
                verificationMethod: viaRegistrar ? 'REGISTRAR' : 'DNS_TXT',
                verifiedAt: viaRegistrar ? now : null,
                registrationId: options.registrationId ?? null,
                verificationToken: claim.ownRow.verificationToken ?? token,
                failedChecks: 0,
                lastError: null,
                revokedAt: null,
                activatedAt: null,
              },
            }),
          )
          continue
        }
        if (claim.ownRow) {
          if (index === 0 && !viaRegistrar) throw new DomainUnavailableError(`${name} is already connected to your business.`)
          if (viaRegistrar) {
            rows.push(
              await tx.businessDomain.update({
                where: { id: claim.ownRow.id },
                data: { verificationMethod: 'REGISTRAR', ownershipStatus: 'VERIFIED', verifiedAt: now, registrationId: options.registrationId },
              }),
            )
          }
          continue
        }
        if (claim.stale) {
          released.push(claim.stale)
          await tx.businessDomain.delete({ where: { id: claim.stale.id } })
        }
        rows.push(
          await tx.businessDomain.create({
            data: {
              businessId,
              hostname: name,
              apexDomain: apex,
              surface: validated.surface,
              status: 'PENDING',
              verificationToken: token,
              verificationMethod: viaRegistrar ? 'REGISTRAR' : 'DNS_TXT',
              ownershipStatus: viaRegistrar ? 'VERIFIED' : 'PENDING',
              verifiedAt: viaRegistrar ? now : null,
              registrationId: options.registrationId ?? null,
              provider: getHostingProvider().key,
            },
          }),
        )
      }
      return rows
    },
    { timeout: 15_000, maxWait: 10_000 },
  )

  for (const stale of released) {
    await detachIfOurs(stale)
    invalidateHostname(stale.hostname)
  }
  // Deliberately NOT attached to the hosting project yet: that happens in
  // checkDomain once ownership is proven (or immediately for a domain we
  // registered for this business).
  if (viaRegistrar) {
    for (const row of created) await attachVerified(row)
  }
  return created
}

/**
 * Attaches a hostname whose ownership is proven, recording whether this
 * attachment is ours. Failures are recorded on the row, not thrown.
 */
async function attachVerified(row: BusinessDomain): Promise<void> {
  if (isPlatformOwnedHost(row.hostname)) return
  try {
    const attached = await getHostingProvider().attach(row.hostname)
    await prisma.businessDomain.update({
      where: { id: row.id },
      data: {
        providerId: attached.providerId ?? row.providerId,
        // Once ours, stays ours — a later "already there" reply doesn't change who attached it.
        providerAttached: row.providerAttached || attached.created,
      },
    })
  } catch (e) {
    await prisma.businessDomain.update({ where: { id: row.id }, data: { lastError: (e as Error).message.slice(0, 300) } })
  }
}

/** Detaches a hostname only if this row attached it — never a platform host, never one that was already there. */
async function detachIfOurs(domain: Pick<BusinessDomain, 'hostname' | 'providerAttached'>): Promise<void> {
  if (!domain.providerAttached || isPlatformOwnedHost(domain.hostname)) return
  await getHostingProvider().detach(domain.hostname).catch((e) => console.error('[domains] detach failed', domain.hostname, e))
}

export interface DomainInstructions {
  /** Prove ownership — absent when ownership is already proven (or via the registrar). */
  ownership: DnsRecord | null
  /** Point the domain at the platform. */
  routing: DnsRecord[]
}

/** What the merchant must publish in DNS for one of their domains. */
export async function getDomainDnsInstructions(businessId: string, domainId: string): Promise<DomainInstructions> {
  const domain = await prisma.businessDomain.findFirst({ where: { id: domainId, businessId } })
  if (!domain) throw new DomainNotFoundError()
  const status = await getHostingProvider().status(domain.hostname)
  const ownership =
    domain.ownershipStatus === 'VERIFIED' || !domain.verificationToken
      ? null
      : { type: 'TXT' as const, name: challengeName(domain.hostname), value: challengeValue(domain.verificationToken) }
  return { ownership, routing: status.records }
}

/** Ownership is proven by our TXT challenge, or by an active registration this business holds. */
async function ownershipProven(domain: BusinessDomain): Promise<OwnershipCheck> {
  if (domain.verificationMethod === 'REGISTRAR' && domain.registrationId) {
    const registration = await prisma.domainRegistration.findFirst({
      where: { id: domain.registrationId, businessId: domain.businessId, status: { in: ['REGISTERED', 'RENEWAL_DUE'] } },
      select: { id: true },
    })
    if (registration) return { verified: true }
    // Registration lapsed or moved away — fall back to the TXT proof like any connected domain.
  }
  if (!domain.verificationToken) return { verified: false, reason: 'No ownership challenge for this domain.' }
  return checkTxtOwnership(domain.hostname, domain.verificationToken)
}

/**
 * Checks one domain end to end and moves it through the state machine.
 * Returns the updated row. Safe to call repeatedly ("Check now").
 */
export async function checkDomain(businessId: string, domainId: string, now: Date = new Date()): Promise<BusinessDomain> {
  const domain = await prisma.businessDomain.findFirst({ where: { id: domainId, businessId } })
  if (!domain) throw new DomainNotFoundError()
  if (domain.status === 'REVOKED') throw new DomainUnavailableError('This domain was removed and must be connected again.')

  const ownership = await ownershipProven(domain)
  // Tab 5 — the resolver failed (SERVFAIL, timeout): nothing is known, so no
  // state moves and no failed check is counted. The row records the problem
  // and is simply due again next sweep.
  if (!ownership.verified && ownership.transient) {
    const unchanged = await prisma.businessDomain.update({
      where: { id: domain.id },
      data: { lastError: ownership.reason, lastCheckedAt: now },
    })
    return unchanged
  }
  // Ownership proven and not yet attached by us: attach now — never before.
  if (ownership.verified && !domain.providerAttached) {
    await attachVerified(domain)
    Object.assign(domain, await prisma.businessDomain.findUniqueOrThrow({ where: { id: domain.id } }))
  }
  const hosting = await getHostingProvider().status(domain.hostname)
  const live = ownership.verified && hosting.attached && hosting.dnsConfigured && hosting.sslReady
  const wasActive = domain.status === 'ACTIVE'

  let status = domain.status
  let failedChecks = domain.failedChecks
  let lastError: string | null = null

  if (wasActive) {
    // Re-check of a live domain: losing ownership repeatedly stops routing —
    // a domain that changed hands must not keep serving the old business.
    if (!ownership.verified) {
      failedChecks += 1
      lastError = ownership.reason ?? 'Ownership could not be confirmed.'
      if (failedChecks >= MAX_FAILED_CHECKS) status = 'FAILED'
    } else {
      failedChecks = 0
      if (!hosting.dnsConfigured) lastError = 'Your DNS no longer points at Skhokho — customers may not reach this address.'
    }
  } else {
    failedChecks = 0
    status = live ? 'ACTIVE' : ownership.verified ? 'VERIFYING' : 'PENDING'
    lastError = live ? null : !ownership.verified ? ownership.reason ?? null : hosting.error ?? (!hosting.dnsConfigured ? 'Waiting for your DNS to point at Skhokho.' : 'Waiting for the security certificate (HTTPS).')
  }

  const becameActive = status === 'ACTIVE' && !wasActive
  const updated = await prisma.$transaction(async (tx) => {
    let isPrimary = domain.isPrimary
    if (becameActive && !isPrimary) {
      const primary = await tx.businessDomain.findFirst({ where: { businessId, surface: domain.surface, isPrimary: true }, select: { id: true } })
      isPrimary = !primary
    }
    return tx.businessDomain.update({
      where: { id: domain.id },
      data: {
        status,
        isPrimary: status === 'ACTIVE' ? isPrimary : false,
        // Not yet proven is PENDING (the merchant may simply not have added the
        // record yet); only a live domain that LOST its proof becomes FAILED.
        ownershipStatus: ownership.verified ? 'VERIFIED' : wasActive ? (status === 'ACTIVE' ? domain.ownershipStatus : 'FAILED') : 'PENDING',
        dnsStatus: hosting.dnsConfigured ? 'CONFIGURED' : 'MISCONFIGURED',
        sslStatus: hosting.sslReady ? 'ISSUED' : 'PENDING',
        failedChecks,
        lastError,
        lastCheckedAt: now,
        verifiedAt: ownership.verified ? domain.verifiedAt ?? now : domain.verifiedAt,
        activatedAt: becameActive ? now : domain.activatedAt,
      },
    })
  })

  invalidateHostname(domain.hostname)
  return updated
}

/** @deprecated name kept for existing callers — use checkDomain. */
export const verifyDomain = (businessId: string, domainId: string) => checkDomain(businessId, domainId)

/** Makes an ACTIVE domain the canonical address for its surface; the others redirect to it. */
export async function setPrimaryDomain(businessId: string, domainId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const domain = await tx.businessDomain.findFirst({ where: { id: domainId, businessId } })
    if (!domain) throw new DomainNotFoundError()
    if (domain.status !== 'ACTIVE') throw new DomainUnavailableError('Only a live domain can be your main address.')
    await tx.businessDomain.updateMany({ where: { businessId, surface: domain.surface, isPrimary: true }, data: { isPrimary: false } })
    await tx.businessDomain.update({ where: { id: domain.id }, data: { isPrimary: true } })
  })
  clearHostnameCache()
}

/**
 * Disconnects a domain from the platform. Always allowed (on any plan) —
 * a merchant must never be stuck with a domain pointing at us. A domain
 * bought through Skhokho stays the merchant's registration either way.
 */
export async function removeDomain(businessId: string, domainId: string): Promise<void> {
  const domain = await prisma.businessDomain.findFirst({ where: { id: domainId, businessId } })
  if (!domain) throw new DomainNotFoundError()

  // Tab 5 — the row stays, REVOKED, with its original createdAt: re-adding by
  // the same business revives it (no new claim window), and for anyone else a
  // REVOKED row is claimable at once. Routing, the hosting attachment and the
  // primary flag are all released now.
  await prisma.businessDomain.update({
    where: { id: domain.id },
    data: { status: 'REVOKED', isPrimary: false, revokedAt: new Date(), providerAttached: false },
  })
  await detachIfOurs(domain)
  clearHostnameCache()
}

/** The ACTIVE primary hostname for a business's storefront, if any. */
export async function getPrimaryStorefrontHost(businessId: string): Promise<string | null> {
  const row = await prisma.businessDomain.findFirst({
    where: { businessId, surface: 'STOREFRONT' as DomainSurface, isPrimary: true, status: 'ACTIVE' },
    select: { hostname: true },
  })
  return row?.hostname ?? null
}

/**
 * Periodic re-verification of live (and recently failed) domains — run by
 * the cron route. Returns how many were checked and how many stopped routing.
 */
export async function recheckDomains(now: Date = new Date(), limit = 200): Promise<{ checked: number; stoppedRouting: number; released: number }> {
  // Tab 5 — VERIFYING and PENDING rows are re-checked too. A VERIFYING row
  // (ownership proven, DNS/SSL not yet) used to hold the hostname for ever;
  // now its proof is re-read like a live domain's, and it either goes live
  // when DNS/SSL arrive or drops back to PENDING if the proof disappears.
  const due = await prisma.businessDomain.findMany({
    where: {
      status: { in: ['ACTIVE', 'FAILED', 'VERIFYING', 'PENDING'] },
      OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now.getTime() - RECHECK_INTERVAL_MS) } }],
    },
    select: { id: true, businessId: true, status: true },
    orderBy: { lastCheckedAt: 'asc' },
    take: limit,
  })
  let stoppedRouting = 0
  for (const row of due) {
    try {
      const after = await checkDomain(row.businessId, row.id, now)
      if (row.status === 'ACTIVE' && after.status !== 'ACTIVE') stoppedRouting += 1
    } catch (e) {
      console.error('[domains] recheck failed for', row.id, e)
    }
  }
  // Tab 5 — an unproven claim older than the claim window is released
  // outright, so the hostname is free the moment the window ends rather than
  // only when the real owner happens to try again.
  const released = await prisma.businessDomain.updateMany({
    where: { status: 'PENDING', ownershipStatus: { not: 'VERIFIED' }, createdAt: { lt: new Date(now.getTime() - CLAIM_TTL_MS) } },
    data: { status: 'REVOKED', isPrimary: false, revokedAt: now },
  })
  if (released.count > 0) clearHostnameCache()
  return { checked: due.length, stoppedRouting, released: released.count }
}
