/**
 * Data minimisation for anything written to logs or the audit trail.
 *
 * Keys that name a secret are dropped entirely (not masked — a masked value
 * still reveals length and presence). Strings are capped, nesting is capped,
 * and long digit runs that look like bank/card numbers are masked even under
 * innocent-looking keys.
 */

const SENSITIVE_KEY = /pass(word)?|pwd|otp|totp|mfa.?code|recovery|secret|token|cookie|authori[sz]ation|bearer|api.?key|private|signature|nonce|cipher|account.?(number|no)|iban|card|cvv|pin\b|code$|^code|dropoff.?code|pickup.?code|tracking|customer.?key/i
const MAX_STRING = 300
const MAX_KEYS = 40
const MAX_DEPTH = 4

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key)
}

function scrubString(s: string): string {
  // 9+ consecutive digits (bank account, card, ID numbers) → keep the last 4 only.
  const masked = s.replace(/\d{9,}/g, (m) => `…${m.slice(-4)}`)
  return masked.length > MAX_STRING ? `${masked.slice(0, MAX_STRING)}…` : masked
}

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return scrubString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (depth >= MAX_DEPTH) return '[nested]'
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)) {
      if (isSensitiveKey(k)) continue
      out[k] = redact(v, depth + 1)
    }
    return out
  }
  return undefined
}
