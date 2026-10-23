/**
 * The feature catalogue — every capability a plan can grant, by stable key.
 *
 * Application code asks "does this business have `custom_domain`?", never
 * "is this business on PRO?". Which plan grants which key lives in the
 * `plans` / `plan_entitlements` tables, so packaging and prices change by
 * editing data, not by rewriting the app.
 *
 * Adding a key here makes it known to the resolver; granting it is a
 * plan_entitlements row. A key in the database that isn't listed here is
 * ignored (and can never grant anything).
 *
 * Entitlements say what the BUSINESS may use. They are never authorization:
 * BusinessRole.permissions still decides what a PERSON may do.
 */

export type FeatureKind = 'boolean' | 'limit'

export const FEATURES = {
  basic_analytics: { kind: 'boolean', label: 'Sales overview' },
  advanced_analytics: { kind: 'boolean', label: 'Longer sales history' },
  advanced_storefront: { kind: 'boolean', label: 'Advanced storefront' },
  custom_domain: { kind: 'boolean', label: 'Your own .co.za web address' },
  loyalty: { kind: 'boolean', label: 'Loyalty programme' },
  advanced_staff: { kind: 'boolean', label: 'Advanced team tools' },
  ai_business_buddy: { kind: 'boolean', label: 'Ask Skhokho (AI assistant)' },
  advanced_ai: { kind: 'boolean', label: 'Advanced AI' },
  multi_location: { kind: 'boolean', label: 'Multiple locations' },
  // Content & Marketing (additive paid capability — the storefront, orders
  // and payments never depend on any of these).
  content_studio: { kind: 'boolean', label: 'Content & Marketing studio' },
  content_generation: { kind: 'boolean', label: 'AI content writing' },
  content_campaigns: { kind: 'boolean', label: 'Marketing campaigns' },
  content_calendar: { kind: 'boolean', label: 'Content calendar' },
  advanced_business_insights: { kind: 'boolean', label: 'Business insights for content' },
  max_staff: { kind: 'limit', label: 'Team members' },
  max_products: { kind: 'limit', label: 'Products' },
  max_services: { kind: 'limit', label: 'Services' },
  /** External AI calls a business may make per calendar month (each metered call = 1). */
  ai_generations_monthly: { kind: 'limit', label: 'AI generations per month' },
  /** Optional cap on input+output tokens per month; null = no cap. */
  ai_token_budget_monthly: { kind: 'limit', label: 'AI token budget per month' },
  content_campaigns_monthly: { kind: 'limit', label: 'Campaigns per month' },
} as const satisfies Record<string, { kind: FeatureKind; label: string }>

export type FeatureKey = keyof typeof FEATURES
export type BooleanFeature = { [K in FeatureKey]: (typeof FEATURES)[K]['kind'] extends 'boolean' ? K : never }[FeatureKey]
export type LimitFeature = { [K in FeatureKey]: (typeof FEATURES)[K]['kind'] extends 'limit' ? K : never }[FeatureKey]

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[]

export function isFeatureKey(key: string): key is FeatureKey {
  return Object.prototype.hasOwnProperty.call(FEATURES, key)
}

export function featureLabel(key: FeatureKey): string {
  return FEATURES[key].label
}
