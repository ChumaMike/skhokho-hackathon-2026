/**
 * BulkSMS — a real SMS provider behind the MessageProvider seam.
 *
 * Deliberately thin. Everything that is not "turn an OutboundMessage into one
 * HTTP call and read the answer" lives elsewhere: the daily cap and the
 * append-only log are in ../message-log.ts (provider-agnostic, so they keep
 * working when this is swapped for Clickatell or SMSPortal), and the decision
 * to use this provider at all is one branch in ../provider.ts.
 *
 * Vendor chosen for speed of setup for the pilot (South African, prepaid, no
 * contract, basic-auth token pair). Nothing in here is BulkSMS-shaped beyond
 * `toRequest` and `readResponse`, which is the whole point: swapping vendor
 * should mean writing one more file like this one, not touching the callers.
 *
 * Discipline inherited from ../provider.ts and lib/email.ts, and it matters
 * more here because this one costs real money and leaves the building:
 *   - never throws (the seam turns a false `accepted` into an observable event);
 *   - never logs the number or the message body, on any path;
 *   - only provider acceptance counts as sent.
 *
 * API reference: BulkSMS JSON API v1, POST /v1/messages.
 */

import type { MessageProvider, MessageProviderResult, OutboundMessage } from '../provider'

const ENDPOINT = 'https://api.bulksms.com/v1/messages'

/** The HTTP surface this adapter needs, so tests pass a fake instead of a live account. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; text(): Promise<string> }>

export interface BulkSmsCredentials {
  tokenId: string
  tokenSecret: string
  /** Approved alphanumeric sender id, or a purchased number. Optional: BulkSMS uses the account default when absent. */
  sender?: string | null
}

/**
 * Reads the credentials from the environment, or null when they are not all
 * present. Null means "not configured" and never a partial attempt: half a
 * token pair would fail on every send and burn the retry budget.
 */
export function bulkSmsCredentialsFromEnv(): BulkSmsCredentials | null {
  const tokenId = (process.env.BULKSMS_TOKEN_ID ?? '').trim()
  const tokenSecret = (process.env.BULKSMS_TOKEN_SECRET ?? '').trim()
  if (!tokenId || !tokenSecret) return null
  const sender = (process.env.BULKSMS_SENDER ?? '').trim()
  return { tokenId, tokenSecret, sender: sender || null }
}

/** How long we wait for BulkSMS before giving up on one send. */
const TIMEOUT_MS = 10_000

/**
 * `status.type` from the BulkSMS schema, whose full enum is ACCEPTED,
 * SCHEDULED, SENT, DELIVERED, UNKNOWN, FAILED (verified against the published
 * OpenAPI spec, not guessed — the first four all mean the provider has the
 * message and will deliver or report on it).
 *
 * UNKNOWN is deliberately NOT here. It is not acceptance, and this seam's rule
 * is that only acceptance counts as sent: reporting `sent: false` lets the
 * caller fall back to email, whereas claiming a send we cannot vouch for would
 * leave a customer silently waiting. The cost of being wrong the other way is
 * at worst one duplicate message.
 */
const ACCEPTED_STATUS = new Set(['ACCEPTED', 'SCHEDULED', 'SENT', 'DELIVERED'])

interface BulkSmsMessage {
  id?: unknown
  status?: { type?: unknown } | null
  creditCost?: unknown
}

/**
 * Pulls the one thing we asked about out of a response that is an array of
 * message objects. Tolerant on purpose: a provider that adds fields, or
 * returns them in a different order, must not break sending.
 */
function readResponse(status: number, body: string): MessageProviderResult & { costCredits?: number | null } {
  if (status === 401 || status === 403) {
    return { accepted: false, errorName: 'bulksms_auth_rejected' }
  }
  if (status === 429) {
    return { accepted: false, errorName: 'bulksms_rate_limited' }
  }
  if (status < 200 || status >= 300) {
    // The detail may name the fault (bad number, no credit); it is safe to
    // keep as an error NAME only — never the body we sent.
    return { accepted: false, errorName: `bulksms_http_${status}` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return { accepted: false, errorName: 'bulksms_unreadable_response' }
  }

  const first = (Array.isArray(parsed) ? parsed[0] : parsed) as BulkSmsMessage | undefined
  if (!first || typeof first !== 'object') {
    return { accepted: false, errorName: 'bulksms_empty_response' }
  }

  const statusType = typeof first.status?.type === 'string' ? first.status.type.toUpperCase() : null
  const providerId = first.id == null ? null : String(first.id)
  const costCredits = typeof first.creditCost === 'number' && Number.isFinite(first.creditCost) ? first.creditCost : null

  // A 2xx with no status at all still means BulkSMS took it; only an explicit
  // non-accepting status is a refusal. Being strict here would throw away
  // messages the carrier actually has.
  if (statusType && !ACCEPTED_STATUS.has(statusType)) {
    return { accepted: false, providerId, errorName: `bulksms_status_${statusType.toLowerCase()}`, costCredits }
  }
  return { accepted: true, providerId, costCredits }
}

/** Basic auth over the token pair. Never logged, never returned. */
function authHeader(c: BulkSmsCredentials): string {
  return `Basic ${Buffer.from(`${c.tokenId}:${c.tokenSecret}`).toString('base64')}`
}

/**
 * The provider. `fetchImpl` is injected so the tests exercise every branch
 * (accepted, refused, auth failure, rate limit, malformed body, network
 * error, timeout) without a live account or a single real SMS.
 *
 * `to` is already E.164 by the time it reaches here — the seam normalises and
 * validates it (toE164Mobile / isValidZaMobile), and refuses anything that is
 * not a valid South African mobile before a provider is ever called. This
 * adapter sends it through unchanged, which is the format BulkSMS wants.
 */
export function createBulkSmsProvider(
  credentials: BulkSmsCredentials,
  fetchImpl?: FetchLike,
): MessageProvider & { send(message: OutboundMessage): Promise<MessageProviderResult & { costCredits?: number | null }> } {
  const doFetch: FetchLike = fetchImpl ?? ((url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>)

  return {
    name: 'bulksms',
    async send(message) {
      const payload: Record<string, string> = { to: message.to, body: message.text }
      if (credentials.sender) payload.from = credentials.sender

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        const response = await doFetch(ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: authHeader(credentials),
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        })
        const text = await response.text()
        return readResponse(response.status, text)
      } catch (e) {
        // Includes the abort above. The error NAME only: an exception message
        // from an HTTP client can quote the request, and the request contains
        // the customer's number and the message body.
        const aborted = e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')
        return { accepted: false, errorName: aborted ? 'bulksms_timeout' : 'bulksms_unreachable' }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

/** Exported for the tests, which pin the mapping rather than only the happy path. */
export const __readResponseForTests = readResponse
