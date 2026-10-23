# Pilot staging: feature flags, payments and Skhokholetha

Stages are from `docs/pilot-readiness.md`. Nothing here is enabled by this
repository; each switch is a decision by the slot owner in
`docs/pilot-operations-model.md`, executed by TECHNICAL INCIDENTS as an env
change plus redeploy, and written in the pilot log with the date.

## Feature flags by stage

| Variable | A internal merchant / collection | B internal driver | C real merchant, collection / own delivery | D real merchant + live card | E real merchant + Skhokholetha |
|---|---|---|---|---|---|
| `SKHOKHOLETHA_ENABLED` | unset | `true` | unset | unset | `true` |
| `DRIVER_SIGNUP_ENABLED` | unset | `true` | unset | unset | `true` while recruiting, then unset |
| `DELIVERY_REQUESTS_ENABLED` | unset | `true` | unset | unset | `true` |
| `DRIVER_APPROVALS_ENABLED` | unset | `true` while approving | unset | unset | `true` while approving, then unset |
| `DRIVER_TERMS_*`, `DRIVER_PRIVACY_*` | unset | internal draft URLs, clearly labelled | unset | unset | published documents only |
| `PAYMENTS_ALLOW_LIVE_VERIFICATION` | unset | unset | unset | `true` | as D |
| `BUDDY_EXTERNAL_AI` (external AI) | unset | unset | unset | unset | unset |
| `ANTHROPIC_API_KEY` | unset | unset | unset | unset | unset |
| `DOMAIN_REGISTRAR` | unset | unset | unset | unset | unset |
| `PAYFAST_MERCHANT_*` (platform billing) | unset | unset | unset | unset | unset |

"unset" is the safe default in code: every switch is OFF unless exactly
`true` (Skhokholetha) or `enabled` (external AI). Stages A and B run on a
non-production database.

## Payment pilot (stage D) — staged rollout

Preconditions, all verifiable in the Control Centre:

1. The merchant has their own PayFast merchant account (their agreement, their payouts). Skhokho Labs never holds customer money (`src/modules/orders/checkout-payment.ts`).
2. The merchant saved the LIVE credentials in Dashboard › Settings › Payments: business page › Payments shows a LIVE connection *pending verification*.
3. FINANCE and PLATFORM OWNER both agree, in writing in the pilot log, to switch on `PAYMENTS_ALLOW_LIVE_VERIFICATION`; TECHNICAL redeploys; Control Centre › Settings shows live verification **on**.
4. The R5 live verification is planned with the merchant (R5 leaves their customer's card — use the merchant's own card — and lands in their PayFast account).

Test sequence (one real R5 transaction):

| Step | Where to look | Expected |
|---|---|---|
| Merchant runs "Verify" in Settings › Payments | Payments › attempts: a `LIVE_VERIFICATION` attempt, status SUBMITTED | reference printed; nothing settled yet |
| PayFast callback arrives | Payments › attempt › Provider notifications | one row, outcome CONNECTION_VERIFIED; attempt COMPLETE |
| Settlement | business page › Payments | LIVE connection **verified**, verified-at timestamp |
| Order state | — | no order is involved in a verification |
| Reconciliation | run `/api/cron/payments` by hand or wait for the daily job | the attempt is not listed as unconfirmed; `manual.payments` / `daily.payments` job run ok |
| Control Centre trace | Overview › Payments OK (24h) = 1; readiness › Payments READY ("card payments live") | alert list empty |

Then one real customer order paid by card at a small amount: Orders › the order shows PAID with the PayFast reference, the attempt COMPLETE, one SETTLED provider notification; duplicate callbacks (PayFast retries) show as DUPLICATE_NOTIFICATION, never a second settlement. No larger volume until both have succeeded and FINANCE has reconciled the merchant's PayFast statement against Payments.

Stop levers: the merchant switches "pay online" off in Settings › Payments (immediate); the platform unsets `PAYMENTS_ALLOW_LIVE_VERIFICATION` (stops new verifications, not an already-verified connection).

## Skhokholetha pilot (stage E) — staged driver activation

Preconditions, in order:

| # | Precondition | Verified where |
|---|---|---|
| 1 | `SKHOKHOLETHA_ENABLED=true`, `DELIVERY_REQUESTS_ENABLED=true` | Control Centre › Settings switches |
| 2 | `DRIVER_SIGNUP_ENABLED=true` only while recruiting; `DRIVER_APPROVALS_ENABLED=true` only while approving | Settings |
| 3 | Driver terms and privacy notice published at https URLs with versions set | Settings › "legal documents configured" |
| 4 | Driver applied, documents uploaded (ID; licence and registration for motorised vehicles) | Drivers › pending |
| 5 | DRIVER OPERATIONS accepted each document and approved with a reason | Drivers › driver › decision audit rows |
| 6 | Driver accepted the configured legal versions | Drivers › driver › Legal acceptance table |
| 7 | Driver granted location consent and is online near the shop | Drivers › online; "Can work right now: yes" |
| 8 | `GOOGLE_MAPS_API_KEY` set (drop-off pin) and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (tracking map) | Settings; a quote on the storefront pins the address |
| 9 | Merchant's driver source is Both or Skhokholetha | business page › Delivery › Drivers |
| 10 | Customer delivery notice published and linked from checkout | legal register |
| 11 | Support contact and the DRIVER OPERATIONS on-call phone recorded in the pilot log | pilot log |

Test sequence (one real order, small amount, internal customer):

| Step | Expected | Trace |
|---|---|---|
| Merchant order placed and **paid** (card at stage D, or cash recorded at the counter first — only PAID orders are eligible) | order CONFIRMED → READY | Orders |
| Shop requests a Skhokholetha driver | delivery SEARCHING, quote shows customer fee, network minimum and merchant top-up | Deliveries › searching |
| Driver offer | OFFERED within the dispatch tick; median to first offer on Overview | Deliveries › delivery › Offers |
| Acceptance | ASSIGNED; shop notified; customer email "a driver is on the way to the shop" | Deliveries › delivery › Timeline |
| Pickup verification | shop reads the pickup code to the driver; PICKED_UP; order email "on its way" | Timeline event `pickup_verified` |
| Live tracking | customer tracking page shows the driver moving (location every 20 s while active) | tracking link in the customer email |
| Customer verification | customer gives the drop-off code; DELIVERED; order COMPLETED | Timeline `delivered` |
| Ledger | earning PENDING → AVAILABLE after 24 h | Drivers › driver › Earnings |
| Control Centre trace | delivery costs on the delivery, no incident, no alert | Deliveries › delivered |

Stop levers: `DELIVERY_REQUESTS_ENABLED` unset (running deliveries finish); Drivers › Suspend; Deliveries › Cancel before pickup (reason required).
