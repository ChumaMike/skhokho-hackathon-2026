/**
 * Is this business taking orders RIGHT NOW? One answer for the quote engine,
 * the checkout page, the storefront badge and the dashboard — so none of them
 * can disagree.
 *
 *   OPEN    inside opening hours (or no hours configured) and not paused
 *   CLOSED  outside the configured opening hours
 *   PAUSED  the merchant pressed "Pause orders" (ordering.pausedUntil in the
 *           future) — weekly hours are untouched
 *
 * Pause wins over hours: a paused shop is paused even inside its hours.
 */

import { isBusinessOpenNow, formatOperatingHours } from './storefront-hours'
import { getOrderingSettings } from './capabilities'

export type TradingState = 'OPEN' | 'CLOSED' | 'PAUSED'

export interface TradingStatus {
  state: TradingState
  /** When PAUSED: the moment orders resume (ISO). */
  pausedUntil?: string
  /** Short, customer-safe wording for a badge or banner. */
  label: string
  /** Today's hours, e.g. "09:00 – 20:00", or "Closed today", when configured. */
  todayHours?: string
}

const SAST = 'Africa/Johannesburg'

function todayLabel(operatingHours: unknown, now: Date): string | undefined {
  const rows = formatOperatingHours(operatingHours)
  if (rows.length === 0) return undefined
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: SAST, weekday: 'long' }).format(now)
  const today = rows.find((r) => r.day === weekday)
  if (!today) return undefined
  return today.label === 'Closed' ? 'Closed today' : today.label
}

export function getTradingStatus(business: { settings: unknown; operatingHours: unknown }, now: Date = new Date()): TradingStatus {
  const todayHours = todayLabel(business.operatingHours, now)
  const { pausedUntil } = getOrderingSettings(business)
  if (pausedUntil && new Date(pausedUntil).getTime() > now.getTime()) {
    const until = new Date(pausedUntil)
    const time = new Intl.DateTimeFormat('en-ZA', { timeZone: SAST, hour: '2-digit', minute: '2-digit' }).format(until)
    return { state: 'PAUSED', pausedUntil: until.toISOString(), label: `Orders paused — back at ${time}`, todayHours }
  }
  if (!isBusinessOpenNow(business.operatingHours, now)) {
    return { state: 'CLOSED', label: todayHours ? `Closed now · ${todayHours}` : 'Closed now', todayHours }
  }
  return { state: 'OPEN', label: todayHours ? `Open now · ${todayHours}` : 'Open now', todayHours }
}

export function isTakingOrders(business: { settings: unknown; operatingHours: unknown }, now: Date = new Date()): boolean {
  return getTradingStatus(business, now).state === 'OPEN'
}
