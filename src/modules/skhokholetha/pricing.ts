/**
 * Network delivery pricing — pure and deterministic; the quote is frozen (in
 * integer cents) on the delivery when it's requested.
 *
 * QUOTE PARITY (docs/skhokholetha.md "Quote parity"): the customer already
 * paid ONE exact delivery fee at checkout, computed by the shared rule in
 * src/modules/delivery/delivery-quote.ts. The network cost is based on that
 * same number — never recomputed from the settings with a different formula —
 * so the two can't silently disagree:
 *
 *   networkCost     = max(customerFeeCents, NETWORK minimum)
 *   merchantCost    = networkCost − customerFeeCents   (what the shop covers)
 *   driverEarning   = networkCost − platformFee
 *
 * When merchantCost > 0 the shop is told exactly that before confirming (the
 * confirmed fee the shop must echo back is the network cost, not the customer
 * fee), so nothing proceeds silently at a loss. Distance uses the same shared
 * road-distance rule; it gates the service radius only.
 */

import { haversineMeters, isValidLatLng, roadKm, type LatLng } from '@/modules/delivery/distance'

export { haversineMeters, isValidLatLng, type LatLng }

export const NETWORK_PRICING = {
  /** A driver is never asked to deliver for less than this. */
  minimumFeeCents: 2500,
  /** Pickups further than this from the drop-off aren't served. */
  maxRadiusKm: 25,
  /** Skhokho's share, in basis points. 0 in V1: the driver earns the full fee. */
  platformFeeBps: 0,
  version: 'v2',
} as const

export interface NetworkQuote {
  distanceMeters: number
  /** The network cost — what the delivery costs in total. */
  quoteFeeCents: number
  platformFeeCents: number
  driverEarningCents: number
  /** What the customer paid for delivery at checkout. */
  customerFeeCents: number
  /** quoteFeeCents − customerFeeCents: the shop's contribution (0 when the customer fee covers it). */
  merchantCostCents: number
  /** Everything the quote was computed from — frozen with the delivery. */
  snapshot: {
    version: string
    customerFeeCents: number
    roadKm: number
    minimumFeeCents: number
    platformFeeBps: number
  }
}

export type QuoteResult = { ok: true; quote: NetworkQuote } | { ok: false; reason: string }

export function quoteNetworkDelivery(input: { deliveryEnabled: boolean; customerFeeCents: number; pickup: LatLng; dropoff: LatLng }): QuoteResult {
  if (!input.deliveryEnabled) return { ok: false, reason: 'Delivery is switched off for this shop.' }
  if (!isValidLatLng(input.pickup)) return { ok: false, reason: "The shop's pickup location isn't set. Add the shop address in Settings." }
  if (!isValidLatLng(input.dropoff)) return { ok: false, reason: "The customer's address couldn't be located on the map." }
  if (!Number.isInteger(input.customerFeeCents) || input.customerFeeCents < 0) return { ok: false, reason: "This order's delivery fee isn't recorded, so it can't be priced for the network." }

  const distanceMeters = haversineMeters(input.pickup, input.dropoff)
  if (distanceMeters > NETWORK_PRICING.maxRadiusKm * 1000) {
    return { ok: false, reason: `This address is more than ${NETWORK_PRICING.maxRadiusKm} km from the shop.` }
  }

  const quoteFeeCents = Math.max(NETWORK_PRICING.minimumFeeCents, input.customerFeeCents)
  const platformFeeCents = Math.floor((quoteFeeCents * NETWORK_PRICING.platformFeeBps) / 10_000)

  return {
    ok: true,
    quote: {
      distanceMeters,
      quoteFeeCents,
      platformFeeCents,
      driverEarningCents: quoteFeeCents - platformFeeCents,
      customerFeeCents: input.customerFeeCents,
      merchantCostCents: quoteFeeCents - input.customerFeeCents,
      snapshot: {
        version: NETWORK_PRICING.version,
        customerFeeCents: input.customerFeeCents,
        roadKm: roadKm(input.pickup, input.dropoff),
        minimumFeeCents: NETWORK_PRICING.minimumFeeCents,
        platformFeeBps: NETWORK_PRICING.platformFeeBps,
      },
    },
  }
}
