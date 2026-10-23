/**
 * WhatsApp Business Cloud API (Meta) — the MessageProvider that runs when
 * MESSAGE_PROVIDER=whatsapp.
 *
 * One number, owned by Skhokho Laboratory ("Skhokho Labs"), sends every
 * shop's order messages; the shop is named in the text. Everything the
 * platform starts is a template (../whatsapp-templates.ts): Meta only
 * delivers free text inside the 24 hours after the customer last wrote to
 * the number, and nothing the platform initiates happens inside such a
 * window. The provider therefore derives the template from the kind and
 * text the seam hands it (templateFromText); a text it cannot place is
 * refused locally with errorName whatsapp_template_unmatched, never sent as
 * free text to be bounced by Meta (131047). Kind 'unspecified' is the one
 * exception: the webhook's STOP / START acknowledgement, a reply.
 *
 * Opt-out is honoured here, at send time: an order message (confirmation or
 * status) to a number whose latest order_updates decision on WhatsApp is a
 * withdrawal is not sent (errorName whatsapp_opted_out — observable through
 * the seam, and expected). A sign-in code the customer just asked for is
 * not an order message and still goes.
 *
 * Configuration (all four, or the provider is not configured and the seam
 * reports `configured: false` so callers fall back to email):
 *
 *   WHATSAPP_PHONE_NUMBER_ID  the sending number's id in Meta (not the number)
 *   WHATSAPP_ACCESS_TOKEN     a permanent System User token with
 *                             whatsapp_business_messaging
 *   WHATSAPP_VERIFY_TOKEN     our own random string, echoed back when Meta
 *                             verifies the webhook URL
 *   WHATSAPP_APP_SECRET       the Meta app's secret — signs every webhook
 *   WHATSAPP_API_VERSION      optional, defaults to DEFAULT_API_VERSION
 *
 * The HTTP client and the opt-out lookup are injected so the unit tests
 * exercise the exact request Meta receives without a network or a
 * database. Nothing here logs a phone number, a message body or a token;
 * the seam records failures with the message kind and an error name only.
 *
 * Field names and enums below were checked against Meta's Cloud API
 * reference (webhooks/reference/messages/status, …/button, …/interactive,
 * support/error-codes) on 2026-10-22.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { MessageKind, MessageProvider, MessageProviderResult } from '../provider'
import { templateFromText, type WhatsAppTemplateMessage } from '../whatsapp-templates'

export const DEFAULT_API_VERSION = 'v24.0'
export const GRAPH_API_ORIGIN = 'https://graph.facebook.com'
/** A send that takes longer than this is reported as failed — the seam never hangs an order. */
const SEND_TIMEOUT_MS = 10_000

/** Message kinds that are about an order — the ones a STOP switches off. */
const ORDER_KINDS: ReadonlySet<MessageKind> = new Set<MessageKind>(['customer_order_confirmation', 'customer_order_status'])

export interface WhatsAppConfig {
  phoneNumberId: string
  accessToken: string
  verifyToken: string
  appSecret: string
  apiVersion: string
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export interface WhatsAppProviderDeps {
  fetch?: FetchLike
  /** Whether this number has said STOP to order updates on WhatsApp (optionally at one shop). Default: the consents ledger. */
  isOptedOut?: (phone: string, businessId: string | null) => Promise<boolean>
}

/** The four variables, read together: a half-configured provider is not configured. */
export function readWhatsAppConfig(env: Record<string, string | undefined> = process.env): WhatsAppConfig | null {
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim()
  const verifyToken = env.WHATSAPP_VERIFY_TOKEN?.trim()
  const appSecret = env.WHATSAPP_APP_SECRET?.trim()
  if (!phoneNumberId || !accessToken || !verifyToken || !appSecret) return null
  return { phoneNumberId, accessToken, verifyToken, appSecret, apiVersion: env.WHATSAPP_API_VERSION?.trim() || DEFAULT_API_VERSION }
}

/** Meta addresses a number without the "+" (a "wa_id"); we keep E.164 everywhere else. */
export function toWaId(e164: string): string {
  return e164.replace(/^\+/, '')
}

/** A wa_id back to E.164 — null unless it is a South African mobile, the only kind the platform messages. */
export function fromWaId(waId: string): string | null {
  const digits = waId.replace(/\D/g, '')
  return /^27[678]\d{8}$/.test(digits) ? `+${digits}` : null
}

/** The JSON body for one template message — exported so the tests can assert the exact wire shape. */
export function buildTemplatePayload(to: string, t: WhatsAppTemplateMessage): Record<string, unknown> {
  const components: Record<string, unknown>[] = []
  if (t.variables.length) {
    components.push({ type: 'body', parameters: t.variables.map((text) => ({ type: 'text', text })) })
  }
  // A dynamic URL button and an authentication template's copy-code button
  // are both sent the same way: sub_type "url" with one text parameter (the
  // URL suffix, or the code).
  t.buttons.forEach((value, index) => {
    components.push({ type: 'button', sub_type: 'url', index: String(index), parameters: [{ type: 'text', text: value }] })
  })
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toWaId(to),
    type: 'template',
    template: { name: t.name, language: { code: t.language }, components },
  }
}

/** The JSON body for a plain-text reply (valid only inside the 24-hour customer-service window). */
export function buildTextPayload(to: string, text: string): Record<string, unknown> {
  return { messaging_product: 'whatsapp', recipient_type: 'individual', to: toWaId(to), type: 'text', text: { preview_url: false, body: text } }
}

interface GraphResponse {
  error?: { code?: number; message?: string; type?: string; error_data?: { details?: string } }
  messages?: { id?: string }[]
}

export function createWhatsAppMetaProvider(config: WhatsAppConfig, deps: WhatsAppProviderDeps = {}): MessageProvider {
  const fetchImpl: FetchLike = deps.fetch ?? ((url, init) => fetch(url, init))
  const isOptedOut =
    deps.isOptedOut ??
    (async (phone, businessId) => {
      const { isPhoneOptedOut } = await import('@/modules/customers/channel-consent')
      return isPhoneOptedOut(phone, 'whatsapp', businessId)
    })
  const endpoint = `${GRAPH_API_ORIGIN}/${config.apiVersion}/${config.phoneNumberId}/messages`

  return {
    name: 'whatsapp-meta',
    async send(message): Promise<MessageProviderResult> {
      let payload: Record<string, unknown>
      if (message.kind === 'unspecified') {
        payload = buildTextPayload(message.to, message.text)
      } else {
        const template = templateFromText(message.kind, message.text)
        if (!template) return { accepted: false, errorName: 'whatsapp_template_unmatched' }
        if (ORDER_KINDS.has(message.kind)) {
          // The seam may carry the shop (businessId, added by the SMS
          // workstream); without it the number's latest decision at any shop
          // decides — a STOP to the platform number means every shop anyway.
          const businessId = (message as { businessId?: string | null }).businessId ?? null
          if (await isOptedOut(message.to, businessId)) return { accepted: false, errorName: 'whatsapp_opted_out' }
        }
        payload = buildTemplatePayload(message.to, template)
      }

      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      })
      const raw = await res.text()
      let parsed: GraphResponse = {}
      try {
        parsed = raw ? (JSON.parse(raw) as GraphResponse) : {}
      } catch {
        return { accepted: false, errorName: `whatsapp_http_${res.status}_unparseable` }
      }
      if (!res.ok || parsed.error) {
        // error.code is Meta's stable identifier (131047 outside the 24-hour
        // window, 132001 template missing or unapproved, 132000 wrong variable
        // count, 131026 undeliverable, 130429 throughput limit, 190 token
        // expired…); the message text stays out of the name on purpose.
        const code = parsed.error?.code ?? res.status
        return { accepted: false, errorName: `whatsapp_${code}` }
      }
      // Meta does not price a message in the send response; cost arrives in
      // the status webhook (pricing.category / pricing.type) and is logged there.
      const id = parsed.messages?.[0]?.id
      if (!id) return { accepted: false, errorName: 'whatsapp_no_message_id' }
      return { accepted: true, providerId: id }
    },
  }
}

let cached: { key: string; provider: MessageProvider } | null = null

/** The provider for the current environment, or null when any of the four variables is missing. */
export function whatsAppProviderFromEnv(env: Record<string, string | undefined> = process.env): MessageProvider | null {
  const config = readWhatsAppConfig(env)
  if (!config) return null
  const key = `${config.apiVersion}|${config.phoneNumberId}|${config.accessToken.slice(-6)}`
  if (!cached || cached.key !== key) cached = { key, provider: createWhatsAppMetaProvider(config) }
  return cached.provider
}

// ---------------------------------------------------------------------------
// Webhook helpers — pure functions, used by src/app/api/messaging/whatsapp/webhook/route.ts
// ---------------------------------------------------------------------------

/**
 * Meta signs every webhook body: `X-Hub-Signature-256: sha256=<hex HMAC of
 * the raw bytes with the app secret>`. Compared in constant time; a missing
 * header, a wrong prefix or a wrong length is simply a mismatch.
 */
export function verifyWebhookSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith('sha256=')) return false
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(header.slice('sha256='.length).toLowerCase(), 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** statuses[].status — Meta's documented values (status reference, checked 2026-10-22). */
export type WebhookStatus = 'sent' | 'delivered' | 'read' | 'played' | 'failed'
const STATUSES: ReadonlySet<string> = new Set<WebhookStatus>(['sent', 'delivered', 'read', 'played', 'failed'])

export interface WebhookDeliveryStatus {
  messageId: string
  status: WebhookStatus
  /** errors[].code on a failed delivery, if any. */
  errorCodes: number[]
  /** pricing.category (utility | authentication | marketing | service …) and pricing.type (regular | free_entry_point …), when Meta includes them. */
  pricingCategory: string | null
  pricingType: string | null
}

export interface WebhookInboundMessage {
  messageId: string
  /** E.164, only when the sender is a South African mobile. */
  from: string | null
  /** messages[].type as Meta sent it (text, button, interactive, image, …). */
  type: string | null
  /** text.body, button.text, or the interactive reply's title; null for media and other kinds. */
  text: string | null
}

export interface ParsedWebhook {
  statuses: WebhookDeliveryStatus[]
  inbound: WebhookInboundMessage[]
  /** Changes addressed to a phone_number_id that is not ours — counted, never acted on. */
  foreign: number
}

/**
 * Pulls the two things the platform acts on out of Meta's envelope
 * (entry[].changes[].value): delivery statuses for messages we sent, and
 * what the customer wrote back. Anything else (media, reactions, unknown
 * fields) is ignored. Never throws on a strange shape — a webhook must
 * always be answered 200 or Meta retries it.
 */
export function parseWebhookPayload(body: unknown, ownPhoneNumberId: string): ParsedWebhook {
  const out: ParsedWebhook = { statuses: [], inbound: [], foreign: 0 }
  const entries = (body as { entry?: unknown })?.entry
  if (!Array.isArray(entries)) return out
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes
    if (!Array.isArray(changes)) continue
    for (const change of changes) {
      const value = (change as { value?: Record<string, unknown> })?.value
      if (!value || typeof value !== 'object') continue
      const metadata = value.metadata as { phone_number_id?: unknown } | undefined
      if (typeof metadata?.phone_number_id === 'string' && metadata.phone_number_id !== ownPhoneNumberId) {
        out.foreign += 1
        continue
      }
      for (const s of asArray(value.statuses)) {
        const id = str(s.id)
        const status = str(s.status)
        if (!id || !status || !STATUSES.has(status)) continue
        const errorCodes = asArray(s.errors).map((e) => e.code).filter((c): c is number => typeof c === 'number')
        const pricing = (s.pricing ?? {}) as { category?: unknown; type?: unknown }
        out.statuses.push({ messageId: id, status: status as WebhookStatus, errorCodes, pricingCategory: str(pricing.category), pricingType: str(pricing.type) })
      }
      for (const m of asArray(value.messages)) {
        const id = str(m.id)
        if (!id) continue
        const from = str(m.from)
        const type = str(m.type)
        let text: string | null = null
        if (type === 'text') text = str((m.text as { body?: unknown } | undefined)?.body)
        else if (type === 'button') text = str((m.button as { text?: unknown } | undefined)?.text)
        else if (type === 'interactive') {
          const i = m.interactive as { button_reply?: { title?: unknown }; list_reply?: { title?: unknown } } | undefined
          text = str(i?.button_reply?.title) ?? str(i?.list_reply?.title)
        }
        out.inbound.push({ messageId: id, from: from ? fromWaId(from) : null, type, text })
      }
    }
  }
  return out
}

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

export type InboundKeyword = 'STOP' | 'START'

/**
 * STOP (and the usual spellings of it) is the opt-out; START is the way
 * back. Matched on the whole message so "stop" inside a sentence about an
 * order is not an opt-out, but "STOP ALL", "Stop." and "unsubscribe" are.
 */
export function classifyInboundText(text: string | null): InboundKeyword | null {
  if (!text) return null
  const t = text.trim().toLowerCase().replace(/[.!]+$/, '').replace(/\s+/g, ' ')
  if (/^(stop|stop all|unsubscribe|cancel|end|quit|opt out|optout)$/.test(t)) return 'STOP'
  if (/^(start|unstop|resume|subscribe|yes start)$/.test(t)) return 'START'
  return null
}
