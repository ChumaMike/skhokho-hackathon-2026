import { prisma } from '@/lib/prisma/client'
import { getPaymentSettings } from '@/modules/tenant/capabilities'

/**
 * How a storefront order gets paid for.
 *
 * Under merchant-direct settlement, a customer only reaches a card gateway
 * when BOTH are true:
 *
 *   1. this business has a VERIFIED LIVE connection of its own, and
 *   2. the owner has not turned online payment off.
 *
 * There is deliberately no platform fallback. A business without its own
 * verified account has no online card option at all — falling back to
 * Skhokho's account would route that merchant's customer money to SGDataInt,
 * which is the entire thing this architecture exists to prevent.
 *
 * Either being false means the order is still placed — it just gets settled
 * in person. That is not a degraded fallback: paying on collection is how
 * most spaza shops, kotas and salons already trade, and bookings in this app
 * have always worked that way deliberately (see the comment at the top of
 * lib/payfast.ts). It is the normal path for a lot of businesses, and the
 * only honest path while a payment provider is down.
 *
 * When card IS live, the customer chooses between "pay now by card" and
 * "pay in person" at checkout — unless the merchant has restricted it to
 * one (Settings › Payments, `settings.payment.inPerson`). With no card
 * option there is nothing to choose and in person is always allowed.
 */

export type CheckoutPayment =
  | { kind: 'online' }
  | { kind: 'in_person'; method: 'CASH'; customerMessage: string }

/** What the customer picked at checkout, when there was a choice. */
export type PaymentChoice = 'CARD' | 'IN_PERSON'

/** Which ways of paying this checkout can offer. */
export interface CheckoutPaymentOptions {
  card: boolean
  inPerson: boolean
}

/** What the customer is told, which differs by how they're receiving it. */
const IN_PERSON_MESSAGE: Record<'COLLECTION' | 'DELIVERY', string> = {
  COLLECTION: 'Order placed — pay when you collect.',
  DELIVERY: 'Order placed — pay the driver when it arrives.',
}

/** The minimum a caller must prove about a connection for it to receive money. */
export interface ReceivingConnection {
  status: 'PENDING_VERIFICATION' | 'VERIFIED' | 'INVALID' | 'DISABLED' | 'SUPERSEDED'
  environment: 'SANDBOX' | 'LIVE'
}

/**
 * `settings.payment.inPerson`: whether the merchant still takes cash/card at
 * handover once card-online is live. Defaults to true — nothing changes for a
 * business that never touched it. Only consulted when card is actually
 * available; without card, in person is the only way and is always allowed.
 */
export function inPersonAllowed(business: { settings: unknown }): boolean {
  const payment = ((business.settings ?? {}) as { payment?: { inPerson?: unknown } }).payment
  return typeof payment?.inPerson === 'boolean' ? payment.inPerson : true
}

export function checkoutPaymentOptions(business: { settings: unknown }, connection?: ReceivingConnection | null): CheckoutPaymentOptions {
  const wantsOnline = getPaymentSettings(business).online
  // Saved credentials are not enough, and a sandbox account must never take a
  // real customer's money.
  const canReceive = connection?.status === 'VERIFIED' && connection.environment === 'LIVE'
  const card = wantsOnline && canReceive
  return { card, inPerson: !card || inPersonAllowed(business) }
}

export function resolveCheckoutPayment(
  business: { settings: unknown },
  fulfilmentMethod: 'COLLECTION' | 'DELIVERY',
  /**
   * The business's own active connection, loaded server-side from the order's
   * authoritative Business relationship — never from anything the customer
   * submitted. Absent means no online option, which is the correct default.
   */
  connection?: ReceivingConnection | null,
  /**
   * The customer's pick when both ways are open. Ignored whenever the
   * merchant allows only one — the server, not the form, decides what is
   * on offer. Defaults to card where it is available.
   */
  choice?: PaymentChoice,
): CheckoutPayment {
  const options = checkoutPaymentOptions(business, connection)
  const online = options.card && (!options.inPerson || choice !== 'IN_PERSON')
  if (online) return { kind: 'online' }

  return {
    kind: 'in_person',
    // CASH rather than leaving paymentMethod null: the order genuinely is
    // expected to be settled in cash at handover, and an owner reconciling
    // their day needs to see which orders those were. It stays
    // paymentStatus: PENDING until someone actually takes the money.
    method: 'CASH',
    customerMessage: IN_PERSON_MESSAGE[fulfilmentMethod],
  }
}

/** The three ways a merchant can set it up in Settings › Payments. */
export type CustomerPaymentMode = 'CARD_OR_IN_PERSON' | 'CARD_ONLY' | 'IN_PERSON_ONLY'

export function customerPaymentMode(business: { settings: unknown }): CustomerPaymentMode {
  const online = getPaymentSettings(business).online
  if (!online) return 'IN_PERSON_ONLY'
  return inPersonAllowed(business) ? 'CARD_OR_IN_PERSON' : 'CARD_ONLY'
}

/**
 * Writes `settings.payment.online` and `.inPerson` together from one mode,
 * merging into whatever else lives in `settings` (same pattern as
 * capabilities.ts's setters). "Card only" is only meaningful once the live
 * connection is verified; until then checkout falls back to in person
 * anyway (checkoutPaymentOptions), so saving it early is harmless.
 */
export async function setCustomerPaymentMode(businessId: string, mode: CustomerPaymentMode): Promise<void> {
  if (!['CARD_OR_IN_PERSON', 'CARD_ONLY', 'IN_PERSON_ONLY'].includes(mode)) throw new Error('Choose how customers may pay.')
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { settings: true } })
  const settings = (business.settings ?? {}) as Record<string, unknown>
  const payment = (settings.payment ?? {}) as Record<string, unknown>
  await prisma.business.update({
    where: { id: businessId },
    data: { settings: { ...settings, payment: { ...payment, online: mode !== 'IN_PERSON_ONLY', inPerson: mode !== 'CARD_ONLY' } } },
  })
}
