/**
 * May this business take a booking at this time? (Tab 5)
 *
 * Two checks the booking path never made before:
 *   - the BOOKINGS capability (Settings › Modules / the category default) —
 *     a food vendor with Bookings switched off must not accept one through
 *     the API just because a Service row exists;
 *   - opening hours — a slot must start and end inside the business's hours
 *     for that day, in South African time. A business that has never set
 *     hours fails OPEN (same posture as isBusinessOpenNow for orders); a day
 *     marked closed takes no bookings.
 *
 * Pure functions over the stored shapes; createAppointment and the two
 * storefront routes call them. Overnight windows (18:00–02:00) are treated
 * as running to close + 24h on the day they start.
 */

import { getBusinessCapabilities } from '@/modules/tenant/capabilities'
import type { BusinessCategory } from '@prisma/client'

const SAST = 'Africa/Johannesburg'
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

export type DayWindow = { kind: 'unconfigured' } | { kind: 'closed' } | { kind: 'open'; openMinutes: number; closeMinutes: number }

function parseMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/** The window for one weekday key ("monday"), from the stored operatingHours JSON. */
export function windowForWeekday(operatingHours: unknown, weekday: string): DayWindow {
  if (!operatingHours || typeof operatingHours !== 'object') return { kind: 'unconfigured' }
  const entry = (operatingHours as Record<string, unknown>)[weekday]
  if (!entry || typeof entry !== 'object') return { kind: 'unconfigured' }
  const { open, close, closed } = entry as { open?: unknown; close?: unknown; closed?: unknown }
  if (closed === true) return { kind: 'closed' }
  const openMinutes = parseMinutes(open)
  const closeMinutes = parseMinutes(close)
  if (openMinutes === null || closeMinutes === null) return { kind: 'unconfigured' }
  // An overnight window runs past midnight on the day it starts.
  return { kind: 'open', openMinutes, closeMinutes: closeMinutes <= openMinutes ? closeMinutes + 24 * 60 : closeMinutes }
}

/** The window for a calendar date "YYYY-MM-DD" (a South African date, as the slot picker sends it). */
export function windowForDate(operatingHours: unknown, date: string): DayWindow {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return { kind: 'closed' }
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()]
  return windowForWeekday(operatingHours, weekday)
}

function sastParts(at: Date): { weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: SAST, weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(at)
  const weekday = parts.find((p) => p.type === 'weekday')?.value.toLowerCase() ?? ''
  const hourRaw = Number(parts.find((p) => p.type === 'hour')?.value)
  const hour = hourRaw === 24 ? 0 : hourRaw
  const minute = Number(parts.find((p) => p.type === 'minute')?.value)
  return { weekday, minutes: hour * 60 + minute }
}

/**
 * True when [startTime, endTime) sits inside the hours of the day it starts
 * on (South African time). Unconfigured hours → true; closed day → false.
 */
export function isWithinOpeningHours(operatingHours: unknown, startTime: Date, endTime: Date): boolean {
  const { weekday, minutes } = sastParts(startTime)
  const window = windowForWeekday(operatingHours, weekday)
  if (window.kind === 'unconfigured') return true
  if (window.kind === 'closed') return false
  const durationMinutes = Math.round((endTime.getTime() - startTime.getTime()) / 60_000)
  return minutes >= window.openMinutes && minutes + durationMinutes <= window.closeMinutes
}

export type BookingRefusal = 'BOOKINGS_OFF' | 'OUTSIDE_HOURS'

export class BookingRefusedError extends Error {
  constructor(readonly code: BookingRefusal) {
    super(
      code === 'BOOKINGS_OFF'
        ? 'This business is not taking bookings.'
        : 'That time is outside the business’s opening hours — pick a time while they are open.',
    )
    this.name = 'BookingRefusedError'
  }
}

export interface BookableBusiness {
  category: BusinessCategory
  settings: unknown
  operatingHours: unknown
}

export function bookingRefusal(business: BookableBusiness, startTime: Date, endTime: Date): BookingRefusal | null {
  if (!getBusinessCapabilities(business).has('BOOKINGS')) return 'BOOKINGS_OFF'
  if (!isWithinOpeningHours(business.operatingHours, startTime, endTime)) return 'OUTSIDE_HOURS'
  return null
}

export function assertBookable(business: BookableBusiness, startTime: Date, endTime: Date): void {
  const refusal = bookingRefusal(business, startTime, endTime)
  if (refusal) throw new BookingRefusedError(refusal)
}
