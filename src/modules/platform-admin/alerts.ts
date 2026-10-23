/**
 * Live evaluation of the alert matrix (docs/alerts.md) from data the app
 * already has. The same rules a log-based alerting tool should implement;
 * shown on the admin overview and health page so the first person to look
 * sees what's wrong. Thresholds live here, next to their docs counterpart.
 */

import type { configStatus, commerceMetrics, deliveryMetrics, securityMetrics, systemMetrics } from './metrics'

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM'

export interface Alert {
  key: string
  severity: Severity
  message: string
  firstAction: string
  /** Where in the Control Centre the operator sees the detail behind this alert. */
  href: string
}

/** One drill-down per alert key, so a warning is never a dead end. */
export const ALERT_LINKS: Record<string, string> = {
  db_down: '/platform-admin/health',
  db_slow: '/platform-admin/health',
  payments_broken: '/platform-admin/payments?status=FAILED',
  payment_failure_spike: '/platform-admin/payments?status=FAILED',
  payment_processing_errors: '/platform-admin/payments?status=SUBMITTED',
  webhook_rejections: '/platform-admin/security',
  dispatch_down: '/platform-admin/deliveries?view=searching',
  dispatch_errors: '/platform-admin/health',
  dispatch_latency: '/platform-admin/deliveries?view=searching',
  late_deliveries: '/platform-admin/deliveries?view=late',
  otp_failures: '/platform-admin/security',
  admin_auth_attack: '/platform-admin/security',
  rate_limits: '/platform-admin/security',
  cron_stale: '/platform-admin/health',
  job_failures: '/platform-admin/health',
  email_unconfigured: '/platform-admin/settings',
  email_failures: '/platform-admin/health',
  notification_failures: '/platform-admin/health',
  orders_paid_unconfirmed: '/platform-admin/orders?view=paid_unconfirmed',
  orders_ready_no_driver: '/platform-admin/orders?view=ready_no_delivery',
  orders_old_active: '/platform-admin/orders?view=old_active',
}

export const THRESHOLDS = {
  cronStaleHours: 26,
  paymentFailureRate: 0.3, // with at least MIN_PAYMENT_SAMPLE attempts
  minPaymentSample: 10,
  emailFailures24h: 5,
  jobFailures24h: 1,
  dispatchFailures24h: 1,
  paymentProcessingFailures24h: 1,
  webhookRejections24h: 10,
  adminLoginFailures24h: 10,
  adminMfaFailures24h: 5,
  codeLocks24h: 3,
  assignmentSecondsHigh: 600,
  notificationFailures24h: 5,
  rateLimitTrips24h: 50,
} as const

export function evaluateAlerts(input: {
  db: { up: boolean; ms: number | null }
  lastDailyRun: Date | null
  config: ReturnType<typeof configStatus>
  commerce: Awaited<ReturnType<typeof commerceMetrics>>
  delivery: Awaited<ReturnType<typeof deliveryMetrics>>
  security: Awaited<ReturnType<typeof securityMetrics>>
  system: Awaited<ReturnType<typeof systemMetrics>>
  /** Stuck-order counts (order-attention.ts); optional so callers that don't load them still get every other rule. */
  orders?: { paid_unconfirmed: number; ready_no_delivery: number; old_active: number }
  now?: Date
}): Alert[] {
  const now = input.now ?? new Date()
  const a: Omit<Alert, 'href'>[] = []
  const s = input.security.last24h
  if (!input.db.up) a.push({ key: 'db_down', severity: 'CRITICAL', message: 'Database unreachable.', firstAction: 'Check Neon status and connection limits; see docs/alerts.md.' })
  const p = input.commerce.paymentsLast24h
  const attempts = p.succeeded + p.failed
  if (attempts >= THRESHOLDS.minPaymentSample && p.succeeded === 0) {
    a.push({ key: 'payments_broken', severity: 'CRITICAL', message: `No successful payment in ${attempts} attempts (24h).`, firstAction: 'Check PayFast status and the notify endpoint logs.' })
  } else if (attempts >= THRESHOLDS.minPaymentSample && p.failed / attempts >= THRESHOLDS.paymentFailureRate) {
    a.push({ key: 'payment_failure_spike', severity: 'HIGH', message: `${Math.round((p.failed / attempts) * 100)}% of payments failed (24h).`, firstAction: 'Look for one merchant/connection dominating the failures.' })
  }
  if (input.config.skhokholetha.network && input.delivery.deliveries.searchingTooLong > 0 && input.delivery.drivers.online === 0) {
    a.push({ key: 'dispatch_down', severity: 'CRITICAL', message: 'Deliveries are waiting and no driver is online.', firstAction: 'Contact on-call drivers or pause delivery requests.' })
  }
  if ((s.admin_login_failed ?? 0) >= THRESHOLDS.adminLoginFailures24h || (s.admin_mfa_failed ?? 0) >= THRESHOLDS.adminMfaFailures24h) {
    a.push({ key: 'admin_auth_attack', severity: 'CRITICAL', message: `Admin sign-in failures: ${s.admin_login_failed ?? 0} password, ${s.admin_mfa_failed ?? 0} MFA (24h).`, firstAction: 'Review the security log; confirm with admins; reset MFA if a factor is suspect.' })
  }
  if (!input.lastDailyRun || now.getTime() - input.lastDailyRun.getTime() > THRESHOLDS.cronStaleHours * 3600_000) {
    a.push({ key: 'cron_stale', severity: 'HIGH', message: 'The daily job has not run in over a day.', firstAction: 'Check the Vercel cron and CRON_SECRET.' })
  }
  if (input.system.jobFailures >= THRESHOLDS.jobFailures24h) a.push({ key: 'job_failures', severity: 'HIGH', message: `${input.system.jobFailures} background job failure(s) in 24h.`, firstAction: 'Open System health → job runs for the failing task.' })
  if ((input.system.dispatchFailures ?? 0) >= THRESHOLDS.dispatchFailures24h) a.push({ key: 'dispatch_errors', severity: 'HIGH', message: `${input.system.dispatchFailures} dispatch tick failure(s) in 24h — offers may not be going out.`, firstAction: 'Open System health → recent system failures; check database errors around the failing ticks.' })
  if ((input.system.paymentProcessingFailures ?? 0) >= THRESHOLDS.paymentProcessingFailures24h) a.push({ key: 'payment_processing_errors', severity: 'HIGH', message: `${input.system.paymentProcessingFailures} payment notification(s) could not be processed (24h) — PayFast will retry; money may be unsettled.`, firstAction: 'Open Payments → pending/submitted; check the notify endpoint logs for the attempt reference.' })
  if (input.orders) {
    if (input.orders.paid_unconfirmed > 0) a.push({ key: 'orders_paid_unconfirmed', severity: 'HIGH', message: `${input.orders.paid_unconfirmed} paid order(s) the merchant has not confirmed.`, firstAction: 'Open Orders → needs attention; phone the shop.' })
    if (input.orders.ready_no_delivery > 0) a.push({ key: 'orders_ready_no_driver', severity: 'MEDIUM', message: `${input.orders.ready_no_delivery} ready delivery order(s) with no driver assigned.`, firstAction: 'Open Orders → needs attention; ask the shop to assign a driver or request Skhokholetha.' })
    if (input.orders.old_active > 0) a.push({ key: 'orders_old_active', severity: 'MEDIUM', message: `${input.orders.old_active} active order(s) older than a day.`, firstAction: 'Open Orders → needs attention; the shop should complete or cancel them.' })
  }
  if (!input.config.email) a.push({ key: 'email_unconfigured', severity: 'HIGH', message: 'Email is not configured — no verification, reset or delivery-link emails.', firstAction: 'Set RESEND_API_KEY and EMAIL_FROM.' })
  else if (input.system.emailFailures >= THRESHOLDS.emailFailures24h) a.push({ key: 'email_failures', severity: 'HIGH', message: `${input.system.emailFailures} email failures (24h).`, firstAction: 'Check Resend status and the sending domain.' })
  if (input.system.webhookRejections >= THRESHOLDS.webhookRejections24h) a.push({ key: 'webhook_rejections', severity: 'HIGH', message: `${input.system.webhookRejections} rejected payment notifications (24h).`, firstAction: 'Check for a misconfigured merchant or forged notifications.' })
  const assign = input.delivery.latency.medianSecondsToAssignment
  if (assign !== null && assign > THRESHOLDS.assignmentSecondsHigh) a.push({ key: 'dispatch_latency', severity: 'HIGH', message: `Median time to assign a driver: ${Math.round(assign / 60)} min.`, firstAction: 'Check online driver supply near the shops waiting.' })
  if (input.delivery.deliveries.late > 0) a.push({ key: 'late_deliveries', severity: 'MEDIUM', message: `${input.delivery.deliveries.late} delivery(ies) open for over 90 minutes.`, firstAction: 'Open Deliveries → late and contact the driver/shop.' })
  if ((s.delivery_code_locked ?? 0) >= THRESHOLDS.codeLocks24h) a.push({ key: 'otp_failures', severity: 'MEDIUM', message: `${s.delivery_code_locked} delivery codes locked after wrong tries (24h).`, firstAction: 'Look for one driver or shop behind several locks.' })
  if (input.system.notificationFailures >= THRESHOLDS.notificationFailures24h) a.push({ key: 'notification_failures', severity: 'MEDIUM', message: `${input.system.notificationFailures} notification failures (24h).`, firstAction: 'Check database errors in the logs.' })
  if ((s.rate_limit_triggered ?? 0) >= THRESHOLDS.rateLimitTrips24h) a.push({ key: 'rate_limits', severity: 'MEDIUM', message: `${s.rate_limit_triggered} rate-limit trips (24h).`, firstAction: 'Check the security log for one source hammering an endpoint.' })
  if (input.db.up && (input.db.ms ?? 0) > 1500) a.push({ key: 'db_slow', severity: 'MEDIUM', message: `Database round trip ${input.db.ms} ms.`, firstAction: 'Check Neon compute size / cold start.' })
  const order: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 }
  return a.map((x) => ({ ...x, href: ALERT_LINKS[x.key] ?? '/platform-admin/health' })).sort((x, y) => order[x.severity] - order[y.severity])
}
