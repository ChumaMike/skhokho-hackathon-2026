# Support process (pilot)

No ticketing system exists and none is built for the pilot. Support is a
documented channel and a shared log.

## Channel

- **Merchant → Skhokho Labs:** one WhatsApp number held by MERCHANT SUPPORT
  (backup forwarded when they are off), answered during the merchant's
  trading hours plus one hour either side. Outside those hours: next
  morning, unless the uptime probe or a CRITICAL alert says otherwise.
- **Driver → Skhokho Labs (stage E):** the DRIVER OPERATIONS on-call phone,
  during delivery hours.
- **Customer → anyone:** customers contact the merchant (storefront contact
  details). A customer reaching Skhokho Labs is referred to the merchant,
  except for a data or privacy request, which goes to the Information
  Officer slot.
- **Skhokho Labs internal:** the ops channel; every case is one line in the
  support log (a shared sheet) until a ticketing tool is justified.

## Log line

`date · time · merchant · category · summary · who · status (open / waiting
on merchant / closed) · outcome · Control Centre reference (order number,
attempt reference, delivery id) · minutes to first response`

## Categories and first steps

| Category | Examples | First check (read-only) | Who | Never |
|---|---|---|---|---|
| ACCOUNT | can't log in, invite not received, staff removed by mistake | Users › owner row; business page › Staff; Security › rate-limit trips | MERCHANT SUPPORT | set or reveal a password; create staff for them |
| STOREFRONT | not visible, wrong hours, images missing, domain | business page › Storefront, Readiness, Trading, Domains | MERCHANT SUPPORT | edit their storefront; publish for them |
| ORDER | missing order, stuck order, customer says they ordered | Orders › business filter; Orders › needs attention | MERCHANT SUPPORT | change an order's status (no command exists) |
| PAYMENT | paid but unpaid, refund, card not offered | Payments › attempt › notifications; business page › Payments | PAYMENTS / FINANCE | touch amounts, provider ids, settlement |
| DELIVERY | no driver, late, wrong fee, area refused | Deliveries › business filter; business page › Delivery and zones | DRIVER OPERATIONS (network) / MERCHANT SUPPORT (own drivers, zones) | assign a driver for them; change fees |
| DRIVER | application status, documents, earnings, payout | Drivers › driver; Payouts | DRIVER OPERATIONS; FINANCE for payouts | disclose another person's data; approve without documents |
| TECHNICAL | errors, slowness, emails not arriving | Health; Security; `docs/runbooks.md` | TECHNICAL INCIDENTS | guess — ask for the `x-request-id` and the time |
| SECURITY | someone else's data visible, suspicious login, lost phone with the dashboard open | `docs/runbooks.md` R7, R8 | SECURITY, immediately | wait until morning |

## Rules

- First response within 15 minutes during trading hours; a next step within
  the hour; closed cases get a one-line outcome.
- Read-only first: every check above is a Control Centre page. If a fix
  needs the merchant's own hands, send them the exact page name from
  `docs/merchant-onboarding-checklist.md`.
- Anything that changes platform state is a Control Centre command with a
  reason, or a runbook step; the log line records which.
- Three cases of the same kind in a week become a P1 candidate in
  `docs/pilot-readiness.md`.
