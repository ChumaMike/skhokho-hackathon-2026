# Alert matrix

The same rules are evaluated live on **Control Centre › Overview** and
**Control Centre › System health** (`src/modules/platform-admin/alerts.ts` —
thresholds live there). For paging, point the hosting log drain at the
structured log events named below (every log line is JSON with `ts`, `env`,
`level`, `event`, and where the caller has it `requestId` / `businessId`).
Every response carries `x-request-id`; ask the reporter for it.

Responders (small team, see `docs/pilot-operations-model.md`): **ENG** =
on-call engineer · **OPS** = operations lead · **FIN** = finance ·
**FOUNDER**. Escalation ladder: ENG → engineering lead → FOUNDER.
"Pause" levers: the env switches in `docs/skhokholetha.md` (Production
switches), `PAYMENTS_ALLOW_LIVE_VERIFICATION`, and Suspend on a business or
driver. Runbooks: `docs/runbooks.md`.

## CRITICAL — act now, page on-call

| Condition | Signal | Why it matters | Responds | First action | Escalate | Recovery check |
|---|---|---|---|---|---|---|
| Database unavailable | `/api/health/ready` 503; `db_down`; Prisma errors in logs | Nothing works; payments can't be recorded (PayFast retries for a while) | ENG | Neon status, compute state, connection limits; check the last deploy | Lead after 15 min; merchants told after 30 min | `/api/health/ready` 200 for 10 min; Overview loads; `payment_notification_processing_failed` stops |
| Application unavailable | `/api/health` not 200 from an external probe; Vercel deployment errors; 5xx rate in Vercel logs | Storefronts, checkout and the console are all down | ENG | Vercel deployment status → instant rollback to the previous build; check env vars on the failing build | Lead after 10 min | External probe green 10 min; a test storefront loads; a R0 collection test order places |
| Payment processing broken | `payments_broken`: ≥10 attempts in 24h, none succeeded; `payment_processing_errors` repeating | Merchants are losing sales; customers may have paid without an order being marked | ENG, FIN informed | PayFast status; `/api/payments/payfast/notify` logs for the reference; `payment_webhook_rejected` reasons | Lead immediately; tell merchants to take cash | A new sandbox or LIVE_VERIFICATION attempt settles; Payments › pending drains |
| Tenant isolation issue | Any report or test showing one business's data in another's console or storefront; `staff_permission_denied` spikes across tenants | Data breach (POPIA s22 notification may apply) | ENG + FOUNDER + Information Officer | Take the surface offline (suspend the business / disable the feature); preserve logs and request ids | Immediate | Root cause fixed with a regression test in the tenant-isolation suite; affected parties notified per counsel |
| Admin security compromise | `admin_auth_attack`: ≥10 failed admin logins or ≥5 failed MFA (24h); unexpected `admin_role_changed`, `admin_mfa_reset`, `admin_bootstrap_*` | Platform-wide takeover risk | FOUNDER (super admin) | Security log; confirm with each admin by phone; reset MFA for any suspect admin; rotate `JWT_SECRET` if a session may be stolen (logs everyone out) | Immediate | No further failures for 24h; every admin re-enrolled; audit log reviewed |
| Delivery dispatch completely down | `dispatch_down`: deliveries searching >15 min and no driver online (network on) | Paid orders not delivered | OPS | Call on-call drivers; tell the shops; `DELIVERY_REQUESTS_ENABLED=false` if it persists | Lead after 15 min | Searching queue empty; median-to-assign back under 10 min |

## HIGH — same working day

| Condition | Signal | Why it matters | Responds | First action | Escalate | Recovery check |
|---|---|---|---|---|---|---|
| Payment failure spike | `payment_failure_spike`: ≥30% of ≥10 attempts failed (24h) | One merchant misconfigured, or provider trouble | FIN | Group failures by business on Payments | ENG if platform-wide | Failure share under 30% next 24h |
| Payment notification could not be processed | `payment_processing_errors` (SYSTEM `payment_notification_processing_failed`); log `payfast.notify.processing_failed` | PayFast will retry, but money may sit unsettled | ENG | Find the attempt by reference on Payments; check DB errors at that time | FIN if an order stays unpaid after retries | The attempt reaches COMPLETE or EXPIRED; no new events |
| Cron / background job failures | `cron_stale` (no daily run for 26h); `job_failures`; log `job.failed` | Reconciliation, domain checks, retention, dispatch backstop and earnings release stop | ENG | System health → job runs; Vercel cron + `CRON_SECRET` | Lead if two days in a row | Next daily run every task ok |
| Dispatch tick errors | `dispatch_errors` (SYSTEM `dispatch_tick_failed`); log `dispatch.tick_failed` | Offers stop going out even though drivers are online | ENG | System health → recent failures; DB errors around the tick | OPS if deliveries are waiting | No new events for 1h; offers flowing |
| Email provider failure | `email_unconfigured`; `email_failures` ≥5 (24h); log `email.failed` | No password reset, invites, driver verification, order emails | ENG | Resend status, API key, sending domain | Lead if >2h | Test email sends; failures stop |
| Paid orders not confirmed | `orders_paid_unconfirmed` (Orders → needs attention) | A customer paid and the shop hasn't seen it | OPS | Phone the shop | ENG if the shop says the queue didn't update | Count back to 0 |
| Payout anomaly | Unexpected `ledger_adjustment_added` / `payout_marked_paid`; balance not matching bank | Money leaving incorrectly | FIN + FOUNDER | Freeze payouts (don't mark paid); reconcile ledger vs bank | Immediate | Ledger and bank agree |
| Extreme dispatch latency | `dispatch_latency`: median time to assign >10 min (24h) | Poor service, cold food | OPS | Online driver supply near the waiting shops | — | Median under 10 min |
| Webhook rejections | `webhook_rejections` ≥10 (24h) | Forged notifications or a broken merchant setup | ENG | Security log → `payment_webhook_rejected` reasons | Lead if "bad signature" from many sources | Rejections stop |
| Driver verification abuse | Many `rate_limit_triggered` on `driverSignup*` / `documentUploadDriver` from one source; a burst of applications with rejected documents | Fraudulent drivers, document spam | OPS | Drivers → pending: reject with reason; `DRIVER_SIGNUP_ENABLED=false` if it continues | FOUNDER if identity fraud is suspected | Sign-ups back to normal; no further rate-limit trips |

## MEDIUM — within a few days

| Condition | Signal | Why it matters | Responds | First action | Escalate | Recovery check |
|---|---|---|---|---|---|---|
| Increased latency | `db_slow` (DB round trip >1.5s) | Neon cold starts / undersized compute | ENG | Neon metrics | HIGH if sustained | Round trip under 1.5s |
| Elevated OTP failures | `otp_failures`: ≥3 delivery codes locked (24h) | Guessing, or a shop+driver skipping the customer | OPS | One driver/shop behind several locks? suspend if it repeats | — | No locks next 24h |
| Late deliveries | `late_deliveries`: open >90 min | Customer experience | OPS | Contact driver and shop | — | Delivery ends |
| Ready orders with no driver | `orders_ready_no_driver` | Food waiting, nobody assigned | OPS | Ask the shop to assign or request Skhokholetha | — | Count to 0 |
| Very old active orders | `orders_old_active` (>24h) | Abandoned orders skew the shop's queue and stats | OPS | Ask the shop to complete or cancel | — | Count to 0 |
| Notification degradation | `notification_failures` ≥5 (24h) | Shops miss delivery updates | ENG | DB errors in logs | — | Failures stop |
| Rate-limit pressure | `rate_limits` ≥50 trips (24h) | Brute force or a broken client | ENG | Security log → which rule | HIGH if on admin/login rules | Trips under 50 |
