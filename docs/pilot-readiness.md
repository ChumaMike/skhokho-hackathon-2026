# Controlled merchant pilot — readiness

Status as of 2026-10-20, after the merchant P0 pass, the combined readiness pass and the
pilot-preparation pass (`docs/production-config.md`, `docs/uptime-probe.md`,
`docs/pilot-staging.md`, `docs/pilot-acceptance-test.md`, `docs/pilot-daily-checklist.md`,
`docs/incident-drills.md`, `docs/support-process.md`, `docs/pilot-metrics.md`)
(`docs/architecture-readiness.md`, `docs/backup-restore.md`, `docs/runbooks.md`,
`docs/pilot-operations-model.md`). Companion documents:
`docs/merchant-onboarding-checklist.md` (what a merchant does),
`docs/pilot-monitoring.md` (what admins watch), `docs/production-readiness.md`,
`docs/legal-dependencies.md`, `docs/skhokholetha.md`.

Test gate for the PR to `main`: **passed on 2026-10-21** — 1,210 node tests
in 97 files, 28 HTTP tests, 0 failures; typecheck, lint, schema and build
green (`docs/reports/2026-10-21-test-gate.md`).

Verdict: **READY FOR INTERNAL PILOT** (stages A and B below) on the test
environment as soon as the configuration rows are done. **READY FOR MERCHANT
PILOT WITH PRECONDITIONS** for stages C–E: the engineering work is done; the
remaining blockers are configuration, legal text and operations.

## Stages and what each still needs

| # | Stage | Engineering | Configuration | Legal | Operational |
|---|---|---|---|---|---|
| A | Internal merchant test (our own test shop, our own phones) | READY | startup vars, `RESEND_*`, `PAYMENT_ENCRYPTION_KEY`, `CRON_SECRET`, first admin via `create-admin` | — | an admin with MFA enrolled; a test shop set up from the checklist |
| B | Internal driver test (our own driver, our own shop) | READY | A + `SKHOKHOLETHA_ENABLED`, `DRIVER_SIGNUP_ENABLED`, `DELIVERY_REQUESTS_ENABLED`, `DRIVER_APPROVALS_ENABLED`, `DRIVER_TERMS_*`, `DRIVER_PRIVACY_*` (an internal, clearly-labelled draft is acceptable for staff-only testing), `GOOGLE_MAPS_API_KEY` | — | a reviewer with OPERATIONS role |
| C | Real merchant pilot (one shop, pay in person) | READY | A on production; `STOREFRONT_DOMAIN` and the shop's address pinned | Terms of Service and Privacy Notice published; Information Officer named; ECTA s43 merchant details shown on the storefront; data-subject request process | support contact and hours agreed with the merchant; daily pilot log |
| D | Real customer order with card payment | READY | `PAYMENTS_ALLOW_LIVE_VERIFICATION=true`; the merchant's own verified LIVE PayFast account | C + PayFast merchant agreement is the merchant's own | sign-off on the R5 live verification; refund-due handling owner named |
| E | Real Skhokholetha delivery | READY | B on production | C + driver terms, driver privacy notice, customer notice for network deliveries, driver document retention decision; liability / insurance position for drivers stated | approved drivers near the shop; on-call for dispatch; payout process (manual payouts via Admin › Payouts) |

### Legal items (drafted 2026-10-21 — none reviewed by counsel; all still open)

Every text now exists as a draft in `docs/legal/` headed DRAFT FOR
ATTORNEY REVIEW (see the register in `docs/legal-dependencies.md`).
Terms of Service (draft rendered at `/terms`, version recorded at checkout
and booking) · Privacy Notice (draft at `/privacy`; Information Officer
still `[FILL IN]`) · Information Officer registration (none) · ECTA s43
storefront information (block rendered in every storefront footer from
Dashboard › Settings › Legal; readiness flags gaps) · data-subject request
process (draft procedure; no tooling) · retention schedule (draft covering
every table; enforcement partial) · operator agreements with Neon, Vercel,
Resend, Google, PayFast (not recorded) · driver terms and driver privacy
notice (drafts; the app refuses approvals until `DRIVER_TERMS_*` /
`DRIVER_PRIVACY_*` point at published documents) · customer notice for
Skhokholetha deliveries (draft; not yet linked from checkout or the
delivery page) · driver document retention (proposal; kept indefinitely
today) · cross-border transfer basis for Neon / Resend / Google (stated in
the Privacy Notice, s72 ground for counsel) · pilot merchant agreement
(draft to sign before stage C).

### Feature flags per stage

| Flag | A | B | C | D | E |
|---|---|---|---|---|---|
| `SKHOKHOLETHA_ENABLED` | off | on | off | off | on |
| `DRIVER_SIGNUP_ENABLED` | off | on | off | off | on (or off once the pilot drivers are in) |
| `DELIVERY_REQUESTS_ENABLED` | off | on | off | off | on |
| `DRIVER_APPROVALS_ENABLED` | off | on | off | off | on while approving, then off |
| `PAYMENTS_ALLOW_LIVE_VERIFICATION` | off | off | off | on | as D |
| `BUDDY_EXTERNAL_AI` | unset | unset | unset | unset | unset |
| `DOMAIN_REGISTRAR` | unset | unset | unset | unset | unset |

Flags are read on every call, so they can be flipped without a deploy.

### Production environment variables

Required to start: `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`,
`JWT_SECRET` (≥ 32 chars), `NEXT_PUBLIC_APP_URL` (https), `CRON_SECRET`.
Pilot features: `RESEND_API_KEY`, `EMAIL_FROM` (customer and staff email),
`PAYMENT_ENCRYPTION_KEY` (PayFast credentials and admin MFA secrets),
`STOREFRONT_DOMAIN`, `PLATFORM_DOMAIN`, `ADMIN_DOMAIN`, `BLOB_READ_WRITE_TOKEN`
(product photos), `GOOGLE_MAPS_API_KEY` (distance pricing, Skhokholetha
drop-off pin, tracking map), `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (map render),
the Skhokholetha flags and legal variables above when B/E start,
`PAYMENTS_ALLOW_LIVE_VERIFICATION` when D starts. Keep `PAYFAST_MERCHANT_*`
(platform billing), `ANTHROPIC_API_KEY`, `VERCEL_DOMAINS_*` out of the pilot.

## First-merchant onboarding procedure

1. Platform: production deployed with the "required to start" and "pilot
   features" variables above; an admin exists (`create-admin`, then
   `grant-super`), signed in once and enrolled in MFA.
2. Merchant: follows `docs/merchant-onboarding-checklist.md` top to
   bottom on their own phone. No step needs us.
3. Us: watch Admin › Businesses for the new business (PENDING_VERIFICATION
   until they publish), then the two test orders in Admin › Orders.
4. Stage D only: the merchant connects their PayFast account and runs the
   R5 verification in Settings › Payments (platform flag on first).
5. Day one: an admin follows `docs/pilot-monitoring.md`; the merchant has
   the support contact.

Where a platform admin is involved and why that is appropriate: suspending
or reactivating a business (safety), driver approvals (identity documents),
flipping Skhokholetha switches (platform-wide risk), allowing live card
verification (money). None of these is part of a normal onboarding.

## First-driver procedure

1. `DRIVER_SIGNUP_ENABLED` and `SKHOKHOLETHA_ENABLED` on; `DRIVER_TERMS_*`
   and `DRIVER_PRIVACY_*` point at published documents.
2. Driver: `/driver/join` — name, phone, email, password → verifies email
   (link by email) → profile, vehicle (bicycle / scooter / motorcycle /
   car / bakkie), payout details → uploads documents (ID; plus licence
   and vehicle registration for motorised vehicles) → accepts the terms
   and privacy notice (versions recorded) → submits.
3. Admin (OPERATIONS or SUPER_ADMIN): Admin › Drivers → accept each
   document → Approve (reason required; `DRIVER_APPROVALS_ENABLED` on).
4. Driver: grants location consent, goes online at `/driver`; offers
   arrive for paid, confirmed delivery orders near them; pickup needs the
   shop's code, drop-off needs the customer's code.
5. Earnings land in the ledger (held → available); payouts are created and
   marked paid by FINANCE in Admin › Payouts.

## Self-service gaps found in the walkthrough (not blockers)

| Step | Today | Appropriate? |
|---|---|---|
| Enabling a module the category does not grant by default (e.g. Bookings for a food vendor) | Settings › Modules: switch any module on or off; plan-gated modules (loyalty) show why they are locked (`capabilities.ts` `setBusinessModule`) | done 2026-10-21 |
| Editing the business email | Settings › Contact email: the new address takes effect only once a link sent to it is opened (`business-email.ts`) | done 2026-10-21 |
| Product order on the storefront | Catalogue ↑/↓ sets `Product.sortOrder` (featured first, then the owner's order, then name) | done 2026-10-21 (Tab 7 renders) |
| "Sold out today" | Catalogue "Sold out today": `Product.soldOutUntil` to the end of the trading day (SAST), clears itself; the cart refuses the line (`SOLD_OUT`); distinct from Hide | done 2026-10-21 (Tab 7 renders) |
| Pre-order date / prep time | Prep time: Storefront › Ordering › Preparation time (`settings.ordering.prepMinutes`, 0–240) — Customer accounts shows it as the ETA; pre-order dates still open | partly done 2026-10-21 |

## P1 triage

PILOT BLOCKER — none remaining after this pass (order cancellation with an
open delivery and the first-admin bootstrap were fixed here).

PILOT NICE-TO-HAVE — Content & Marketing follow-ups: per-channel preview styling, an "all channels" regenerate on one draft, assistant conversation memory across turns, a retention purge for ai_usage_events older than 13 months · fix the 13 React-compiler lint findings (`react-hooks/set-state-in-effect`,
`purity`, `error-boundaries`, downgraded to warnings in `eslint.config.mjs` on
2026-10-20 because eslint-plugin-react-hooks 7 under the lockfile turned them
into errors in untouched client components) · hold driver earnings while a delivery is DISPUTED and add a
resolve-dispute command (today a dispute neither freezes nor reverses the
earning; manual payouts are the control) · a give-up timeout for a
Skhokholetha search (today it retries until cancelled; surfaced by
`dispatch_down`) · bound `listDeliveriesForManagement` and the unread-notification
anti-join (pulse endpoint) · skip geocoding on quotes in ZONE mode · `order_events`
table (see architecture doc §2) · one Anthropic fetch wrapper with usage accounting ·
quote merchant text as untrusted in every prompt · a "mark refund resolved" admin
command (reason + audit) so REFUND_DUE rows can be closed · a driver availability
visibility check on the driver console polling (background tabs keep polling) ·
sold-out flag separate from hide · product sort order ·
prep time / ETA on confirmation · mobile nav menu on the storefront ·
zone map preview · editable business email · proof-of-delivery code for
own drivers · "accept with ETA" distinct from confirm · cancellation
reasons list · a cumulative cap on drop-off code reissues · SEO basics
(sitemap, robots, noindex on checkout) · stale eslint-disable directives.

WAIT FOR USER EVIDENCE — SMS / WhatsApp status messages (needs a provider
and consent wording; email covers the pilot) · scheduled / advance orders
(bakery) · modifiers for every category (option groups exist for food) ·
real product variants with stock · CSV product import · pay-in-person as a
customer choice next to card · plan-limit enforcement · catalogue
enhancements beyond categories · multi-location · loyalty automation ·
customer accounts and order history · refunds via API · promotions.
