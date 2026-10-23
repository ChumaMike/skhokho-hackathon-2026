/**
 * The customer's own delivery page link (Skhokholetha), kept ONLY in the
 * customer's browser. The business never receives it, so the drop-off code
 * on that page can't reach the shop. Storage can be unavailable (private
 * mode, blocked site data) — every access is guarded; the confirmation email
 * is the other copy.
 */

const key = (orderId: string) => `skhokho-delivery:${orderId}`

export function rememberDeliveryUrl(orderId: string, url: string | null | undefined): void {
  if (!url) return
  try {
    window.localStorage.setItem(key(orderId), url)
  } catch {
    // storage unavailable — the emailed link still works
  }
}

export function recallDeliveryUrl(orderId: string): string | null {
  try {
    const url = window.localStorage.getItem(key(orderId))
    return url && /^https?:\/\/[^\s]+\/delivery\/[A-Za-z0-9_-]{20,100}$/.test(url) ? url : null
  } catch {
    return null
  }
}
