/**
 * Buying a domain through Skhokho.
 *
 *   search → quote (AWAITING_PAYMENT) → merchant pays → REGISTERING
 *          → REGISTERED (merchant is the registrant) → connected automatically
 *          → renewals / auto-renew → transfer away any time
 *
 * The merchant pays for the domain. That payment is PLATFORM billing (the
 * merchant paying Skhokho), never a merchant's customer payment — so
 * `completePurchase` is the hook platform billing calls once it has
 * confirmed payment. Nothing is registered before that, and there is no way
 * to reach it from the dashboard except the sandbox registrar's simulated
 * payment on non-production environments.
 *
 * The merchant is always the registrant; their contact is what's sent to
 * the registrar. They can retrieve the transfer code and move the domain to
 * any registrar — Skhokho never locks them in.
 */

import { prisma } from '@/lib/prisma/client'
import { normalizeHostname } from '@/lib/tenant/context'
import { addDomain, isValidCustomDomainHostname } from './domain.service'
import { apexOf, labelFromQuery, publicSuffix } from './domain-names'
import { getRegistrar, type DomainQuote, type RegistrantContact } from './registrar'

/** Domains expiring within this window without auto-renew are flagged RENEWAL_DUE. */
export const RENEWAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_SEARCH_RESULTS = 6
const LIVE_STATUSES = ['AWAITING_PAYMENT', 'REGISTERING', 'REGISTERED', 'RENEWAL_DUE'] as const

export class RegistrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RegistrationError'
  }
}

export interface DomainSearch {
  /** False when this environment can't sell domains — connect one you own instead. */
  offered: boolean
  registrarName: string
  results: DomainQuote[]
}

/** "Kota Tainment" → kotatainment.co.za, kota-tainment.co.za, … with live availability. */
export async function searchDomains(businessId: string, query: string): Promise<DomainSearch> {
  const registrar = getRegistrar()
  if (!registrar.offersPurchase) return { offered: false, registrarName: registrar.name, results: [] }

  const typed = normalizeHostname(query.trim())
  const candidates = new Set<string>()
  if (typed.includes('.') && isValidCustomDomainHostname(typed) && registrar.supportedSuffixes.includes(publicSuffix(typed))) {
    candidates.add(apexOf(typed))
  }
  for (const label of [labelFromQuery(query), labelFromQuery(query, true)]) {
    if (label.length < 2) continue
    for (const suffix of registrar.supportedSuffixes) candidates.add(`${label}.${suffix}`)
  }

  const names = [...candidates].filter(isValidCustomDomainHostname).slice(0, MAX_SEARCH_RESULTS)
  const [quotes, claimed] = await Promise.all([
    Promise.all(names.map((name) => registrar.checkAvailability(name))),
    // Already bought or connected on Skhokho (by anyone) — not for sale here.
    prisma.domainRegistration.findMany({ where: { domain: { in: names }, status: { in: [...LIVE_STATUSES] } }, select: { domain: true, businessId: true } }),
  ])
  const takenHere = new Set(claimed.map((c) => c.domain))
  return {
    offered: true,
    registrarName: registrar.name,
    results: quotes.map((q) => (takenHere.has(q.domain) ? { domain: q.domain, available: false, reason: 'TAKEN' as const } : q)),
  }
}

/** Locks in a price and waits for payment. Nothing is registered yet. */
export async function startPurchase(
  businessId: string,
  input: { domain: string; years?: number; registrant: RegistrantContact },
) {
  const registrar = getRegistrar()
  if (!registrar.offersPurchase) throw new RegistrationError('Buying domains through Skhokho isn’t available yet — you can connect a domain you already own.')

  const domain = normalizeHostname(input.domain)
  if (!isValidCustomDomainHostname(domain) || apexOf(domain) !== domain) throw new RegistrationError('Choose a domain name like yourbusiness.co.za.')
  const years = Math.min(Math.max(Math.trunc(input.years ?? 1), 1), 5)
  const name = input.registrant.name.trim()
  const email = input.registrant.email.trim().toLowerCase()
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RegistrationError('The domain is registered in your name — enter your full name and a working email address.')
  }

  const quote = await registrar.checkAvailability(domain)
  if (!quote.available || quote.registerPriceCents === undefined) throw new RegistrationError(`${domain} isn't available to buy.`)

  try {
    return await prisma.domainRegistration.create({
      data: {
        businessId,
        domain,
        registrarKey: registrar.key,
        status: 'AWAITING_PAYMENT',
        registrantName: name,
        registrantEmail: email,
        years,
        priceCents: quote.registerPriceCents * years,
        renewalPriceCents: quote.renewPriceCents ?? null,
        currency: quote.currency ?? 'ZAR',
      },
    })
  } catch (e) {
    // The partial unique index: someone already has this domain mid-purchase or registered.
    if ((e as { code?: string }).code === 'P2002') throw new RegistrationError(`${domain} is already being bought.`)
    throw e
  }
}

/**
 * Called by PLATFORM BILLING after it has confirmed the merchant paid
 * (`paymentReference` is that payment). Registers the domain in the
 * merchant's name, then connects it — ownership proven by the registration
 * itself. Idempotent: a repeated call for a registration already past
 * AWAITING_PAYMENT does nothing.
 */
export async function completePurchase(registrationId: string, paymentReference: string) {
  const claimed = await prisma.domainRegistration.updateMany({
    where: { id: registrationId, status: 'AWAITING_PAYMENT' },
    data: { status: 'REGISTERING', paymentReference },
  })
  const registration = await prisma.domainRegistration.findUniqueOrThrow({ where: { id: registrationId } })
  if (claimed.count === 0) return registration

  const registrar = getRegistrar()
  if (registrar.key !== registration.registrarKey) {
    return prisma.domainRegistration.update({
      where: { id: registrationId },
      data: { status: 'FAILED', lastError: `Registrar ${registration.registrarKey} is no longer configured — refund due.` },
    })
  }

  try {
    const result = await registrar.register({
      domain: registration.domain,
      years: registration.years,
      registrant: { name: registration.registrantName, email: registration.registrantEmail },
    })
    const registered = await prisma.domainRegistration.update({
      where: { id: registrationId },
      data: { status: 'REGISTERED', registrarDomainId: result.registrarDomainId, expiresAt: result.expiresAt, registeredAt: new Date(), lastError: null },
    })
    // Connect apex + www, ownership proven by the registration. The domain is
    // already the merchant's at this point — a connection problem is recorded
    // on the registration, never turns it into a failed purchase.
    try {
      await addDomain(registration.businessId, { hostname: registration.domain, includePartner: true }, { method: 'REGISTRAR', registrationId })
    } catch (connectError) {
      return prisma.domainRegistration.update({
        where: { id: registrationId },
        data: { lastError: `Registered, but connecting it to your storefront failed: ${(connectError as Error).message}`.slice(0, 300) },
      })
    }
    return registered
  } catch (e) {
    // Paid but not registered: needs a human (retry or refund). Never silent.
    console.error('[domains] registration failed after payment', registrationId, e)
    return prisma.domainRegistration.update({
      where: { id: registrationId },
      data: { status: 'FAILED', lastError: `${(e as Error).message}`.slice(0, 300) },
    })
  }
}

/** The merchant backs out before paying. */
export async function cancelPurchase(businessId: string, registrationId: string): Promise<void> {
  const updated = await prisma.domainRegistration.updateMany({
    where: { id: registrationId, businessId, status: 'AWAITING_PAYMENT' },
    data: { status: 'CANCELLED' },
  })
  if (updated.count === 0) throw new RegistrationError('That purchase can no longer be cancelled.')
}

export async function listRegistrations(businessId: string) {
  return prisma.domainRegistration.findMany({ where: { businessId }, orderBy: { createdAt: 'desc' } })
}

async function ownRegistered(businessId: string, registrationId: string) {
  const registration = await prisma.domainRegistration.findFirst({
    where: { id: registrationId, businessId, status: { in: ['REGISTERED', 'RENEWAL_DUE', 'EXPIRED'] } },
  })
  if (!registration?.registrarDomainId) throw new RegistrationError('That domain registration could not be found.')
  return registration as typeof registration & { registrarDomainId: string }
}

/** Pulls expiry, auto-renew and registrant state from the registrar and derives renewal status. */
export async function syncRegistration(businessId: string, registrationId: string, now: Date = new Date()) {
  const registration = await ownRegistered(businessId, registrationId)
  const status = await getRegistrar().getStatus(registration.registrarDomainId)
  const expired = status.state === 'EXPIRED' || (status.expiresAt !== null && status.expiresAt <= now)
  const due = !status.autoRenew && status.expiresAt !== null && status.expiresAt.getTime() - now.getTime() < RENEWAL_WINDOW_MS
  return prisma.domainRegistration.update({
    where: { id: registration.id },
    data: {
      status: status.state === 'TRANSFERRED_OUT' ? 'TRANSFERRED_OUT' : expired ? 'EXPIRED' : due ? 'RENEWAL_DUE' : 'REGISTERED',
      expiresAt: status.expiresAt,
      autoRenew: status.autoRenew,
      lastSyncedAt: now,
    },
  })
}

export async function setAutoRenew(businessId: string, registrationId: string, autoRenew: boolean) {
  const registration = await ownRegistered(businessId, registrationId)
  await getRegistrar().setAutoRenew(registration.registrarDomainId, autoRenew)
  return syncRegistration(businessId, registrationId)
}

/**
 * The transfer (EPP/auth) code, so the merchant can move their domain to any
 * registrar. Fetched live and never stored. Owner-only at the action layer.
 */
export async function getTransferCode(businessId: string, registrationId: string): Promise<string> {
  const registration = await ownRegistered(businessId, registrationId)
  return getRegistrar().getTransferCode(registration.registrarDomainId)
}
