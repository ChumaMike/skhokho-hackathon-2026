/**
 * The ONE delivery-fee rule for a customer order. Pure: give it the shop's
 * settings, its zones, the drop-off (coordinates and/or a chosen zone) and
 * it returns ONE exact fee in integer cents — or a reason it can't.
 *
 *   FLAT    feeCents
 *   PER_KM  baseFeeCents + perKmFeeCents × roadKm, floored at minFeeCents,
 *           refused beyond maxDistanceKm  ("Distance" in the UI)
 *   ZONE    the chosen (or suburb-matched) active zone's feeCents
 *
 * Callers: storefront-cart.ts (what the customer sees and pays) and
 * Skhokholetha (which uses the same fee as the network cost basis — see
 * skhokholetha/pricing.ts). Nothing else prices a delivery.
 */

import type { DeliverySettings } from '@/modules/tenant/capabilities'
import { isValidLatLng, roadKm, type LatLng } from './distance'
import { matchZoneByAddress, type DeliveryZoneRow } from './zones.service'

export type DeliveryQuoteFailure =
  | 'DELIVERY_UNAVAILABLE'
  | 'DELIVERY_PRICING_UNAVAILABLE'
  | 'DELIVERY_DISTANCE_UNAVAILABLE'
  | 'OUTSIDE_SERVICE_AREA'

export interface DeliveryQuote {
  feeCents: number
  pricingMode: DeliverySettings['pricingMode']
  /** ZONE: the area the fee came from. */
  zone?: { id: string; name: string; minOrderCents: number | null }
  /** PER_KM: road-ish distance used. */
  distanceKm?: number
}

export type DeliveryQuoteResult =
  | { ok: true; quote: DeliveryQuote }
  /** Not an error yet — the customer hasn't given what this mode needs (address / area). */
  | { ok: false; pending: true; code: 'DELIVERY_AREA_REQUIRED' | 'DELIVERY_ADDRESS_REQUIRED' }
  | { ok: false; pending: false; code: DeliveryQuoteFailure; reason: string }

export interface DeliveryQuoteInput {
  settings: DeliverySettings
  pickup: { lat: number | null; lng: number | null }
  dropoff?: LatLng | null
  /** Zone the customer picked (must be one of `zones` — ownership was checked by loading zones for THIS business). */
  zoneId?: string | null
  /** Typed address, for SUBURB_LIST auto-matching. */
  address?: string | null
  zones: DeliveryZoneRow[]
}

export function quoteDeliveryFee(input: DeliveryQuoteInput): DeliveryQuoteResult {
  const { settings } = input
  if (!settings.enabled) return { ok: false, pending: false, code: 'DELIVERY_UNAVAILABLE', reason: 'Delivery is not available for this business.' }

  if (settings.pricingMode === 'FLAT') {
    return { ok: true, quote: { feeCents: settings.feeCents, pricingMode: 'FLAT' } }
  }

  if (settings.pricingMode === 'ZONE') {
    const active = input.zones.filter((z) => z.active)
    if (active.length === 0) return { ok: false, pending: false, code: 'DELIVERY_PRICING_UNAVAILABLE', reason: 'This business has not set up its delivery areas yet.' }
    let zone: DeliveryZoneRow | null = null
    if (input.zoneId) {
      zone = active.find((z) => z.id === input.zoneId) ?? null
      if (!zone) return { ok: false, pending: false, code: 'OUTSIDE_SERVICE_AREA', reason: "That delivery area isn't available." }
    } else if (input.address) {
      zone = matchZoneByAddress(active, input.address)
      if (!zone) return { ok: false, pending: true, code: 'DELIVERY_AREA_REQUIRED' }
    } else {
      return { ok: false, pending: true, code: 'DELIVERY_AREA_REQUIRED' }
    }
    return { ok: true, quote: { feeCents: zone.feeCents, pricingMode: 'ZONE', zone: { id: zone.id, name: zone.name, minOrderCents: zone.minOrderCents } } }
  }

  // PER_KM
  const pickup = { lat: input.pickup.lat, lng: input.pickup.lng }
  if (!isValidLatLng(pickup)) return { ok: false, pending: false, code: 'DELIVERY_PRICING_UNAVAILABLE', reason: "Delivery pricing isn't available right now — please contact the business." }
  if (!input.dropoff) return { ok: false, pending: true, code: 'DELIVERY_ADDRESS_REQUIRED' }
  if (!isValidLatLng(input.dropoff)) return { ok: false, pending: false, code: 'DELIVERY_DISTANCE_UNAVAILABLE', reason: "We couldn't locate that address." }
  const km = roadKm(pickup, input.dropoff)
  if (settings.maxDistanceKm > 0 && km > settings.maxDistanceKm) {
    return { ok: false, pending: false, code: 'OUTSIDE_SERVICE_AREA', reason: `This business delivers up to ${settings.maxDistanceKm} km away — that address is about ${km} km.` }
  }
  const raw = settings.baseFeeCents + Math.round(km * settings.perKmFeeCents)
  // Nearest 50c, so the customer sees R37.50 not R37.43 — the distance is an estimate.
  const rounded = Math.round(raw / 50) * 50
  return { ok: true, quote: { feeCents: Math.max(settings.minFeeCents, rounded), pricingMode: 'PER_KM', distanceKm: km } }
}

/** What a storefront shows as "Delivery areas" — ZONE mode only; nothing for other modes. */
export function publicZoneTable(settings: DeliverySettings, zones: DeliveryZoneRow[]): { id: string; name: string; feeCents: number }[] {
  if (!settings.enabled || settings.pricingMode !== 'ZONE') return []
  return zones.filter((z) => z.active).map((z) => ({ id: z.id, name: z.name, feeCents: z.feeCents }))
}
