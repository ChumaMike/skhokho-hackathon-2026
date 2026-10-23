# Pilot success metrics

A short list, each with where the number comes from today and the
threshold that says "this is working". The objective is evidence for the
weekly stage decision, not optimisation. Nothing new is instrumented;
where a number needs the pilot log, it says so.

| Metric | Source | Healthy for the pilot | Watch |
|---|---|---|---|
| Merchant onboarding completion time | pilot log: register date → Readiness READY TO TRADE date | ≤ 2 days with support on the phone; ≤ 1 week unassisted | > 1 week → which readiness line stalled |
| Orders placed | Overview › Orders today; business page › Orders (30d) | growing week on week; at least one real customer order per trading day by week 2 | zero days in a row |
| Checkout completion rate | storefront insights (checkout started vs orders placed, needs 20+ visits); hosting logs for 5xx on checkout | ≥ 50 % of started checkouts become orders | < 30 % → acceptance-test the checkout again on a phone |
| Payment success rate (stage D) | Overview › Payment success (24h); Payments › status | ≥ 90 % of finished attempts succeed | < 70 % → R3 |
| Merchant response time to new orders | Orders › needs attention (paid-unconfirmed, new-unactioned counts); pilot log "oldest PENDING age" | every order confirmed within 10 minutes | any order > 15 min, twice in a week |
| Preparation time | order `updatedAt` deltas CONFIRMED → READY on the order page (manual sample of 5 per day in the log) | ≤ 30 minutes for a takeaway | stuck-in-preparation count > 0 |
| Delivery assignment time (stage E) | Overview › Median to assign (24h); Health › median to first offer | median ≤ 10 minutes | `dispatch_latency` alert |
| Delivery completion rate | Deliveries › delivered vs failed / cancelled / disputed (7d); business page incidents | ≥ 95 % delivered | any dispute; two failures in a week |
| Failed / cancelled order rate | Overview › Cancelled today; analytics › cancelled per week | ≤ 5 % of orders | a pattern from one cause |
| Support incidents | support log: cases per week by category | falling after week 2 | three of one kind in a week → P1 |
| Notification failures | Health › email / notification failures (24h) | 0 | `email_failures` alert |
| Merchant feedback | one sentence per day in the pilot log; a 10-minute call each Friday | "it works, I'd pay for it" by week 4 | "I keep having to phone you" |

Decision rule for the weekly review: move to the next stage only when every
metric for the current stage has been healthy for five consecutive trading
days and no CRITICAL alert fired in that time.
