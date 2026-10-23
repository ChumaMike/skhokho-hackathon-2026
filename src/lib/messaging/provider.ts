/**
 * Phone messaging — the ONE way the platform sends a text to a customer's
 * phone (sign-in codes, order confirmations, status updates).
 *
 * A MessageProvider is a tiny adapter: given an E.164 number and plain text,
 * it either gets the message accepted by a carrier/WhatsApp gateway or
 * reports that it didn't. Which provider runs is an environment choice:
 *
 *   MESSAGE_PROVIDER=console   dev/test: the message is written to the log
 *                              (so a developer can read the sign-in code)
 *   MESSAGE_PROVIDER unset     nothing is sent; callers fall back to email
 *                              where they have one, and the outage is
 *                              observable (a warn log + one SYSTEM audit
 *                              event per 10 minutes), never silent
 *
 * The real SMS / WhatsApp Business provider is a later env choice (it needs
 * a vendor contract, a verified sender and the consent wording in
 * docs/legal/consent-wording.md) — it will be one more branch in
 * resolveProvider below, nothing else changes.
 *
 * Same discipline as src/lib/email.ts: never throws, never logs the number
 * or the message body on the production path (the console provider is
 * refused in production for exactly that reason), and only provider
 * acceptance counts as sent.
 */

import { isValidZaMobile, normalisePhone } from '@/lib/za-phone'
// Static import: the adapter pulls in nothing but fetch and Buffer, so it does
// not weigh on this module's many importers. The database side of metering
// (message-log.ts) is lazy-imported below for exactly that reason.
import { bulkSmsCredentialsFromEnv, createBulkSmsProvider } from './providers/sms-bulksms'
import { whatsAppProviderFromEnv } from './providers/whatsapp-meta'

/** What kind of message this is — the only label that reaches logs and the audit trail. */
export type MessageKind = 'customer_login_code' | 'customer_order_confirmation' | 'customer_order_status' | 'unspecified'

export interface OutboundMessage {
  /** E.164, e.g. +27821234567. */
  to: string
  text: string
  kind: MessageKind
  /**
   * Whose customer this is, when there is one. Optional and additive (Tab 4,
   * notify-sms): a real SMS provider costs money, so sends are metered and
   * capped per business, and a cap needs to know whose send it is.
   *
   * Left unset for a customer sign-in code, deliberately. Login codes are
   * keyed by the identifier the customer typed and never by a business — the
   * same phone is a separate `customers` row at every shop and sign-in must
   * not pick one (see CustomerLoginCode). Attributing the SMS would quietly
   * reintroduce the link that design avoids, so those sends share one
   * platform bucket instead.
   */
  businessId?: string | null
}

export interface MessageProviderResult {
  accepted: boolean
  providerId?: string | null
  errorName?: string | null
  /**
   * What the provider says it cost, in its own credits — not rands (Tab 4,
   * notify-sms). Optional: a provider that does not report cost returns
   * nothing and the log records null rather than a guess.
   */
  costCredits?: number | null
}

export interface MessageProvider {
  readonly name: string
  send(message: OutboundMessage): Promise<MessageProviderResult>
}

/** Shows the last four digits only — enough to recognise a number in a log, never enough to dial it. */
export function maskPhone(e164: string): string {
  return `+27 ** *** *${e164.slice(-3)}`
}

/** Normalises any common SA mobile format to E.164, or null if it isn't a valid SA mobile. */
export function toE164Mobile(raw: string): string | null {
  const e164 = normalisePhone(raw.trim())
  return isValidZaMobile(e164) ? e164 : null
}

/**
 * Dev/test provider: prints the message. Deliberately the WHOLE text (a
 * developer signing in locally needs to read the code), which is why
 * resolveProvider never returns it in production.
 */
export const consoleMessageProvider: MessageProvider = {
  name: 'console',
  async send(message) {
    console.log(`[message:console] kind=${message.kind} to=${maskPhone(message.to)}\n${message.text}`)
    return { accepted: true, providerId: `console-${Date.now()}` }
  },
}

let testProvider: MessageProvider | null | undefined
/** Tests only: replace the provider (null = behave as unconfigured; undefined restores env resolution). */
export function __setMessageProviderForTests(provider: MessageProvider | null | undefined): void {
  testProvider = provider
}

function resolveProvider(): MessageProvider | null {
  if (testProvider !== undefined) return testProvider
  const choice = (process.env.MESSAGE_PROVIDER ?? '').trim().toLowerCase()
  if (choice === 'console') {
    // A sign-in code in production logs would be a credential leak.
    if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') return null
    return consoleMessageProvider
  }
  // Tab 4 (notify-sms): the real provider the file above anticipated. Resolved
  // per call rather than once at module load, so a deployment that sets the
  // credentials does not need a restart, and so a half-configured account
  // reads as unconfigured (credentials null) instead of failing every send.
  if (choice === 'bulksms') {
    const credentials = bulkSmsCredentialsFromEnv()
    if (!credentials) return null
    return createBulkSmsProvider(credentials)
  }
  // --- notify-whatsapp: Meta WhatsApp Business Cloud API (providers/whatsapp-meta.ts).
  // Template messages only; null (= unconfigured) unless all four WHATSAPP_* variables are set.
  if (choice === 'whatsapp') return whatsAppProviderFromEnv()
  // --- end notify-whatsapp
  return null
}

/** Whether a phone provider is configured for this deployment (drives the "we'll text you" vs "we'll email you" copy). */
export function isPhoneMessagingConfigured(): boolean {
  return resolveProvider() !== null
}

let lastUnconfiguredEventAt = 0

async function observe(action: 'message_failed' | 'message_unconfigured', kind: MessageKind, detail?: string) {
  // Lazy imports keep this module light for its many importers; never throws.
  const [{ log }, { systemEvent }] = await Promise.all([import('../log'), import('@/modules/platform-admin/audit')])
  log(action === 'message_failed' ? 'error' : 'warn', `message.${action === 'message_failed' ? 'failed' : 'unconfigured'}`, { kind, detail })
  if (action === 'message_unconfigured') {
    if (Date.now() - lastUnconfiguredEventAt < 10 * 60 * 1000) return
    lastUnconfiguredEventAt = Date.now()
  }
  await systemEvent(action, { outcome: 'FAILURE', metadata: { kind, detail } })
}

/**
 * Sends one text to one phone through the configured provider. Never throws.
 * `configured: false` tells the caller nothing could have been sent (so it
 * can fall back to email); `sent: false` with `configured: true` means the
 * provider refused or failed, which is already recorded as observable.
 */
export async function sendPhoneMessage(message: OutboundMessage): Promise<{ sent: boolean; configured: boolean }> {
  const provider = resolveProvider()
  if (!provider) {
    await observe('message_unconfigured', message.kind).catch(() => undefined)
    return { sent: false, configured: false }
  }
  if (!isValidZaMobile(message.to)) {
    await observe('message_failed', message.kind, 'invalid_number').catch(() => undefined)
    return { sent: false, configured: true }
  }

  // Tab 4 (notify-sms): metering. Lazy-imported so this module stays light for
  // importers that only ask isPhoneMessagingConfigured(), and so the console
  // provider in local dev needs no database at all.
  //
  // The console provider is exempt on purpose: it costs nothing, and a
  // developer reading a sign-in code out of the log should not be stopped by a
  // spend cap or need a migrated database to sign in.
  const metered = provider.name !== 'console'
  const meter = metered
    ? await import('./message-log').catch((e) => {
        // Cannot load the meter: treat as a cap failure, not as unlimited.
        void e
        return null
      })
    : null
  if (metered && !meter) {
    await observe('message_failed', message.kind, 'meter_unavailable').catch(() => undefined)
    return { sent: false, configured: true }
  }

  const businessId = message.businessId ?? null
  const toMasked = maskPhone(message.to)
  const bodyChars = message.text.length

  if (meter) {
    const verdict = await meter.withinCap(businessId, new Date())
    if (!verdict.allowed) {
      // Fails closed, and says so: nothing was sent and nothing was charged.
      await observe('message_failed', message.kind, `daily_cap_reached_${verdict.used}_of_${verdict.cap}`).catch(() => undefined)
      await meter
        .recordSend({
          businessId,
          kind: message.kind,
          provider: provider.name,
          toMasked,
          bodyChars,
          status: 'CAPPED',
          errorName: `daily_cap_${verdict.cap}`,
        })
        .catch(() => undefined)
      return { sent: false, configured: true }
    }
  }

  try {
    const result = await provider.send(message)
    if (!result.accepted) {
      await observe('message_failed', message.kind, result.errorName ?? `${provider.name}_rejected`).catch(() => undefined)
      await meter
        ?.recordSend({
          businessId,
          kind: message.kind,
          provider: provider.name,
          toMasked,
          bodyChars,
          status: 'REJECTED',
          providerMessageId: result.providerId ?? null,
          errorName: result.errorName ?? `${provider.name}_rejected`,
          costCredits: result.costCredits ?? null,
        })
        .catch(() => undefined)
      return { sent: false, configured: true }
    }
    await meter
      ?.recordSend({
        businessId,
        kind: message.kind,
        provider: provider.name,
        toMasked,
        bodyChars,
        status: 'ACCEPTED',
        providerMessageId: result.providerId ?? null,
        costCredits: result.costCredits ?? null,
      })
      .catch(() => undefined)
    return { sent: true, configured: true }
  } catch (e) {
    await observe('message_failed', message.kind, e instanceof Error ? e.name : 'unknown').catch(() => undefined)
    await meter
      ?.recordSend({
        businessId,
        kind: message.kind,
        provider: provider.name,
        toMasked,
        bodyChars,
        status: 'REJECTED',
        errorName: e instanceof Error ? e.name : 'unknown',
      })
      .catch(() => undefined)
    return { sent: false, configured: true }
  }
}

// ---- Tab 7 (web push, feature/notify-webpush) ----
// A SECOND kind of provider beside the phone one: Web Push to the browsers a
// customer switched on (src/lib/messaging/providers/webpush.ts). It is not a
// value of MESSAGE_PROVIDER — it is on exactly when the VAPID variables are
// set (webpush-config.ts) and off, observably, otherwise. Same contract as
// sendPhoneMessage: never throws, only the push service's acceptance counts.
// Types are referenced inline so this block stays append-only (no import
// lines above it change).

type PushProvider = import('./providers/webpush').PushProvider
type PushPayload = import('./providers/webpush').PushPayload
type PushTarget = import('./providers/webpush').PushTarget

let testPushProvider: PushProvider | null | undefined
/** Tests only: replace the push provider (null = behave as unconfigured; undefined restores env resolution). */
export function __setPushProviderForTests(provider: PushProvider | null | undefined): void {
  testPushProvider = provider
}

let cachedPushProvider: { publicKey: string; provider: PushProvider } | null = null

async function resolvePushProvider(): Promise<PushProvider | null> {
  if (testPushProvider !== undefined) return testPushProvider
  const { readWebPushConfig } = await import('./webpush-config')
  const config = readWebPushConfig()
  if (!config) return null
  if (cachedPushProvider?.publicKey !== config.publicKey) {
    const { createWebPushProvider } = await import('./providers/webpush')
    cachedPushProvider = { publicKey: config.publicKey, provider: createWebPushProvider(config) }
  }
  return cachedPushProvider.provider
}

/** Whether Web Push can run in this deployment (the account page's "on this phone" section hides otherwise). */
export async function isPushMessagingConfigured(): Promise<boolean> {
  return (await resolvePushProvider()) !== null
}

export interface PushSendSummary {
  configured: boolean
  /** Subscription ids the push service accepted. */
  sent: string[]
  /** Subscription ids the push service says are gone (404/410) — the caller forgets them. */
  gone: string[]
}

/**
 * Sends one payload to every browser given. Never throws. Failures other
 * than "gone" are recorded as observable events (message.failed) like a
 * phone failure; "unconfigured" is recorded only when there was someone to
 * send to, since no subscriptions can exist while the keys are unset.
 */
export async function sendPushMessages(targets: PushTarget[], payload: PushPayload, context: { businessId: string; kind: MessageKind }): Promise<PushSendSummary> {
  if (targets.length === 0) return { configured: await isPushMessagingConfigured(), sent: [], gone: [] }
  const provider = await resolvePushProvider()
  if (!provider) {
    await observe('message_unconfigured', context.kind, 'push').catch(() => undefined)
    return { configured: false, sent: [], gone: [] }
  }
  const sent: string[] = []
  const gone: string[] = []
  await Promise.all(
    targets.map(async (target) => {
      try {
        const r = await provider.send(target, payload, context)
        if (r.accepted) sent.push(target.id)
        else if (r.gone) gone.push(target.id)
        else await observe('message_failed', context.kind, r.errorName ?? `${provider.name}_rejected`).catch(() => undefined)
      } catch (e) {
        await observe('message_failed', context.kind, e instanceof Error ? e.name : 'unknown').catch(() => undefined)
      }
    }),
  )
  return { configured: true, sent, gone }
}
