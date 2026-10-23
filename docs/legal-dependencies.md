# Legal, POPIA and AI data dependencies

Status: **open — needs qualified legal review.** This document records what
the software does with personal information and which legal/compliance
decisions are outstanding. It is **not** legal advice and contains no legal
text; the documents listed below must be written or approved by counsel.

## Drafts written 2026-10-21 (`docs/legal/`)

Every document the register below marked "no" or "placeholder" now exists
as a plain-English draft headed **DRAFT FOR ATTORNEY REVIEW**, with a
`**Version:**` line (`v0.1-draft-2026-10-21`) and inline `[ATTORNEY: …]`
markers where counsel must decide and `[FILL IN: …]` where the founder must
supply a fact. **None is approved.** The Reviewed column stays "no" until
counsel signs off and the founder flips `draft` in
`src/lib/legal/documents.ts`.

| File | What it is | Wired into the app |
|---|---|---|
| `terms-of-service.md` | Platform Terms (customers; merchants as visitors) | **yes** — `/terms` renders it; version recorded on orders and appointments |
| `privacy-notice.md` | POPIA s18 notice: roles, data, operators, s72 basis, retention, rights, Information Officer | **yes** — `/privacy`; linked from the checkout and booking checkbox and every storefront footer |
| `merchant-terms.md` | SaaS terms: fees once paid plans start, payments, data roles (merchant = responsible party, platform = operator), liability | no — pilot runs on the signed pilot agreement |
| `ecta-storefront-information.md` | The s43 block template and its field mapping | **yes** — `EctaInformation` in every storefront footer, filled from Dashboard › Settings › Legal; merchant readiness shows NEEDS ACTION while legal name / returns text / complaints contact are missing |
| `data-subject-request-process.md` | Access / correction / deletion / objection procedure, the `ON DELETE RESTRICT` de-identification rule | no (procedure; tooling listed under "data-subject tooling" below) |
| `retention-schedule.md` | Every personal-data table, period, reason, enforced-or-not | no (only rate-limit and storefront-stat purges are enforced) |
| `driver-terms.md` | Skhokholetha contractor terms, earnings, payouts, conduct, deactivation | mechanism only — publish at an https URL and set `DRIVER_TERMS_VERSION/URL` |
| `driver-privacy-notice.md` | Driver documents, bank details, location, retention | as above via `DRIVER_PRIVACY_VERSION/URL` |
| `customer-delivery-notice.md` | What the driver sees; delivery page and drop-off code | no — checkout and `/delivery/<key>` do not link it yet (stage E follow-up) |
| `pilot-merchant-agreement.md` | The signed stop-gap with the first merchant | n/a (paper) |

Mechanism added the same day: `src/lib/legal/documents.ts` holds the
current versions; `scripts/legal/sync-legal-texts.mjs` (`npm run
legal:sync`) copies the two customer-facing markdown files into
`src/lib/legal/generated/` for the pages, and `legal-texts.test.ts` fails if
the generated copy or the version drifts from the markdown. Checkout
(`/api/store/checkout`) and booking (`/api/store/book`) refuse a page that
posts anything but the current Terms version (`TERMS_OUTDATED`) and store it
in `orders.terms_version` / `appointments.terms_version` with the time
(migration `20261022090002_terms_acceptance_on_orders_and_appointments`).

Still to build (engineering, not text): the customer delivery notice link
at checkout and on the delivery page; data-subject tooling (export script,
de-identification RPCs); purge jobs for the retention periods counsel
approves; a driver-document purge; merchant-terms acceptance recording at
registration before paid plans.

## Documents that must exist before real customer data or payments

| Document / role | Current state in the product | Needed before |
|---|---|---|
| Terms of Service (merchants and storefront customers) | Draft `docs/legal/terms-of-service.md` rendered at `/terms` with a version string; acceptance stored on orders and appointments. **Not reviewed** | Real customers, real payments |
| Privacy Notice (POPIA s18 notification) | Draft `docs/legal/privacy-notice.md` rendered at `/privacy`. **Not reviewed**; Information Officer details are `[FILL IN]` | Real customer data |
| Information Officer named and registered with the Information Regulator | None in product — a `[FILL IN]` in the Privacy Notice | Real customer data |
| Marketing-consent wording and record-keeping (POPIA s69 direct marketing) | Collected only by staff in person (see "Consent" below) | Any marketing message |
| Cross-business linking (s57 prior authorisation) | Not built; no consent is collected for it any more | Building the feature |
| Data-subject request process (access, correction, deletion) | Draft procedure `docs/legal/data-subject-request-process.md`; no self-service export/erasure; `ON DELETE RESTRICT` on payment and domain history handled by de-identification | Real customer data |
| Retention schedule | Draft `docs/legal/retention-schedule.md` covering every table; enforced in code only for storefront analytics (400 days) and rate-limit counters (2 days) | Real customer data |
| ECTA s43 information on storefronts (merchant identity, address, returns/cooling-off) | Shown in every storefront footer from Dashboard › Settings › Legal + the profile; readiness flags gaps. Template `docs/legal/ecta-storefront-information.md` | Real online sales |
| PayFast merchant agreements (each merchant's own account) | Merchants connect their own PayFast accounts | Live card payments |
| SaaS billing terms, VAT invoices | Draft `docs/legal/merchant-terms.md`; paid plans disabled; no billing | Paid plans |
| Registrar / ZACR terms, registrant data handling | Only a sandbox registrar exists | Domain sales |
| Operator agreements with processors (below) | Not recorded in the repo | Real customer data |
| Skhokholetha driver terms (independent-contractor terms, earnings, payouts, conduct, deactivation) | Draft `docs/legal/driver-terms.md`. Technically gated: until `DRIVER_TERMS_VERSION` + `DRIVER_TERMS_URL` point at a published document, nobody can accept, apply or be approved | Approving any real driver |
| Skhokholetha driver privacy notice (ID/licence documents, bank details, location while online) | Draft `docs/legal/driver-privacy-notice.md`. Gated the same way by `DRIVER_PRIVACY_VERSION` + `DRIVER_PRIVACY_URL` | Accepting real driver applications |
| Customer notice for Skhokholetha deliveries (driver sees address and phone after assignment; customer key / delivery page) | Draft `docs/legal/customer-delivery-notice.md`; not yet linked from checkout or the delivery page | First real merchant delivery |
| Driver document retention and deletion | Documents kept indefinitely in `driver_documents`; proposal in the retention schedule awaiting the founder's and counsel's decision | Real driver applications |

## Launch register (updated 2026-10-21)

Columns: EXISTS (the text) · REVIEWED (approved by counsel / the founder —
**nothing below is approved; this column is kept so the owner can mark it**)
· CONFIGURED (the app knows where it is) · VERSIONED · ACCEPTANCE CAPTURED
· BLOCKS (the earliest pilot stage, `docs/pilot-readiness.md` A–E, that
cannot start without it).

| Document | Exists | Reviewed | Configured | Versioned | Acceptance captured | Blocks |
|---|---|---|---|---|---|---|
| Terms of Service (platform; customers and merchants) | draft `docs/legal/terms-of-service.md` | no | `/terms` renders it; linked from checkout, booking, consent fields, every storefront footer | yes — `TERMS_VERSION` in `src/lib/legal/documents.ts` | yes — `orders.terms_version` / `appointments.terms_version` + time; stale version refused | C |
| Privacy Notice (POPIA s18) | draft `docs/legal/privacy-notice.md` | no | `/privacy`; linked from the same places | yes — `PRIVACY_VERSION` | n/a (a notice, not a contract) | C |
| Information Officer (named, registered with the Regulator) | no — `[FILL IN]` in the Privacy Notice | no | — | — | — | C |
| Merchant terms (SaaS; liability, fees, data roles) | draft `docs/legal/merchant-terms.md` | no | no | no | no | C — the signed pilot agreement (`docs/legal/pilot-merchant-agreement.md`, draft) is the stop-gap; paid plans stay off |
| Customer delivery notice (driver sees name, phone, address) | draft `docs/legal/customer-delivery-notice.md` | no | no — not linked from checkout or `/delivery/<key>` yet | yes (version line) | no | E |
| Driver terms | draft `docs/legal/driver-terms.md`; mechanism built | no | `DRIVER_TERMS_VERSION/URL` gate — publish the draft at an https URL to use it | yes | yes — `driver_legal_acceptances` | B (internal draft acceptable), E (reviewed text) |
| Driver privacy notice | draft `docs/legal/driver-privacy-notice.md` | no | `DRIVER_PRIVACY_VERSION/URL` | yes | yes — same table | B / E |
| Driver document retention | proposal in `docs/legal/retention-schedule.md` (90 d declined; approval + 1 y); decision not taken; documents kept indefinitely | no | no purge job | — | — | E |
| General retention schedule | draft `docs/legal/retention-schedule.md` — every table; partial in code: storefront counters 400 d, rate-limit buckets 2 d, assistant messages and buddy actions never purged | no | partial | — | — | C (written; enforcement can follow) |
| Data-subject request process (access, correction, deletion) | draft `docs/legal/data-subject-request-process.md`; `ON DELETE RESTRICT` on payment and domain history → de-identification, documented | no | no (manual procedure; tooling to build) | — | — | C |
| Processor / operator agreements (Neon, Vercel, Resend, Google, PayFast, Anthropic, Blob) | not recorded; the Privacy Notice lists each operator and region | no | — | — | — | C (record), D (PayFast is the merchant's own agreement) |
| Cross-border processing basis (s72: Neon us-east-1, Resend, Google Maps, Anthropic) | stated in the Privacy Notice §6 with an `[ATTORNEY]` marker for the s72 ground per operator | no | AI calls off by default (`BUDDY_EXTERNAL_AI`) | — | — | C for DB/email/maps; any external AI use until approved |
| ECTA s43 storefront information (merchant identity, address, returns, contact) | template `docs/legal/ecta-storefront-information.md`; block rendered in every storefront footer | no | Dashboard › Settings › Legal (legal name, registration no., returns text, complaints contact); readiness NEEDS ACTION while missing | — | — | C (each merchant fills it in) |
| Liability / insurance position (drivers, goods in transit, platform) | not stated — `[ATTORNEY]` markers in the Terms §8/§11, Merchant Terms §8/§12, Driver Terms §7 | no | — | — | — | E |

Mechanism verified in code on 2026-10-20: the driver legal gate
(`src/modules/skhokholetha/legal.ts`, `acceptDriverLegal`) refuses
applications and approvals until both version/URL pairs are set and the
driver accepted exactly those versions; acceptance rows are append-only with
a hashed IP and user agent.

## Application state per document (verified 2026-10-13)

Naming for every legal document: **Skhokho Laboratory ("Skhokho Labs")**, operator
of the Skhokho platform and the Skhokholetha delivery network. Never "Skhokho" alone.

| Document | Document exists | Configured in app | Versioned | Acceptance captured | Review still required |
|---|---|---|---|---|---|
| Platform Terms of Service (customers + merchants) | placeholder page only (`src/app/terms/page.tsx`, says so on the page) | hard link `/terms` from checkout, booking, consent fields, footer | no | checkout/booking: a required checkbox, nothing stored; merchant signup: none | **yes — write, approve, then version + store acceptance** |
| Privacy Notice (POPIA s18) | no | no | no | no | **yes** |
| Information Officer details / registration | no | no | — | — | **yes** |
| Merchant terms (SaaS) | no | no | no | no | yes before paid plans; pilot runs on written agreement |
| Driver terms | text not in repo; `DRIVER_TERMS_URL` must point at a published https document | `DRIVER_TERMS_VERSION` + `DRIVER_TERMS_URL` (legal gate blocks approvals until set) | yes | yes — `driver_legal_acceptances` (append-only) + `driver_profiles.agreement_*` | **yes — the text** |
| Driver privacy notice | as above | `DRIVER_PRIVACY_VERSION` + `DRIVER_PRIVACY_URL` | yes | yes — same tables | **yes — the text** |
| Customer delivery notice (Skhokholetha: driver sees name, phone, address) | no | no | no | no | **yes** before stage E |
| Data retention schedule | partial in code (storefront counters 400 d, rate-limit buckets 2 d); driver documents kept indefinitely | — | — | — | **yes** |
| Processor / operator agreements (Neon, Vercel, Resend, Google, PayFast, Anthropic) | not recorded | — | — | — | **yes** (register them here) |
| Cross-border transfer basis (s72: Neon us-east-1, Resend, Google, Anthropic) | noted below only | `BUDDY_EXTERNAL_AI` keeps every model call off; email/DB/maps are unavoidable | — | — | **yes** |
| ECTA s43 merchant information on storefronts | not shown | no | — | — | **yes** before stage C |

Nothing above is approved by this repository; "yes" in the first columns means the
mechanism exists, not that counsel has signed anything off.

## Where personal information goes (processors)

| Processor | What it receives | Region / transfer | Notes |
|---|---|---|---|
| Neon (Postgres) | All application data, including customer phone numbers and names (identity tables) | Configured hosts are `*.us-east-1.aws.neon.tech` — **outside South Africa** (POPIA s72 cross-border transfer) | Confirm region choice and operator terms |
| Vercel (hosting, functions, logs, Blob) | All requests; server logs; uploaded images | Function region per project settings (not in repo) | Logs must not carry personal data (see Logging) |
| PayFast | Customer name/email/phone typed at checkout, sent to the merchant's own PayFast account | South Africa | Customer → merchant only; Skhokho never receives card data (redirect-only) |
| Resend (email) | Recipient email addresses and message content | Outside South Africa | Transactional only |
| Google Maps (geocoding) | Delivery addresses (server-side) | Outside South Africa | Only when per-km delivery is used |
| Anthropic (AI) | See "AI" — **no customer data by default** | Outside South Africa | Off for the Business Buddy unless `BUDDY_EXTERNAL_AI=enabled` |
| Domain registrar | Registrant details | — | Not integrated (sandbox only) |

## AI data boundary (implemented)

Update 2026-10-21: every external model call now goes through one wrapper
(`src/lib/ai/anthropic.ts`) behind the single switch, is metered per
business and recorded as an `ai_usage_events` row without prompt or answer.
Marketing generation sends business, catalogue, brand-profile and
aggregated sales facts only — never customer names, numbers, addresses,
payments or delivery codes (`docs/content-marketing.md`). The cross-border
basis for the provider still needs counsel's sign-off before the switch is
turned on in production.

| AI feature | What is sent externally | Customer data? |
|---|---|---|
| Business Buddy chat / Q&A | **Nothing** by default (rules-only). When `BUDDY_EXTERNAL_AI=enabled`: the business's own name, counts and totals, and **pseudonymised** customer labels ("Customer 1") — names are replaced before sending and restored locally (`pseudonymiseForModel`, `src/modules/assistant/llm-provider.ts`) | No names leave the server |
| Storefront AI drafts | The business's own details (name, description, product/service names, owner-written text) | No |
| Onboarding brief, category classifier, content/template generation | The owner's own answers / business description | No |

Recommendation: keep `BUDDY_EXTERNAL_AI` unset until counsel approves the
cross-border AI processing basis and the Privacy Notice discloses it.

## Consent (implemented — B6 MVP)

- Public forms (loyalty sign-up, storefront booking, checkout) **cannot prove
  phone ownership**, so they record only the loyalty-programme consent the
  customer actively joins, never marketing or cross-business consent, and
  never attach an email to the customer's identity. A confirmation email goes
  only to the address typed for that order/booking.
- Marketing consent is recorded only by staff adding a customer **in person**
  (`Dashboard › Customers › Add`).
- Next step (needs a product decision + SMS provider): OTP verification of
  phone ownership, after which public marketing opt-in can return.

## Logging

Personal data must not appear in logs. Known items: when email is not
configured, `src/lib/email.ts` logs the recipient address (backlog). PayFast
logs carry references and amounts only.
