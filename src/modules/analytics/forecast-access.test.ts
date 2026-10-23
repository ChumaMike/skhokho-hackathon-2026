import test from 'node:test'
import assert from 'node:assert/strict'
import { ALL_PERMISSIONS, NO_PERMISSIONS, type StaffPermissions } from '@/types'
import { STAFF_PRESETS } from '@/modules/staff/staff-presets'
import { resolveEntitlements, type Entitlements, type PlanInput } from '@/modules/billing/entitlements'
import { forecastAccess, FULL_REPORT_CONTENTS } from './forecast-access'

/**
 * The plan and permission matrix for the whole feature. Plan codes here are
 * arbitrary on purpose — nothing may depend on a code — and the entitlement
 * rows are the ones the seeded plans actually carry
 * (20261004130000_plans_and_entitlements): FREE has basic_analytics, GROW and
 * PRO add advanced_analytics.
 */

const NOW = new Date('2026-10-22T09:00:00Z')

const FREE_PLAN: PlanInput = {
  id: 'p-free',
  code: 'ANY_FREE',
  name: 'Free',
  entitlements: [
    { featureKey: 'basic_analytics', enabled: true, limitValue: null },
    { featureKey: 'loyalty', enabled: true, limitValue: null },
  ],
}

const GROW_PLAN: PlanInput = {
  id: 'p-grow',
  code: 'ANY_GROW',
  name: 'Grow',
  entitlements: [
    { featureKey: 'basic_analytics', enabled: true, limitValue: null },
    { featureKey: 'advanced_analytics', enabled: true, limitValue: null },
  ],
}

const NO_ANALYTICS_PLAN: PlanInput = {
  id: 'p-none',
  code: 'ANY_NONE',
  name: 'Bare',
  entitlements: [{ featureKey: 'loyalty', enabled: true, limitValue: null }],
}

function on(plan: PlanInput): Entitlements {
  return resolveEntitlements({
    subscription: { planId: plan.id, status: 'ACTIVE', currentPeriodEnd: null, graceEndsAt: null },
    subscribedPlan: plan,
    defaultPlan: plan,
    overrides: [],
    now: NOW,
  })
}

const FREE = on(FREE_PLAN)
const GROW = on(GROW_PLAN)
const BARE = on(NO_ANALYTICS_PLAN)

const access = (permissions: StaffPermissions, entitlements: Entitlements) => forecastAccess({ permissions, entitlements })

// ---------------------------------------------------------------------------
// The plan decides how much of the feature the BUSINESS has
// ---------------------------------------------------------------------------

test('FREE gets the forecast and its summary, not the full report', () => {
  const owner = access(ALL_PERMISSIONS, FREE)
  assert.equal(owner.forecast, true)
  assert.equal(owner.fullReport, false)
  assert.equal(owner.winBack, false)
  assert.equal(owner.contactNumbers, false)
  assert.equal(owner.forecastBlockedBy, 'ok')
  assert.equal(owner.reportBlockedBy, 'plan')
  assert.equal(owner.winBackBlockedBy, 'plan')
})

test('GROW gets everything an owner can be shown', () => {
  const owner = access(ALL_PERMISSIONS, GROW)
  assert.deepEqual(owner, {
    forecast: true,
    fullReport: true,
    winBack: true,
    contactNumbers: true,
    forecastBlockedBy: 'ok',
    reportBlockedBy: 'ok',
    winBackBlockedBy: 'ok',
  })
})

test('a plan with no analytics at all gets none of it', () => {
  const owner = access(ALL_PERMISSIONS, BARE)
  assert.equal(owner.forecast, false)
  assert.equal(owner.forecastBlockedBy, 'plan')
  assert.equal(owner.fullReport, false)
  assert.equal(owner.winBack, false)
})

// ---------------------------------------------------------------------------
// Permissions decide what the PERSON may see of it
// ---------------------------------------------------------------------------

test('without canViewAnalytics the plan makes no difference', () => {
  for (const entitlements of [FREE, GROW]) {
    const nobody = access(NO_PERMISSIONS, entitlements)
    assert.equal(nobody.forecast, false)
    assert.equal(nobody.fullReport, false)
    assert.equal(nobody.winBack, false)
    assert.equal(nobody.contactNumbers, false)
    assert.equal(nobody.forecastBlockedBy, 'permission')
    assert.equal(nobody.reportBlockedBy, 'permission')
    assert.equal(nobody.winBackBlockedBy, 'permission')
  }
})

test('analytics permission alone does not open the customer list', () => {
  const analystOnly: StaffPermissions = { ...NO_PERMISSIONS, canViewAnalytics: true }
  const result = access(analystOnly, GROW)
  assert.equal(result.forecast, true)
  assert.equal(result.fullReport, true, 'the funding report holds no customer details')
  assert.equal(result.winBack, false)
  assert.equal(result.winBackBlockedBy, 'customer-permission')
  assert.equal(result.contactNumbers, false)
})

test('seeing customers does not also mean seeing their phone numbers', () => {
  const loyaltyOnly: StaffPermissions = { ...NO_PERMISSIONS, canViewAnalytics: true, canIssueLoyalty: true }
  const result = access(loyaltyOnly, GROW)
  assert.equal(result.winBack, true)
  assert.equal(result.contactNumbers, false)

  const alsoOrders: StaffPermissions = { ...loyaltyOnly, canManageOrders: true }
  assert.equal(access(alsoOrders, GROW).contactNumbers, true)

  const alsoDeliveries: StaffPermissions = { ...loyaltyOnly, canManageDeliveries: true }
  assert.equal(access(alsoDeliveries, GROW).contactNumbers, true)
})

test('a contact number is never offered without the customer list, whatever else the role allows', () => {
  const ordersButNoCustomers: StaffPermissions = {
    ...NO_PERMISSIONS,
    canViewAnalytics: true,
    canManageOrders: true,
    canManageDeliveries: true,
  }
  const result = access(ordersButNoCustomers, GROW)
  assert.equal(result.winBack, false)
  assert.equal(result.contactNumbers, false)
})

// ---------------------------------------------------------------------------
// The real role presets, on the two plans that matter
// ---------------------------------------------------------------------------

test('every role preset lands where its own permissions put it, on the full plan', () => {
  for (const [name, preset] of Object.entries(STAFF_PRESETS)) {
    const permissions = preset.permissions
    const result = access(permissions, GROW)
    assert.equal(result.forecast, permissions.canViewAnalytics, `${name}: forecast`)
    // The funding report holds no customer details, so analytics permission
    // is the whole question for it.
    assert.equal(result.fullReport, permissions.canViewAnalytics, `${name}: report`)
    assert.equal(
      result.winBack,
      permissions.canViewAnalytics && (permissions.canManageCustomers || permissions.canIssueLoyalty),
      `${name}: win-back`,
    )
    assert.equal(
      result.contactNumbers,
      result.winBack && (permissions.canManageOrders || permissions.canManageDeliveries),
      `${name}: contact numbers`,
    )
  }
})

test('a manager sees the whole feature; kitchen and counter staff see none of it', () => {
  const manager = access(STAFF_PRESETS.MANAGER.permissions, GROW)
  assert.equal(manager.forecast, true)
  assert.equal(manager.winBack, true)

  // The same line the Analytics page already draws for these roles.
  for (const preset of ['KITCHEN', 'COUNTER'] as const) {
    const result = access(STAFF_PRESETS[preset].permissions, GROW)
    assert.equal(result.forecast, false, preset)
    assert.equal(result.fullReport, false, preset)
    assert.equal(result.winBack, false, preset)
    assert.equal(result.contactNumbers, false, preset)
    assert.equal(result.forecastBlockedBy, 'permission', preset)
  }
})

test('nothing in the gating depends on the plan code or name', () => {
  const renamed: PlanInput = { ...GROW_PLAN, id: 'p-x', code: 'SOMETHING_ELSE', name: 'Whatever' }
  assert.deepEqual(access(ALL_PERMISSIONS, on(renamed)), access(ALL_PERMISSIONS, GROW))
})

test('what the smaller plan is missing is named honestly, and promises nothing extra', () => {
  assert.equal(FULL_REPORT_CONTENTS.length, 3)
  const text = FULL_REPORT_CONTENTS.join(' ')
  assert.match(text, /funding-readiness one-pager/)
  assert.match(text, /win back/)
  assert.match(text, /six months of sales history/)
  // No new capability is implied — everything listed is built and gated on
  // advanced_analytics, which already exists.
  assert.doesNotMatch(text, /coming soon|beta|will be/i)
})
