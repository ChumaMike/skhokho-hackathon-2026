/**
 * The ONE distance rule for delivery pricing — used by the customer quote
 * (storefront-cart.ts via delivery-quote.ts) AND Skhokholetha network pricing,
 * so a shop's distance fee and the network's cost are computed from the same
 * number. Straight-line × ROAD_FACTOR, rounded UP to the next 100 m, so the
 * figure is stable and errs in the driver's favour. No routing API.
 */

export interface LatLng {
  lat: number
  lng: number
}

/** Straight-line distance × this ≈ road distance. */
export const ROAD_FACTOR = 1.3

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))))
}

/** Road-ish kilometres, one decimal, rounded up. */
export function roadKm(a: LatLng, b: LatLng): number {
  return Math.ceil((haversineMeters(a, b) * ROAD_FACTOR) / 100) / 10
}

export function isValidLatLng(p: { lat: unknown; lng: unknown }): p is LatLng {
  return (
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180 &&
    !(p.lat === 0 && p.lng === 0)
  )
}
