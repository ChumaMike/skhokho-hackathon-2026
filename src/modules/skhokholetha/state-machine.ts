/**
 * The network-delivery state machine — the ONLY definition of which status
 * changes exist, who may make them, and what they need. Pure: services ask
 * `transitionFor(action, from)` and then perform the change as a conditional
 * UPDATE (`WHERE status = from`), so a stale or concurrent request can never
 * move a delivery anywhere this table doesn't allow.
 *
 * There is no "set status" endpoint anywhere: callers name an ACTION, never
 * a target status.
 */

import type { NetworkDeliveryStatus } from '@prisma/client'

export type DeliveryActorType = 'SHOP' | 'DRIVER' | 'SYSTEM' | 'ADMIN'

export type DeliveryAction =
  | 'START_SEARCH'
  | 'OFFERS_SENT'
  | 'OFFERS_LAPSED'
  | 'ACCEPT'
  | 'HEAD_TO_PICKUP'
  | 'ARRIVE_PICKUP'
  | 'CONFIRM_PICKUP'
  | 'START_TRANSIT'
  | 'ARRIVE_DROPOFF'
  | 'CONFIRM_DELIVERY'
  | 'CANCEL'
  | 'FAIL'
  | 'START_RETURN'
  | 'CONFIRM_RETURN'
  | 'DISPUTE'

export interface TransitionRule {
  from: readonly NetworkDeliveryStatus[]
  to: NetworkDeliveryStatus
  actors: readonly DeliveryActorType[]
  /** The assigned driver only (not any driver). */
  assignedDriverOnly?: boolean
  /** What must be presented for this action to succeed. */
  requires?: 'PICKUP_CODE' | 'DROPOFF_CODE' | 'REASON' | 'LIVE_OFFER'
  /** Event type written to delivery_events. */
  event: string
}

const BEFORE_PICKUP = ['CREATED', 'SEARCHING', 'OFFERED', 'ASSIGNED', 'DRIVER_TO_PICKUP', 'ARRIVED_PICKUP'] as const
const CARRYING = ['PICKED_UP', 'IN_TRANSIT', 'ARRIVED_DROPOFF'] as const

export const TRANSITIONS: Record<DeliveryAction, TransitionRule> = {
  START_SEARCH: { from: ['CREATED'], to: 'SEARCHING', actors: ['SYSTEM'], event: 'search_started' },
  OFFERS_SENT: { from: ['SEARCHING'], to: 'OFFERED', actors: ['SYSTEM'], event: 'offers_sent' },
  OFFERS_LAPSED: { from: ['OFFERED'], to: 'SEARCHING', actors: ['SYSTEM'], event: 'offers_lapsed' },
  ACCEPT: { from: ['SEARCHING', 'OFFERED'], to: 'ASSIGNED', actors: ['DRIVER'], requires: 'LIVE_OFFER', event: 'driver_assigned' },
  HEAD_TO_PICKUP: { from: ['ASSIGNED'], to: 'DRIVER_TO_PICKUP', actors: ['DRIVER'], assignedDriverOnly: true, event: 'heading_to_pickup' },
  ARRIVE_PICKUP: { from: ['ASSIGNED', 'DRIVER_TO_PICKUP'], to: 'ARRIVED_PICKUP', actors: ['DRIVER'], assignedDriverOnly: true, event: 'arrived_pickup' },
  CONFIRM_PICKUP: { from: ['ARRIVED_PICKUP'], to: 'PICKED_UP', actors: ['DRIVER'], assignedDriverOnly: true, requires: 'PICKUP_CODE', event: 'pickup_verified' },
  START_TRANSIT: { from: ['PICKED_UP'], to: 'IN_TRANSIT', actors: ['DRIVER'], assignedDriverOnly: true, event: 'departed' },
  ARRIVE_DROPOFF: { from: ['PICKED_UP', 'IN_TRANSIT'], to: 'ARRIVED_DROPOFF', actors: ['DRIVER'], assignedDriverOnly: true, event: 'arrived_dropoff' },
  CONFIRM_DELIVERY: { from: ['ARRIVED_DROPOFF'], to: 'DELIVERED', actors: ['DRIVER'], assignedDriverOnly: true, requires: 'DROPOFF_CODE', event: 'delivered' },
  CANCEL: { from: BEFORE_PICKUP, to: 'CANCELLED', actors: ['SHOP', 'ADMIN'], requires: 'REASON', event: 'cancelled' },
  FAIL: { from: CARRYING, to: 'FAILED', actors: ['DRIVER', 'ADMIN'], assignedDriverOnly: true, requires: 'REASON', event: 'failed' },
  START_RETURN: { from: ['FAILED'], to: 'RETURNING', actors: ['DRIVER', 'ADMIN'], assignedDriverOnly: true, event: 'return_started' },
  CONFIRM_RETURN: { from: ['RETURNING'], to: 'RETURNED', actors: ['DRIVER', 'ADMIN'], assignedDriverOnly: true, requires: 'PICKUP_CODE', event: 'returned' },
  DISPUTE: {
    from: ['ASSIGNED', 'DRIVER_TO_PICKUP', 'ARRIVED_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_DROPOFF', 'DELIVERED', 'FAILED', 'RETURNING'],
    to: 'DISPUTED',
    actors: ['ADMIN'],
    requires: 'REASON',
    event: 'dispute_opened',
  },
}

/** No action leaves these. */
export const TERMINAL_STATUSES: readonly NetworkDeliveryStatus[] = ['DELIVERED', 'CANCELLED', 'RETURNED']

/** A driver holding one of these is busy (mirrors the partial unique index in the migration). */
export const DRIVER_ACTIVE_STATUSES: readonly NetworkDeliveryStatus[] = [
  'ASSIGNED',
  'DRIVER_TO_PICKUP',
  'ARRIVED_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'ARRIVED_DROPOFF',
  'RETURNING',
]

/** Statuses during which the customer may see the driver's live position. */
export const CUSTOMER_LIVE_STATUSES: readonly NetworkDeliveryStatus[] = ['PICKED_UP', 'IN_TRANSIT', 'ARRIVED_DROPOFF']

/** Statuses after which the shop's pickup is no longer outstanding. */
export const NOT_YET_COLLECTED: readonly NetworkDeliveryStatus[] = BEFORE_PICKUP

export class InvalidTransitionError extends Error {
  constructor(readonly action: DeliveryAction, readonly from: NetworkDeliveryStatus) {
    super(`That step isn't possible right now (${action} from ${from}).`)
    this.name = 'InvalidTransitionError'
  }
}

/** The rule for `action` from `from` by `actor`, or throws. */
export function transitionFor(action: DeliveryAction, from: NetworkDeliveryStatus, actor: DeliveryActorType): TransitionRule {
  const rule = TRANSITIONS[action]
  if (!rule || !rule.from.includes(from) || !rule.actors.includes(actor)) throw new InvalidTransitionError(action, from)
  return rule
}

export function canTransition(action: DeliveryAction, from: NetworkDeliveryStatus, actor: DeliveryActorType): boolean {
  try {
    transitionFor(action, from, actor)
    return true
  } catch {
    return false
  }
}

/** Every status reachable from `from` in one step, by anyone. */
export function nextStatuses(from: NetworkDeliveryStatus): NetworkDeliveryStatus[] {
  return [...new Set(Object.values(TRANSITIONS).filter((r) => r.from.includes(from)).map((r) => r.to))]
}

/** Driver-app actions that are plain state steps (no code, no reason). */
export const DRIVER_STEP_ACTIONS = ['HEAD_TO_PICKUP', 'ARRIVE_PICKUP', 'START_TRANSIT', 'ARRIVE_DROPOFF', 'START_RETURN'] as const
export type DriverStepAction = (typeof DRIVER_STEP_ACTIONS)[number]
