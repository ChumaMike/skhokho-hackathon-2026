import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { readWhatsAppConfig, parseWebhookPayload, verifyWebhookSignature, classifyInboundText } from '@/lib/messaging/providers/whatsapp-meta'
import { sendPhoneMessage } from '@/lib/messaging/provider'
import { START_REPLY_TEXT, STOP_REPLY_TEXT } from '@/lib/messaging/whatsapp-templates'
import { recordChannelConsent } from '@/modules/customers/channel-consent'
import { securityEvent, systemEvent } from '@/modules/platform-admin/audit'
import { clientIp } from '@/lib/rate-limit'
import { log, errorFields } from '@/lib/log'

export const runtime = 'nodejs'

/**
 * Meta's webhook for the platform's WhatsApp number. Two things arrive here:
 *
 *   - delivery statuses for messages we sent (sent / delivered / read /
 *     failed) — logged with the message kind of information only (never a
 *     number or a body); a failure also becomes a SYSTEM audit event, so an
 *     unapproved template or a blocked number is visible, not silent;
 *   - what customers write back. The only words acted on are STOP (opt-out)
 *     and START (opt back in): each is recorded on the customer's
 *     memberships through the consents ledger and acknowledged with the
 *     wording in docs/legal/consent-wording.md. Anything else is counted
 *     and dropped — this number is not a support line, and the shop's own
 *     contact is in every message.
 *
 * GET is Meta's one-time URL verification (hub.challenge echoed back when
 * hub.verify_token is ours). POST is signed: X-Hub-Signature-256 over the
 * raw bytes with the app secret; an unsigned or missigned body is refused
 * with 401 and recorded as a security event, before anything is parsed.
 *
 * Answers 200 for every verified body, even one we could not make sense of
 * — Meta retries anything else, and a retry would not help.
 */
export async function GET(req: NextRequest) {
  const config = readWhatsAppConfig()
  if (!config) return NextResponse.json({ ok: false }, { status: 404 })
  const params = new URL(req.url).searchParams
  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token') ?? ''
  const challenge = params.get('hub.challenge') ?? ''
  const a = Buffer.from(config.verifyToken, 'utf8')
  const b = Buffer.from(token, 'utf8')
  if (mode === 'subscribe' && a.length === b.length && timingSafeEqual(a, b) && challenge) {
    return new NextResponse(challenge, { status: 200, headers: { 'content-type': 'text/plain' } })
  }
  void securityEvent('messaging_webhook_rejected', {
    outcome: 'DENIED',
    actor: { type: 'anonymous' },
    metadata: { provider: 'whatsapp', reason: 'verification token mismatch' },
    ip: clientIp(req),
    requestId: req.headers.get('x-request-id'),
  })
  return NextResponse.json({ ok: false }, { status: 403 })
}

export async function POST(req: NextRequest) {
  const config = readWhatsAppConfig()
  if (!config) return NextResponse.json({ ok: false }, { status: 404 })

  const rawBody = await req.text()
  if (!verifyWebhookSignature(rawBody, req.headers.get('x-hub-signature-256'), config.appSecret)) {
    void securityEvent('messaging_webhook_rejected', {
      outcome: 'DENIED',
      actor: { type: 'anonymous' },
      metadata: { provider: 'whatsapp', reason: 'bad signature' },
      ip: clientIp(req),
      requestId: req.headers.get('x-request-id'),
    })
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch {
    log('warn', 'whatsapp.webhook_unparseable', {})
    return NextResponse.json({ ok: true })
  }

  const parsed = parseWebhookPayload(body, config.phoneNumberId)
  if (parsed.foreign) log('warn', 'whatsapp.webhook_foreign_number', { changes: parsed.foreign })

  for (const s of parsed.statuses) {
    // Cost is only known here: Meta prices a message in its status webhook
    // (pricing.category / pricing.type), never in the send response.
    log(s.status === 'failed' ? 'error' : 'info', 'whatsapp.delivery', {
      status: s.status,
      providerId: s.messageId,
      errorCodes: s.errorCodes,
      pricingCategory: s.pricingCategory,
      pricingType: s.pricingType,
    })
    if (s.status === 'failed') {
      await systemEvent('message_delivery_failed', {
        outcome: 'FAILURE',
        resource: { type: 'message', id: s.messageId },
        metadata: { provider: 'whatsapp', errorCodes: s.errorCodes },
      }).catch(() => undefined)
    }
  }

  let ignored = 0
  for (const m of parsed.inbound) {
    const keyword = classifyInboundText(m.text)
    if (!keyword || !m.from) {
      ignored += 1
      continue
    }
    try {
      const granted = keyword === 'START'
      const { memberships } = await recordChannelConsent({
        phone: m.from,
        channel: 'whatsapp',
        purpose: 'order_updates',
        granted,
        source: granted ? 'whatsapp_start' : 'whatsapp_stop',
        evidence: { provider_message_id: m.messageId },
      })
      log('info', granted ? 'whatsapp.start' : 'whatsapp.stop', { memberships })
      // Acknowledged only to a number we know — the customer just wrote to
      // us, so this reply is inside WhatsApp's 24-hour window and may be
      // plain text (kind 'unspecified' is the provider's signal for that).
      // A stranger's STOP is recorded as nothing and not answered.
      if (memberships > 0) {
        await sendPhoneMessage({ to: m.from, text: granted ? START_REPLY_TEXT : STOP_REPLY_TEXT, kind: 'unspecified' })
      }
    } catch (e) {
      log('error', 'whatsapp.keyword_failed', { keyword, ...errorFields(e) })
    }
  }
  if (ignored) log('info', 'whatsapp.inbound_ignored', { count: ignored })

  return NextResponse.json({ ok: true })
}
