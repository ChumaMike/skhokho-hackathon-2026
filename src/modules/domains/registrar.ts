/**
 * Registrar integration — an abstraction, deliberately not any one
 * registrar's API. An accredited registrar/reseller (for .co.za, a ZACR
 * accredited registrar) is integrated by implementing `Registrar`; nothing
 * above this file knows which one.
 *
 * Ownership rule, enforced by the shape of this interface: the MERCHANT is
 * always the registrant. `register` takes the merchant's own contact as the
 * registrant; Skhokho only manages the domain through its reseller
 * arrangement, and `getTransferCode` always lets the merchant take it
 * elsewhere.
 *
 *   UnconfiguredRegistrar — default: buying isn't offered on this
 *                           environment; merchants connect a domain they own.
 *   SandboxRegistrar      — tests and staging only. Never contacts a real
 *                           registry; refuses to run in production.
 */

import { randomBytes } from 'node:crypto'

export interface RegistrantContact {
  name: string
  email: string
}

export interface DomainQuote {
  domain: string
  available: boolean
  /** Why it can't be bought here, when it can't. */
  reason?: 'TAKEN' | 'UNSUPPORTED_TLD' | 'NOT_OFFERED' | 'INVALID'
  /** Per year, in cents. */
  registerPriceCents?: number
  renewPriceCents?: number
  currency?: string
}

export interface RegistrationResult {
  registrarDomainId: string
  expiresAt: Date
}

export interface RegistrarDomainStatus {
  state: 'ACTIVE' | 'EXPIRED' | 'PENDING' | 'TRANSFERRED_OUT'
  expiresAt: Date | null
  autoRenew: boolean
  registrant: RegistrantContact
}

export interface Registrar {
  readonly key: string
  readonly name: string
  /** True when merchants can actually buy through it on this environment. */
  readonly offersPurchase: boolean
  /** Public suffixes it can sell, e.g. ['co.za']. */
  readonly supportedSuffixes: string[]
  checkAvailability(domain: string): Promise<DomainQuote>
  register(input: { domain: string; years: number; registrant: RegistrantContact }): Promise<RegistrationResult>
  getStatus(registrarDomainId: string): Promise<RegistrarDomainStatus>
  setAutoRenew(registrarDomainId: string, autoRenew: boolean): Promise<void>
  /** The EPP/auth code the merchant gives their new registrar to move the domain away. */
  getTransferCode(registrarDomainId: string): Promise<string>
}

export class UnconfiguredRegistrar implements Registrar {
  readonly key = 'none'
  readonly name = 'Not configured'
  readonly offersPurchase = false
  readonly supportedSuffixes: string[] = []

  async checkAvailability(domain: string): Promise<DomainQuote> {
    return { domain, available: false, reason: 'NOT_OFFERED' }
  }
  async register(): Promise<RegistrationResult> {
    throw new Error('Buying domains is not available on this environment.')
  }
  async getStatus(): Promise<RegistrarDomainStatus> {
    throw new Error('No registrar is configured.')
  }
  async setAutoRenew(): Promise<void> {
    throw new Error('No registrar is configured.')
  }
  async getTransferCode(): Promise<string> {
    throw new Error('No registrar is configured.')
  }
}

/** Sandbox price: clearly not a real price — staging only. */
export const SANDBOX_PRICE_CENTS = 9_900

/**
 * Staging/test registrar. In memory, deterministic: any name containing
 * "taken" is unavailable; .co.za names are sold for the sandbox price.
 */
export class SandboxRegistrar implements Registrar {
  readonly key = 'sandbox'
  readonly name = 'Sandbox registrar (not real)'
  readonly offersPurchase = true
  readonly supportedSuffixes = ['co.za']
  readonly domains = new Map<string, { domain: string; expiresAt: Date; autoRenew: boolean; registrant: RegistrantContact; state: RegistrarDomainStatus['state'] }>()

  constructor() {
    if (process.env.NODE_ENV === 'production') throw new Error('The sandbox registrar must never run in production.')
  }

  async checkAvailability(domain: string): Promise<DomainQuote> {
    if (!domain.endsWith('.co.za')) return { domain, available: false, reason: 'UNSUPPORTED_TLD' }
    const taken = domain.includes('taken') || [...this.domains.values()].some((d) => d.domain === domain)
    return taken
      ? { domain, available: false, reason: 'TAKEN' }
      : { domain, available: true, registerPriceCents: SANDBOX_PRICE_CENTS, renewPriceCents: SANDBOX_PRICE_CENTS, currency: 'ZAR' }
  }

  async register(input: { domain: string; years: number; registrant: RegistrantContact }): Promise<RegistrationResult> {
    const quote = await this.checkAvailability(input.domain)
    if (!quote.available) throw new Error(`${input.domain} can't be registered (${quote.reason}).`)
    const id = `sbx_${randomBytes(8).toString('hex')}`
    const expiresAt = new Date(Date.now() + input.years * 365 * 24 * 60 * 60 * 1000)
    this.domains.set(id, { domain: input.domain, expiresAt, autoRenew: true, registrant: input.registrant, state: 'ACTIVE' })
    return { registrarDomainId: id, expiresAt }
  }

  private find(id: string) {
    const d = this.domains.get(id)
    if (!d) throw new Error('Unknown sandbox domain.')
    return d
  }

  async getStatus(id: string): Promise<RegistrarDomainStatus> {
    const d = this.find(id)
    return { state: d.state, expiresAt: d.expiresAt, autoRenew: d.autoRenew, registrant: d.registrant }
  }

  async setAutoRenew(id: string, autoRenew: boolean): Promise<void> {
    this.find(id).autoRenew = autoRenew
  }

  async getTransferCode(id: string): Promise<string> {
    this.find(id)
    return `SBX-${randomBytes(6).toString('hex').toUpperCase()}`
  }
}

let override: Registrar | null = null
let sandboxSingleton: SandboxRegistrar | null = null

export function setRegistrarForTests(registrar: Registrar | null): void {
  override = registrar
}

/**
 * DOMAIN_REGISTRAR selects the integration. Only "sandbox" exists today
 * (non-production only); an accredited registrar's adapter plugs in here.
 */
export function getRegistrar(): Registrar {
  if (override) return override
  if (process.env.DOMAIN_REGISTRAR === 'sandbox' && process.env.NODE_ENV !== 'production') {
    return (sandboxSingleton ??= new SandboxRegistrar())
  }
  return new UnconfiguredRegistrar()
}
