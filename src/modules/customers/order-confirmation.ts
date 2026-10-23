/**
 * What the order confirmation page says about time — "usually ready in
 * about N minutes" and an expected-ready clock time.
 *
 * The preparation time is a merchant setting under `settings.ordering.
 * prepMinutes` (Tab 5 owns the setting and its UI; this reads it
 * tolerantly). A business that has never set one gets no time promise at
 * all — never an invented number.
 */

export const MAX_PREP_MINUTES = 24 * 60

/** `settings.ordering.prepMinutes` as a positive whole number of minutes, or null when unset/invalid. */
export function readPrepMinutes(settings: unknown): number | null {
  const ordering = (settings as { ordering?: { prepMinutes?: unknown } } | null)?.ordering
  const value = ordering?.prepMinutes
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_PREP_MINUTES ? value : null
}

const CLOCK = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false })

export interface EtaView {
  /** "about 20–30 min" */
  window: string
  /** Expected-ready clock time, "14:35", or null when it's already passed. */
  readyBy: string | null
  /** "ready" once the shop has marked it so. */
  state: 'expected' | 'ready' | 'done'
}

/**
 * The time line for one order. Prep time counts from the moment the order
 * was placed; the window is prep → prep + 10 minutes because a kitchen
 * estimate is never exact. For a delivery the driver's own ETA on the
 * delivery page is the better number once the order is out, so the window
 * stays about the kitchen only.
 */
export function orderEta(opts: { status: string; placedAt: Date; prepMinutes: number | null; now?: Date }): EtaView | null {
  if (['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(opts.status)) return null
  if (opts.status === 'READY') return { window: 'ready now', readyBy: null, state: 'ready' }
  if (opts.prepMinutes === null) return null
  const now = opts.now ?? new Date()
  const readyAt = new Date(opts.placedAt.getTime() + opts.prepMinutes * 60_000)
  const window = `about ${opts.prepMinutes}–${opts.prepMinutes + 10} min`
  return { window, readyBy: readyAt.getTime() > now.getTime() ? CLOCK.format(readyAt) : null, state: 'expected' }
}
