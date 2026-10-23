/**
 * Hosting providers — the seam between domain.service.ts and whatever
 * actually serves a merchant's domain over HTTPS (attaching it, checking its
 * DNS, issuing its certificate). Ownership is NOT this layer's job: it's
 * proven separately (ownership.ts) by a TXT record only the domain's real
 * controller can publish, or by registering it ourselves.
 *
 *   VercelHostingProvider       — Vercel's documented REST API (projects/domains, domains/config)
 *   UnconfiguredHostingProvider — no credentials: honestly reports "not configured"; nothing can go live
 *   TestHostingProvider         — tests and staging: state set by hand
 *
 * Which one runs is decided once, from the environment (getHostingProvider).
 */

import { isApex } from './domain-names'

export interface DnsRecord {
  type: 'A' | 'CNAME' | 'TXT'
  /** The full DNS name, e.g. www.kotatainment.co.za. */
  name: string
  value: string
}

export interface HostingStatus {
  /** The hosting platform has this hostname attached to the project. */
  attached: boolean
  /** DNS points at the platform. */
  dnsConfigured: boolean
  /** A certificate can be (or has been) issued — HTTPS will work. */
  sslReady: boolean
  /** What the merchant should publish for routing (A/CNAME), plus any platform-side TXT challenge. */
  records: DnsRecord[]
  error?: string
}

export interface HostingProvider {
  readonly key: string
  readonly configured: boolean
  /**
   * Attaches the hostname to the project. `created` is true only when THIS
   * call added it; false when it was already there (on this project or
   * elsewhere). "Already exists" is never proof of anything — and a hostname
   * we didn't attach is never ours to detach.
   */
  attach(hostname: string): Promise<{ providerId?: string; records: DnsRecord[]; created: boolean }>
  status(hostname: string): Promise<HostingStatus>
  detach(hostname: string): Promise<void>
}

/** Vercel's documented defaults when the API gives no recommendation. */
const VERCEL_DEFAULT_A = '76.76.21.21'
const VERCEL_DEFAULT_CNAME = 'cname.vercel-dns.com'

function routingRecords(hostname: string, apex: boolean, ipv4: string, cname: string): DnsRecord[] {
  return apex ? [{ type: 'A', name: hostname, value: ipv4 }] : [{ type: 'CNAME', name: hostname, value: cname }]
}

/**
 * Vercel REST API. Endpoints (docs: vercel.com/docs/rest-api):
 *   POST   /v10/projects/{project}/domains            add a domain to the project
 *   GET    /v9/projects/{project}/domains/{domain}    attached? `verified` + `verification` challenges
 *   POST   /v9/projects/{project}/domains/{domain}/verify
 *   GET    /v6/domains/{domain}/config                `misconfigured` — false means DNS is right AND a
 *                                                     TLS certificate can be generated
 *   DELETE /v9/projects/{project}/domains/{domain}    remove from the project (not from the account)
 */
export class VercelHostingProvider implements HostingProvider {
  readonly key = 'vercel'
  readonly configured = true

  constructor(
    private readonly token: string,
    private readonly projectId: string,
    private readonly teamId: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private url(path: string, extra: Record<string, string> = {}): string {
    const params = new URLSearchParams({ ...(this.teamId ? { teamId: this.teamId } : {}), ...extra })
    const qs = params.toString()
    return `https://api.vercel.com${path}${qs ? `?${qs}` : ''}`
  }

  private async call(method: string, path: string, body?: unknown, extra?: Record<string, string>) {
    const res = await this.fetchImpl(this.url(path, extra), {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: res.ok, status: res.status, json }
  }

  private challenges(json: Record<string, unknown>): DnsRecord[] {
    const list = Array.isArray(json.verification) ? json.verification : []
    return list
      .filter((v): v is { type: string; domain: string; value: string } => typeof v === 'object' && v !== null && 'domain' in v && 'value' in v)
      .filter((v) => v.type === 'TXT')
      .map((v) => ({ type: 'TXT' as const, name: v.domain, value: v.value }))
  }

  async attach(hostname: string) {
    const project = encodeURIComponent(this.projectId)
    const res = await this.call('POST', `/v10/projects/${project}/domains`, { name: hostname })
    // 400/409: it's already attached somewhere (this project, or another).
    // Not an error for the merchant's flow, but NOT an attachment we made.
    if (!res.ok && res.status !== 400 && res.status !== 409) {
      throw new Error(`Hosting provider refused ${hostname} (${res.status}).`)
    }
    const st = await this.status(hostname)
    return { providerId: typeof res.json.name === 'string' ? res.json.name : hostname, records: st.records, created: res.ok }
  }

  async status(hostname: string): Promise<HostingStatus> {
    const project = encodeURIComponent(this.projectId)
    const domain = encodeURIComponent(hostname)
    const [projectDomain, config] = await Promise.all([
      this.call('GET', `/v9/projects/${project}/domains/${domain}`),
      this.call('GET', `/v6/domains/${domain}/config`, undefined, { projectIdOrName: this.projectId }),
    ])

    const attached = projectDomain.ok
    let verified = projectDomain.ok && projectDomain.json.verified === true
    const challenges = projectDomain.ok ? this.challenges(projectDomain.json) : []
    if (attached && !verified && challenges.length > 0) {
      // Ask Vercel to re-check its own challenge (needed when the domain is
      // also known to another Vercel account).
      const v = await this.call('POST', `/v9/projects/${project}/domains/${domain}/verify`)
      verified = v.ok && v.json.verified === true
    }

    const misconfigured = !config.ok || config.json.misconfigured !== false
    const ipv4 = firstValue(config.json.recommendedIPv4) ?? VERCEL_DEFAULT_A
    const cname = firstValue(config.json.recommendedCNAME) ?? VERCEL_DEFAULT_CNAME

    return {
      attached,
      dnsConfigured: attached && !misconfigured,
      sslReady: attached && verified && !misconfigured,
      records: [...routingRecords(hostname, isApex(hostname), ipv4, cname), ...challenges],
      error: attached ? undefined : `Not attached to the hosting project (${projectDomain.status}).`,
    }
  }

  async detach(hostname: string) {
    const res = await this.call('DELETE', `/v9/projects/${encodeURIComponent(this.projectId)}/domains/${encodeURIComponent(hostname)}`)
    if (!res.ok && res.status !== 404) throw new Error(`Hosting provider couldn't release ${hostname} (${res.status}).`)
  }
}

/** recommendedIPv4 / recommendedCNAME come back as ranked lists; take the top value, whatever the exact shape. */
function firstValue(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const first = raw[0] as unknown
  if (typeof first === 'string') return first
  if (first && typeof first === 'object' && 'value' in first) {
    const value = (first as { value: unknown }).value
    if (typeof value === 'string') return value
    if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  }
  return null
}

/** No hosting credentials: shows the records to publish, but can never report "live". */
export class UnconfiguredHostingProvider implements HostingProvider {
  readonly key = 'unconfigured'
  readonly configured = false

  async attach(hostname: string) {
    return { records: routingRecords(hostname, isApex(hostname), VERCEL_DEFAULT_A, VERCEL_DEFAULT_CNAME), created: false }
  }

  async status(hostname: string): Promise<HostingStatus> {
    return {
      attached: false,
      dnsConfigured: false,
      sslReady: false,
      records: routingRecords(hostname, isApex(hostname), VERCEL_DEFAULT_A, VERCEL_DEFAULT_CNAME),
      error: 'Custom domain hosting is not configured on this environment yet.',
    }
  }

  async detach() {}
}

/** Tests and staging: hostnames go live only when a test says so. Never used in production. */
export class TestHostingProvider implements HostingProvider {
  readonly key = 'test'
  readonly configured = true
  readonly state = new Map<string, { dnsConfigured: boolean; sslReady: boolean }>()
  /** Hostnames attached to the project (by anyone); `attach` reports whether it added one. */
  readonly attachedHosts = new Set<string>()
  readonly attachCalls: string[] = []
  readonly detached: string[] = []

  async attach(hostname: string) {
    this.attachCalls.push(hostname)
    const created = !this.attachedHosts.has(hostname)
    this.attachedHosts.add(hostname)
    return { providerId: `test:${hostname}`, records: routingRecords(hostname, isApex(hostname), VERCEL_DEFAULT_A, VERCEL_DEFAULT_CNAME), created }
  }

  async status(hostname: string): Promise<HostingStatus> {
    const s = this.state.get(hostname)
    return {
      attached: this.attachedHosts.has(hostname),
      dnsConfigured: s?.dnsConfigured ?? false,
      sslReady: s?.sslReady ?? false,
      records: routingRecords(hostname, isApex(hostname), VERCEL_DEFAULT_A, VERCEL_DEFAULT_CNAME),
    }
  }

  async detach(hostname: string) {
    this.attachedHosts.delete(hostname)
    this.state.delete(hostname)
    this.detached.push(hostname)
  }

  /** Test helper: something else (e.g. the platform itself) already has this hostname on the project. */
  preAttached(hostname: string) {
    this.attachedHosts.add(hostname)
  }

  /** Test helper: the merchant's DNS now points at us and a certificate was issued. */
  pointAtUs(hostname: string, ssl = true) {
    this.state.set(hostname, { dnsConfigured: true, sslReady: ssl })
  }
}

let override: HostingProvider | null = null

/** Tests inject their own provider. */
export function setHostingProviderForTests(provider: HostingProvider | null): void {
  override = provider
}

export function getHostingProvider(): HostingProvider {
  if (override) return override
  const token = process.env.VERCEL_DOMAINS_TOKEN
  const projectId = process.env.VERCEL_PROJECT_ID
  if (token && projectId) return new VercelHostingProvider(token, projectId, process.env.VERCEL_TEAM_ID || undefined)
  return new UnconfiguredHostingProvider()
}
