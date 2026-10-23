# Daily pilot operator checklist

One person (the platform-watch hat, see `docs/pilot-operations-model.md`)
runs this on every trading day. Each block takes under ten minutes. Tick
in the ops channel; the end-of-day line is the pilot log entry.

## Open of day (before the merchant's first hour)

- [ ] **Overview** loads; Alerts section empty or every row understood and owned. Click "Open →" on anything new.
- [ ] **System health**: Database up and under 1.5 s; Active alerts 0; job failures 0; email / notification / dispatch / payment-processing failures 0.
- [ ] **Jobs / cron**: Background jobs table shows every `daily.*` task ok with a start time inside the last 26 h.
- [ ] **Security**: failed admin logins, failed MFA, authorization denials, rate-limit trips all low single digits; no privileged admin action you don't recognise.
- [ ] **Payment provider**: Payments › 24 h stats — pending not growing; refund due 0; (stage D) PayFast status page green.
- [ ] **Email provider**: Email failures (24h) 0; Resend dashboard shows no bounces on the sending domain.
- [ ] **Drivers** (only if Skhokholetha is on): Drivers › pending cleared or scheduled; at least the agreed number online near the shop before its first delivery hour; "Can work right now" yes for each.
- [ ] **Merchant readiness**: Businesses › each pilot merchant shows READY TO TRADE and Trading now OPEN / CLOSED as expected for the hour.

## Midday

- [ ] **Orders needing attention**: Orders › needs attention — every row phoned through or explained; "paid, not confirmed" must be 0 within 10 minutes.
- [ ] **Payment failures**: Payments › failed in the last 24 h — group by business; one merchant dominating → MERCHANT SUPPORT calls them.
- [ ] **Active deliveries**: Deliveries › active — nothing unexpected; own-driver deliveries moving (order page timestamps).
- [ ] **Stuck deliveries**: Deliveries › searching older than 15 min, late (> 90 min) — DRIVER OPERATIONS on each.
- [ ] **Merchant support issues**: the support log (`docs/support-process.md`) has an owner and a next step for every open case.

## End of day (after the merchant's last hour)

- [ ] **Unresolved orders**: Orders › needs attention empty, or each remaining order has a reason in the log (merchant will complete tomorrow, cancelled by customer, …).
- [ ] **Failed payments**: each FAILED / EXPIRED / REFUND_DUE attempt of the day has an owner; refund-due cases are on FINANCE's list for the merchant to refund.
- [ ] **Delivery incidents**: Deliveries › failed / disputed / cancelled today — each has a note; disputes have a decision date.
- [ ] **Payout / earnings review** (Skhokholetha on): Payouts › available balances; create payouts over the agreed minimum; FINANCE pays and records the bank reference.
- [ ] **Critical alerts**: any CRITICAL or HIGH alert that fired today is in the log with what was done and the recovery check from `docs/alerts.md`.
- [ ] **Pilot log entry** (one line): date · orders (collection / own delivery / Skhokholetha) · cancellations · payment failures · oldest PENDING age seen · dispatch median · SECURITY events · SYSTEM events · support cases opened/closed · merchant feedback in one sentence.

## Weekly (PLATFORM OWNER, 20 minutes)

- [ ] Read the seven pilot-log lines; compare with `docs/pilot-metrics.md` thresholds.
- [ ] Decide: stay on the current stage, move to the next, or pause. Write the decision in the log.
- [ ] Review the P1 list for anything the week's evidence promoted.
