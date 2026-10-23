/**
 * Formatter over `Business.operatingHours` — schema-only today (confirmed:
 * src/app/api/store/availability/route.ts falls back to a fixed default
 * window rather than reading it, and tenant.service.ts's CreateBusinessSchema
 * validates it as `z.record(z.any())`, i.e. no canonical shape enforced
 * anywhere yet). This is the first read path, so it has to be defensive
 * rather than assume a shape: malformed/legacy/missing data all resolve to
 * an empty list, never a throw — same discipline as storefront-theme.ts.
 *
 * Expected shape when present (matches prisma/seed.ts's demo data, the only
 * real precedent in the codebase):
 *   { monday?: { open?: string; close?: string; closed?: boolean }, ... }
 */

const WEEKDAYS: { key: string; label: string }[] = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
]

export interface FormattedDayHours {
  day: string
  label: string
}

export function formatOperatingHours(raw: unknown): FormattedDayHours[] {
  if (!raw || typeof raw !== 'object') return []
  const data = raw as Record<string, unknown>
  const result: FormattedDayHours[] = []

  for (const { key, label } of WEEKDAYS) {
    const entry = data[key]
    if (!entry || typeof entry !== 'object') continue
    const { open, close, closed } = entry as { open?: unknown; close?: unknown; closed?: unknown }
    if (closed === true) {
      result.push({ day: label, label: 'Closed' })
    } else if (typeof open === 'string' && typeof close === 'string' && open && close) {
      result.push({ day: label, label: `${open} – ${close}` })
    }
  }

  return result
}

/** "HH:MM" -> minutes since midnight, or NaN if not a valid parseable time. */
function parseMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) return NaN
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return NaN
  return hour * 60 + minute
}

type DayClassification =
  | { kind: 'missing' }
  | { kind: 'malformed' }
  | { kind: 'closed' }
  | { kind: 'open'; openMinutes: number; closeMinutes: number }

function classifyDay(data: Record<string, unknown>, key: string): DayClassification {
  const entry = data[key]
  if (!entry || typeof entry !== 'object') return { kind: 'missing' }
  const { open, close, closed } = entry as { open?: unknown; close?: unknown; closed?: unknown }
  if (closed === true) return { kind: 'closed' }
  if (typeof open !== 'string' || typeof close !== 'string' || !open || !close) return { kind: 'malformed' }
  const openMinutes = parseMinutes(open)
  const closeMinutes = parseMinutes(close)
  if (Number.isNaN(openMinutes) || Number.isNaN(closeMinutes)) return { kind: 'malformed' }
  return { kind: 'open', openMinutes, closeMinutes }
}

/**
 * "Is this business open right now, in South Africa (Africa/Johannesburg,
 * UTC+2, no DST)." Fail-open on anything missing/malformed: a business that
 * has never configured hours — every business today — must never be locked
 * out of taking orders, same posture formatOperatingHours already
 * establishes for display. Only an explicit `closed: true`, or a real,
 * parseable window that genuinely excludes the current time, returns false.
 *
 * Deliberately computes the current weekday/time via Intl.DateTimeFormat
 * with an explicit timeZone rather than the server's own local time —
 * Vercel runs these functions in UTC, and South Africa has no DST, so a
 * naive `now.getDay()`/`now.getHours()` would be wrong by up to 2 hours,
 * not just a cosmetic display bug like the app's existing un-timezoned
 * `toLocaleString` calls elsewhere.
 *
 * Checks TWO days' entries, not just today's: an overnight window (e.g.
 * Monday 18:00-02:00) is stored on the day it STARTS, so being open at
 * Tuesday 01:00 depends on MONDAY's entry, not Tuesday's own. Checking only
 * today's entry with wraparound math applied to itself would wrongly open
 * the business from midnight until today's own (not-yet-started) opening
 * time whenever today also happens to be configured as an overnight day.
 */
export function isBusinessOpenNow(raw: unknown, now: Date = new Date()): boolean {
  if (!raw || typeof raw !== 'object') return true
  const data = raw as Record<string, unknown>

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Johannesburg',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const weekday = parts.find((p) => p.type === 'weekday')?.value.toLowerCase()
  // hour12: false can format midnight as "24" in some ICU implementations —
  // normalise back into 0-23 rather than letting it corrupt nowMinutes.
  const hourRaw = Number(parts.find((p) => p.type === 'hour')?.value)
  const hour = hourRaw === 24 ? 0 : hourRaw
  const minute = Number(parts.find((p) => p.type === 'minute')?.value)
  if (!weekday || !Number.isFinite(hour) || !Number.isFinite(minute)) return true // formatting failed -> fail open
  const nowMinutes = hour * 60 + minute

  const todayIndex = WEEKDAYS.findIndex((d) => d.key === weekday)
  if (todayIndex === -1) return true // shouldn't happen — defensive fail-open
  const yesterdayKey = WEEKDAYS[(todayIndex + 6) % 7].key

  const today = classifyDay(data, weekday)
  if (today.kind === 'missing' || today.kind === 'malformed') return true // today's own config absent/broken -> fail open

  if (today.kind === 'open') {
    if (today.closeMinutes > today.openMinutes) {
      // Normal same-day window.
      if (nowMinutes >= today.openMinutes && nowMinutes < today.closeMinutes) return true
    } else {
      // Overnight window STARTING today — only the "after opening, before midnight" half.
      if (nowMinutes >= today.openMinutes) return true
    }
  }
  // today.kind === 'closed' falls through: still need to check yesterday's
  // overnight tail below before concluding the business is closed.

  const yesterday = classifyDay(data, yesterdayKey)
  if (yesterday.kind === 'open' && yesterday.closeMinutes <= yesterday.openMinutes) {
    // The "after midnight, before closing" half of yesterday's overnight window.
    if (nowMinutes < yesterday.closeMinutes) return true
  }

  return false
}
