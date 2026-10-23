/**
 * Who may see what of the cash-flow forecast — one decision, in one place,
 * used by all three pages and testable without a database or a session.
 *
 * It is a policy, not a gate: the pages still call `requireStaffPermission`
 * themselves, the services still scope every read to one business, and
 * hiding a link here has never been what keeps anyone out. What this removes
 * is the risk of three pages each deciding the same question slightly
 * differently as the feature grows.
 *
 * Two separate questions, kept separate on purpose:
 *   - the PERSON's permissions: may they see analytics at all, may they see
 *     customer details, may they see a customer's contact number;
 *   - the BUSINESS's plan: `basic_analytics` for the forecast and its
 *     summary, `advanced_analytics` for the full report.
 *
 * Both keys already exist and already mean exactly this elsewhere in the app
 * (`basic_analytics` = the recent picture, `advanced_analytics` = more than
 * the recent picture). Nothing here adds a feature key, changes a plan or
 * moves anything between plans.
 */

import type { StaffPermissions } from '@/types'
import { hasFeature } from '@/modules/billing/entitlements'
import type { Entitlements } from '@/modules/billing/entitlements'

export interface ForecastAccess {
  /** The forecast page: four weeks, the chart, the day-by-day table. */
  forecast: boolean
  /** The funding-readiness one-pager and the win-back list. */
  fullReport: boolean
  /** The win-back list also needs permission to see customers at all. */
  winBack: boolean
  /** A customer's contact number, and therefore a WhatsApp link. */
  contactNumbers: boolean
  /**
   * Why the forecast itself is withheld, for the page's one-line
   * explanation. 'ok' when it is not.
   */
  forecastBlockedBy: 'ok' | 'permission' | 'plan'
  /** Why the full report is withheld. */
  reportBlockedBy: 'ok' | 'permission' | 'plan'
  /** Why the win-back list is withheld. */
  winBackBlockedBy: 'ok' | 'permission' | 'plan' | 'customer-permission'
}

export function forecastAccess(input: { permissions: StaffPermissions; entitlements: Entitlements }): ForecastAccess {
  const { permissions, entitlements } = input

  const mayViewAnalytics = permissions.canViewAnalytics === true
  const mayViewCustomers = permissions.canManageCustomers === true || permissions.canIssueLoyalty === true
  // The same pair the Orders page requires before it shows a customer's
  // number: that number was left for a delivery, not for marketing.
  const mayViewNumbers = permissions.canManageOrders === true || permissions.canManageDeliveries === true

  const inBasic = hasFeature(entitlements, 'basic_analytics')
  const inAdvanced = hasFeature(entitlements, 'advanced_analytics')

  const forecast = mayViewAnalytics && inBasic
  const fullReport = mayViewAnalytics && inAdvanced
  const winBack = fullReport && mayViewCustomers

  return {
    forecast,
    fullReport,
    winBack,
    contactNumbers: winBack && mayViewNumbers,
    forecastBlockedBy: forecast ? 'ok' : !mayViewAnalytics ? 'permission' : 'plan',
    reportBlockedBy: fullReport ? 'ok' : !mayViewAnalytics ? 'permission' : 'plan',
    winBackBlockedBy: winBack
      ? 'ok'
      : !mayViewAnalytics
        ? 'permission'
        : !inAdvanced
          ? 'plan'
          : 'customer-permission',
  }
}

/**
 * What a business on the smaller plan is missing, named honestly. Shown on
 * the forecast page, which they DO have: the forecast and its summary are
 * theirs, and this says what the longer history adds without pretending the
 * page they are looking at is broken.
 */
export const FULL_REPORT_CONTENTS = [
  'A printable funding-readiness one-pager for a lender, a supplier or a landlord',
  'Who to win back, with a message ready to send',
  'About six months of sales history instead of six weeks',
] as const
