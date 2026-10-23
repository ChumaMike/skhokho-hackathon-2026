# Runbooks

Short, do-this-now procedures for the alert matrix (`docs/alerts.md`).
Everything an admin does in the Control Centre is a command with a reason
and an audit row; nothing here edits a database row by hand.

## R1 — Database unavailable (`db_down`, `/api/health/ready` 503)

1. Neon console: is the project compute running? Suspended / scaling event? Connection count at the limit?
2. Vercel: did a deploy just change `POSTGRES_PRISMA_URL` / `POSTGRES_URL_NON_POOLING`? Roll the env back.
3. If Neon is degraded: nothing to do in the app; PayFast retries notifications for hours, customers see a plain error. Post a status line to merchants after 30 min.
4. Recovery: `/api/health/ready` 200, Overview loads, then look at Payments › pending and System health › recent failures for anything that happened during the outage.

## R2 — Application unavailable (external probe red, 5xx everywhere)

1. Vercel › Deployments: if the current build errors, **instant rollback** to the previous build (safe: migrations are additive; only a REFUND_DUE row can't be read by builds older than 2026-10-04).
2. If the build is fine: check env vars on the production project — a missing startup variable makes the instance refuse to start (`[config] FATAL` in logs).
3. Recovery: probe green, a storefront loads, a R0 collection test order places and shows in the Control Centre.

## R3 — Payment processing broken / processing failures

1. Control Centre › Payments: filter SUBMITTED. Open an attempt: the "Provider notifications" table shows every PayFast call for it and why it was rejected or retried.
2. Security log › `payment_webhook_rejected`: "merchant mismatch" or "bad signature" from one merchant means their PayFast credentials changed — ask them to re-save in Settings › Payments (old attempts stay verifiable against the superseded connection).
3. "PayFast validate unavailable" → PayFast's own status; nothing to change.
4. `payment_notification_processing_failed` → a DB error during settlement; check R1. PayFast retries; when the retry lands the attempt settles once (idempotent).
5. Never edit amounts, provider ids or settlement state. If a customer was charged twice the attempt shows REFUND_DUE and the merchant refunds in their own PayFast account.

## R4 — Email provider failure

1. Resend dashboard: API key valid, sending domain verified, quota.
2. `EMAIL_FROM` must be on a verified domain.
3. Nothing is queued: an email that failed is gone. For a merchant waiting on a staff invite, re-send it from Dashboard › Staff; for a driver, ask them to request the verification email again.

## R5 — Cron stale or job failing

1. System health › Background jobs: which task, what error.
2. Vercel › Cron: did the 03:00 UTC run fire? Is `CRON_SECRET` set on production (a 503 from `/api/cron/daily` means it isn't)?
3. Run the one task by hand with the secret: `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/payments` (also `/domains`, `/storefront-learning`). Manual runs are recorded as `manual.*` job runs.
4. Dispatch and earnings have no manual route: they also advance on every driver/shop poll, so a stale cron only delays the backstop.

## R6 — Dispatch down or tick errors

1. Overview › Skhokholetha: online drivers, searching deliveries, median to assign.
2. No drivers online → phone the on-call drivers; tell the shops to use their own driver (Fulfilment setting BOTH falls back automatically).
3. `dispatch_tick_failed` events → System health › recent failures shows the error class; usually R1.
4. Persisting → `DELIVERY_REQUESTS_ENABLED=false` (in-progress deliveries finish; no new requests).

## R7 — Admin authentication attack

1. Security log: which subject hashes, how many, from which IP hashes.
2. Phone each admin. Anyone unsure → Settings › Admin team › Reset MFA (super admin, reason required); they re-enrol on next sign-in.
3. Suspected stolen session → rotate `JWT_SECRET` on Vercel (every session on the platform ends) and redeploy.
4. Keep the Security log export for the record.

## R8 — Tenant isolation report

1. Capture: who reported, what they saw, the `x-request-id` from the response headers if they have it, time.
2. Contain: Businesses › Suspend the affected business (reason: "isolation investigation"), or set the relevant switch off.
3. Engineering reproduces against the test database and adds the case to `src/lib/testing/tenant-isolation.test.ts` before the fix ships.
4. Information Officer decides on POPIA s22 notification with counsel.

## R9 — Driver verification abuse

1. Drivers › pending: reject the applications with a reason (the driver sees it); documents stay for the audit record until the retention decision is made.
2. Security log › `rate_limit_triggered` on `driverSignup`, `driverVerifyEmail`, `documentUploadDriver`: one IP hash hammering → it is already throttled; if it continues, `DRIVER_SIGNUP_ENABLED=false` until the pilot drivers are in.
3. Identity fraud suspected → FOUNDER; do not approve; keep the documents (they are evidence) and record the decision in the rejection reason.

## R10 — Orders needing attention

Control Centre › Orders › "needs attention" groups the stuck situations
(paid but unconfirmed, new and unactioned, ready with no driver, ready not
collected, stuck in preparation, unpaid online, very old). None of them is
changed by the platform — phone the shop. The thresholds are in
`src/modules/platform-admin/order-attention.ts`.

## R11 — Payout anomaly

1. Do not mark anything paid. Payouts › the payout in question: driver, amount, bank last-4, who created it (audit).
2. Compare the driver's ledger (Drivers › driver › Earnings) with the bank statement.
3. A correction is a new ledger adjustment with a reason and reference (capped at R5 000, idempotent), never an edit.
