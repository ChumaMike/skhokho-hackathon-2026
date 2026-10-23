/**
 * Skhokholetha production switches. Server-side only, read from the
 * environment on every call (so an env change takes effect without a code
 * change), and OFF unless set to exactly "true" — production starts in the
 * safest state.
 *
 *   SKHOKHOLETHA_ENABLED       master switch: nothing new starts while it's off
 *   DRIVER_SIGNUP_ENABLED      new driver accounts and application submission
 *   DELIVERY_REQUESTS_ENABLED  shops requesting a network driver
 *   DRIVER_APPROVALS_ENABLED   admins approving / reinstating drivers
 *
 * Every sub-switch also needs the master switch. Switching anything off never
 * strands work already in progress: a driver mid-delivery can still finish it,
 * shops and admins can still cancel, drivers can always go OFFLINE, and admins
 * can always read applications, deliveries and payouts.
 */

export const LETHA_FLAG_NAMES = ['SKHOKHOLETHA_ENABLED', 'DRIVER_SIGNUP_ENABLED', 'DELIVERY_REQUESTS_ENABLED', 'DRIVER_APPROVALS_ENABLED'] as const
export type LethaFlagName = (typeof LETHA_FLAG_NAMES)[number]

const on = (name: LethaFlagName) => process.env[name] === 'true'

export type LethaFeature = 'network' | 'driverSignup' | 'deliveryRequests' | 'driverApprovals'

const SUB_FLAG: Record<Exclude<LethaFeature, 'network'>, LethaFlagName> = {
  driverSignup: 'DRIVER_SIGNUP_ENABLED',
  deliveryRequests: 'DELIVERY_REQUESTS_ENABLED',
  driverApprovals: 'DRIVER_APPROVALS_ENABLED',
}

export function lethaEnabled(feature: LethaFeature): boolean {
  if (!on('SKHOKHOLETHA_ENABLED')) return false
  return feature === 'network' ? true : on(SUB_FLAG[feature])
}

const DISABLED_MESSAGE: Record<LethaFeature, string> = {
  network: 'Skhokholetha deliveries aren’t available yet.',
  driverSignup: 'Driver sign-ups aren’t open yet.',
  deliveryRequests: 'Requesting a Skhokholetha driver isn’t available yet.',
  driverApprovals: 'Driver approvals are switched off.',
}

export class FeatureDisabledError extends Error {
  constructor(readonly feature: LethaFeature) {
    super(DISABLED_MESSAGE[feature])
    this.name = 'FeatureDisabledError'
  }
}

/** Throws FeatureDisabledError unless the feature is switched on. Call it in the SERVICE, not only the UI. */
export function requireLetha(feature: LethaFeature): void {
  if (!lethaEnabled(feature)) throw new FeatureDisabledError(feature)
}
