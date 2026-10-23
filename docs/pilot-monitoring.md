# Pilot monitoring checklist

What platform admins watch during a controlled merchant pilot, using the
signals that already exist (Admin › Overview, Admin › System health, the
Security and Audit logs, structured JSON logs). Thresholds are the ones in
`src/modules/platform-admin/alerts.ts`; escalation is in `docs/alerts.md`.
Nothing here is new instrumentation.

Cadence for the pilot: a named admin checks **Overview** at open, midday
and close on every trading day; **System health** once a day; the
**Security log** once a day.

| Watch | Where | Signal | Healthy | Act when |
|---|---|---|---|---|
| New / stuck orders | Admin › Overview "Needing attention"; Admin › Orders › needs attention (per business via the business page) | counts per situation | all 0 | paid-unconfirmed or new-unactioned > 0 → call the shop; ready-no-driver → shop assigns or requests Skhokholetha |
| Checkout failures | hosting logs: 5xx on `/api/store/checkout` and `/api/store/checkout/quote` (`[api] unhandled error` lines); rate-limit trips on `checkoutIp` | errors per hour | 0 | any 5xx; repeated `rate_limit_triggered` on checkout from one IP |
| Unsupported delivery area attempts | logs: quote results `OUTSIDE_SERVICE_AREA` / `DELIVERY_AREA_REQUIRED` on `/api/store/checkout/quote` | count per day | occasional | many from one shop → their areas are too narrow or the suburb list is missing names; tell the merchant |
| Payment failures | Admin › Payments; alerts `payment_failure_spike`, `payments_broken`, `payment_processing_errors` | failed / total attempts (24 h); processing failures | < 30 % failed; 0 processing failures | spike → the merchant's PayFast account and `payment_webhook_rejected` events; processing failures → `docs/runbooks.md` R3 |
| Webhook rejections | Security log `payment_webhook_rejected` | count (24 h) | 0–2 | ≥ 10 → `docs/alerts.md` HIGH |
| Delivery assignment time | Admin › Overview "dispatch latency" (median to first offer / to assignment); alert `dispatch_latency` | median | < 10 min | > 10 min → not enough online drivers near the shop |
| Failed dispatch | Admin › Deliveries, filter SEARCHING older than 15 min; alerts `dispatch_down`, `dispatch_errors` | searching deliveries, online drivers, tick failures | none older than 15 min; 0 tick failures | `dispatch_down` → call drivers, tell the shop, consider `DELIVERY_REQUESTS_ENABLED=false`; `dispatch_errors` → engineering |
| Delivery completion | Admin › Deliveries, DELIVERED vs open; alert `late_deliveries` (> 90 min) | open deliveries by age | none > 90 min | late → contact driver and shop |
| Cancellations | Admin › Orders (CANCELLED), Admin › Deliveries (CANCELLED / DISPUTED), audit `delivery_cancelled` | per day | rare | a pattern from one shop or driver → review |
| Customer notification failures | SYSTEM events `email_failed`, `email_unconfigured`, `notification_failed`; alert `email_failures`, `notification_failures` | count (24 h) | 0 | ≥ 5 → Resend status / API key / sending domain |
| API / server errors | hosting logs, level=error; `x-request-id` on every response | errors per hour | none sustained | any repeated error from one route |
| DB health | `/api/health/ready`; alerts `db_down`, `db_slow` | up; round trip < 1.5 s | up | 503 → `docs/alerts.md` CRITICAL |
| Cron health | Admin › System health → job runs; alerts `cron_stale`, `job_failures` | last daily run < 26 h ago, every task ok | ok | stale or failed → Vercel cron + `CRON_SECRET` |
| Suspicious auth / access | Security log: `admin_login_failed`, `admin_mfa_failed`, `staff_permission_denied`, `session_type_mismatch`, `rate_limit_triggered` on login rules; alert `admin_auth_attack` | counts (24 h) | low single digits | spikes → `docs/alerts.md` CRITICAL / MEDIUM rows |
| Proof-of-delivery code locks | Security log `delivery_code_locked`; alert `otp_failures` | locked codes (24 h) | 0 | ≥ 3 → look for one driver or shop behind them |
| Rate-limit pressure | alert `rate_limits` | trips (24 h) | < 50 | ≥ 50 → which rule; HIGH if admin/login |

## Daily pilot log (keep in the ops channel)

Date · orders (collection / own delivery / Skhokholetha) · cancellations ·
payment failures · oldest PENDING age seen · dispatch median · any
SECURITY events · any SYSTEM events · merchant feedback in one line.

## Pause levers (no deploy needed)

| Problem | Lever |
|---|---|
| Skhokholetha misbehaving | `DELIVERY_REQUESTS_ENABLED=false` (in-progress deliveries finish; shops fall back to own drivers) |
| Driver sign-ups to stop | `DRIVER_SIGNUP_ENABLED=false` |
| Whole network | `SKHOKHOLETHA_ENABLED=false` |
| Card payments | `PAYMENTS_ALLOW_LIVE_VERIFICATION` off stops new verifications; a merchant can switch "pay online" off in Settings › Payments |
| One shop | Admin › Businesses → Suspend (reason required, audited) |
| One driver | Admin › Drivers → Suspend (reason required, audited) |
