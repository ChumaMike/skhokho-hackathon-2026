/**
 * Google Geocoding API wrapper.
 *
 * Deliberately knows nothing about businesses or orders — turns an address
 * string into coordinates, or returns null. Callers decide whether a null
 * result is fatal (e.g. PER_KM delivery pricing blocks on it) or cosmetic
 * (e.g. a map's destination pin, which just doesn't render).
 */

export interface GeocodeResult {
  lat: number
  lng: number
}

const GEOCODE_ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json'

export function isGeocodingConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY)
}

/**
 * Resolves a free-text address to coordinates. Never throws — any failure
 * (no API key configured, network error, timeout, zero results, a non-OK
 * status from Google) returns null rather than propagating an error, since
 * a geocoding hiccup should never crash a settings save or a checkout quote
 * outright; the caller decides what null means for its own flow.
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY
  const trimmed = address.trim()
  if (!key || !trimmed) return null

  try {
    const url = `${GEOCODE_ENDPOINT}?address=${encodeURIComponent(trimmed)}&region=za&key=${key}`
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null

    const data = (await res.json()) as {
      status: string
      results?: Array<{ geometry: { location: { lat: number; lng: number } } }>
    }
    if (data.status !== 'OK' || !data.results?.[0]) return null

    const { lat, lng } = data.results[0].geometry.location
    if (typeof lat !== 'number' || typeof lng !== 'number') return null
    return { lat, lng }
  } catch {
    return null
  }
}
