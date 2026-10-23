/**
 * Driver legal documents — a TECHNICAL gate, not legal text. The documents
 * themselves are written and published outside this codebase; the app only
 * knows which version is current and where it lives:
 *
 *   DRIVER_TERMS_VERSION    DRIVER_TERMS_URL
 *   DRIVER_PRIVACY_VERSION  DRIVER_PRIVACY_URL
 *
 * Until all four are set (and valid) no driver can accept terms, submit an
 * application or be approved. An acceptance is recorded only for the version
 * that is configured at that moment — never for a version that doesn't exist.
 */

export type DriverLegalKind = 'TERMS' | 'PRIVACY'

export interface DriverLegalDocument {
  kind: DriverLegalKind
  version: string
  url: string
}

export type DriverLegalConfig = { ok: true; terms: DriverLegalDocument; privacy: DriverLegalDocument } | { ok: false; missing: string[] }

const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/

function validUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

function read(kind: DriverLegalKind, missing: string[]): DriverLegalDocument | null {
  const prefix = kind === 'TERMS' ? 'DRIVER_TERMS' : 'DRIVER_PRIVACY'
  const version = process.env[`${prefix}_VERSION`]?.trim()
  const url = validUrl(process.env[`${prefix}_URL`]?.trim())
  if (!version || !VERSION.test(version)) missing.push(`${prefix}_VERSION`)
  if (!url) missing.push(`${prefix}_URL (https)`)
  return version && VERSION.test(version) && url ? { kind, version, url } : null
}

export function driverLegalConfig(): DriverLegalConfig {
  const missing: string[] = []
  const terms = read('TERMS', missing)
  const privacy = read('PRIVACY', missing)
  return terms && privacy ? { ok: true, terms, privacy } : { ok: false, missing }
}

/** Whether a driver's recorded acceptance matches the CURRENT configured versions. */
export function acceptedCurrentLegal(
  profile: { agreementVersion: string | null; agreementAcceptedAt: Date | null; privacyVersion: string | null; privacyAcceptedAt: Date | null },
  config: DriverLegalConfig = driverLegalConfig(),
): boolean {
  if (!config.ok) return false
  return (
    Boolean(profile.agreementAcceptedAt) &&
    profile.agreementVersion === config.terms.version &&
    Boolean(profile.privacyAcceptedAt) &&
    profile.privacyVersion === config.privacy.version
  )
}
