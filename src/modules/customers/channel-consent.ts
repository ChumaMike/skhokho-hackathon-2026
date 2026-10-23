/**
 * Per-channel consent for order messages — the "order_updates" purpose in
 * the consents ledger, one row per event, per membership (customer × shop).
 *
 * Two writers, both through the set_channel_consent RPC
 * (prisma/sql/10_identity_rpcs.sql — identity writes never go through
 * Prisma):
 *
 *   - checkout: the customer typed a WhatsApp / phone number for this order's
 *     updates and accepted the Terms → a granted row, evidence = the order
 *     number and the Terms version shown;
 *   - the WhatsApp webhook: the customer replied STOP → every open row for
 *     that number is revoked and a standalone withdrawal row is written
 *     (granted_at = revoked_at), so the STOP is on record even for a customer
 *     who ordered before this ledger existed. START writes a fresh grant.
 *
 * One reader: isPhoneOptedOut, called by the WhatsApp provider at send time
 * for every order message. The latest row decides. No row at all means
 * "never said STOP" — the number typed at checkout is the consent (see
 * docs/notifications-whatsapp.md for the [ATTORNEY] point on that).
 *
 * Nothing here returns or logs customers.id; callers see counts only.
 */

import { prisma } from '@/lib/prisma/client'
import { log, errorFields } from '@/lib/log'

export type ConsentChannel = 'whatsapp' | 'sms' | 'email'
export type ChannelConsentPurpose = 'order_updates' | 'marketing'

export interface ChannelConsentEvent {
  /** E.164 South African mobile. */
  phone: string
  channel: ConsentChannel
  purpose: ChannelConsentPurpose
  granted: boolean
  /** Where it came from: storefront_checkout | whatsapp_stop | whatsapp_start | owner_dashboard … */
  source: string
  /** Safe facts only — an order number, a Terms version, a provider message id. Never free text from the customer. */
  evidence?: Record<string, string | number | boolean | null>
  /** Limit to one shop; omitted = every shop this number is a member of (what a STOP to the platform number means). */
  businessId?: string | null
}

/** Records the event for every matching membership. Returns how many; 0 when the number is unknown. Never throws. */
export async function recordChannelConsent(event: ChannelConsentEvent): Promise<{ memberships: number }> {
  try {
    const rows = await prisma.$queryRaw<{ result: { memberships: number } }[]>`
      SELECT set_channel_consent(
        ${event.phone}, ${event.channel}, ${event.purpose}, ${event.granted},
        ${event.source}, ${JSON.stringify(event.evidence ?? {})}::jsonb,
        ${event.businessId ?? null}::uuid
      ) AS result`
    return { memberships: Number(rows[0]?.result?.memberships ?? 0) }
  } catch (e) {
    log('error', 'channel_consent.write_failed', { channel: event.channel, purpose: event.purpose, granted: event.granted, source: event.source, ...errorFields(e) })
    return { memberships: 0 }
  }
}

/**
 * Whether this number's latest order_updates decision on this channel is a
 * withdrawal — at one shop when the caller knows it, otherwise at any shop
 * (the platform's single WhatsApp number cannot tell shops apart, and a
 * STOP sent to it is recorded for every shop). Fails CLOSED on a database
 * error: a message we cannot show is still wanted is not sent, and the
 * error is logged.
 */
export async function isPhoneOptedOut(phone: string, channel: ConsentChannel, businessId: string | null = null): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ revoked_at: Date | null }[]>`
      SELECT c.revoked_at
      FROM consents c
      JOIN customer_identifiers ci ON ci.customer_id = c.customer_id
      WHERE ci.type = 'phone' AND ci.value = ${phone}
        AND (${businessId}::uuid IS NULL OR c.business_id = ${businessId}::uuid)
        AND c.purpose = 'order_updates' AND c.channel = ${channel}
      ORDER BY c.granted_at DESC, c.id DESC
      LIMIT 1`
    return rows.length > 0 && rows[0].revoked_at !== null
  } catch (e) {
    log('error', 'channel_consent.read_failed', { channel, ...errorFields(e) })
    return true
  }
}
