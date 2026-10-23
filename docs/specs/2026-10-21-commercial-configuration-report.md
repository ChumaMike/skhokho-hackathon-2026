# Commercial Configuration Report — Phase A (platform billing)

**Date:** 2026-10-21 · **Status:** SUPERSEDED as a decision request — kept as the audit it was.
**Companion to:** `docs/specs/2026-10-21-platform-billing-design.md`
**Every figure below is read from the database migrations and the code, not recalled.**

> **Answered 2026-10-21.** The decisions this report asked for were given and are
> recorded in **`docs/specs/2026-10-21-plans.md`**, now the authority on
> packaging, prices and billing behaviour: GROW R599/month, PRO R1299/month, VAT
> deliberately left dual-mode until the registration status of Skhokho Laboratory
> is confirmed. Phase A is built on branch `feature/platform-billing`.
>
> This document is kept unchanged below because its value is the **audit**, not
> the request. §B and §C record exactly which entitlements existed and which had
> no enforcement at all on 2026-10-21 — that `withinLimit()` had no callers, and
> that five capabilities were advertised to GROW/PRO while every FREE business
> already had them. Read the "STOP" at the end as history.

## A. Current plans

From `prisma/migrations/20261004130000_plans_and_entitlements/migration.sql`.

| code | name | price_cents | interval | default | public | sort |
|---|---|---|---|---|---|---|
| `FREE` | Free | **0** | NULL | **yes** | yes | 10 |
| `GROW` | Grow | **NULL** | MONTHLY | no | yes | 20 |
| `PRO` | Pro | **NULL** | MONTHLY | no | yes | 30 |

Taglines: FREE "Everything you need to start selling online." · GROW "A richer
shopfront, deeper insights and a bigger team." · PRO "Your own .co.za address
and the most advanced tools."

**Both paid plans have no price.** The showcase therefore renders "Pricing
coming soon" (`priceLabel()` in `src/app/showcase/data.ts`). Nothing can be
billed until these are set.

## B. Current entitlements

33 `plan_entitlements` rows across two migrations. "Enforced" = a code path
actually checks it.

### Boolean capabilities

| feature key | label | FREE | GROW | PRO | enforced? |
|---|---|---|---|---|---|
| `basic_analytics` | Sales overview | ✓ | ✓ | ✓ | **yes** |
| `advanced_analytics` | Longer sales history | — | ✓ | ✓ | **yes** (6 vs 26 weeks) |
| `advanced_storefront` | Advanced storefront | — | ✓ | ✓ | **NO** |
| `custom_domain` | Your own .co.za address | — | — | ✓ | **yes** |
| `loyalty` | Loyalty programme | ✓ | ✓ | ✓ | no (granted to all — neutral) |
| `advanced_staff` | Advanced team tools | — | ✓ | ✓ | **NO** |
| `ai_business_buddy` | Ask Skhokho (AI assistant) | ✓ | ✓ | ✓ | **yes** (16 sites) |
| `advanced_ai` | Advanced AI | — | — | ✓ | **NO** |
| `multi_location` | Multiple locations | — | — | ✓ | **NO** |
| `content_studio` | Content & Marketing studio | — | ✓ | ✓ | **yes** |
| `content_generation` | AI content writing | — | ✓ | ✓ | **yes** |
| `content_campaigns` | Marketing campaigns | — | ✓ | ✓ | **yes** |
| `content_calendar` | Content calendar | — | — | ✓ | **yes** |
| `advanced_business_insights` | Business insights for content | — | — | ✓ | **NO** |

### Limits

| feature key | FREE | GROW | PRO | enforced? |
|---|---|---|---|---|
| `max_staff` | 2 | 5 | 20 | **NO** |
| `max_products` | 50 | 200 | 500 | **NO** |
| `max_services` | 10 | 25 | 100 | **NO** |
| `ai_generations_monthly` | **20** | **150** | **500** | **yes** |
| `content_campaigns_monthly` | — | 10 | 50 | **yes** |
| `ai_token_budget_monthly` | *not granted by any plan* | | | enforced but **dormant** |

Core product deliberately needs no entitlement row and is free to everyone:
storefront, `*.skhokho` subdomain, catalogue, orders, customers, AI-assisted
storefront creation, merchant-direct card payments.

## C. Current unenforced limits

**This is the most commercially significant finding in this report.**

`withinLimit()` exists, is exported, is tested — and **is never called anywhere
in the application.** Eight entitlement keys have zero enforcement sites:

| key | plans that "include" it | reality today |
|---|---|---|
| `max_staff` | 2 / 5 / 20 | any business can add unlimited staff |
| `max_products` | 50 / 200 / 500 | unlimited |
| `max_services` | 10 / 25 / 100 | unlimited |
| `advanced_storefront` | GROW, PRO | every FREE business already has it |
| `advanced_staff` | GROW, PRO | every FREE business already has it |
| `advanced_ai` | PRO | everyone has it |
| `multi_location` | PRO | everyone has it |
| `advanced_business_insights` | PRO | everyone has it |

Because `toShowcasePlan` derives the showcase feature list straight from
`plan_entitlements`, **the public pricing page already advertises all eight as
GROW/PRO benefits.** A FREE business has them regardless.

What genuinely differentiates the paid plans *today*:

- `custom_domain` — enforced in `settings/domains/actions.ts` (two call sites) and the page.
- `advanced_analytics` — 26 weeks of history instead of 6.
- `content_studio` / `content_generation` / `content_campaigns` / `content_calendar` — enforced in `modules/content/` and `dashboard/content/gate.ts`.
- `ai_generations_monthly` — hard-enforced in `lib/ai/anthropic.ts` (20/150/500 per month, metered per call, refuses with `BLOCKED_ALLOWANCE`).
- `content_campaigns_monthly` — enforced in `modules/content/campaigns.ts`.

So **GROW and PRO are sellable today on Content & Marketing, AI volume, custom
domain and analytics history — and nothing else.** The other eight need
enforcement written before they can honestly appear on a price list.

One subtlety worth preserving: `allowanceFor()` reads
`entitlements.features.ai_token_budget_monthly` directly and maps *not granted*
to `null` (no cap), rather than using `featureLimit()` which would return `0`
and block every AI call for every business. That is deliberate and correct —
do not "tidy" it into `featureLimit`.

## D. Candidate paid add-ons

### D.1 Already priced and sold (sales-led, agency-delivered)

From `SERVICES` in `src/app/showcase/data.ts`. Prices per `CLAUDE.md`, which is
the single source of truth for them. Delivery lives in `ChumaMike/skhokho-labs`.

| service | setup | monthly |
|---|---|---|
| Website | from R1 500 | from R300 |
| WhatsApp ordering | R3 000 | R1 000 |
| AI voice agent | from R2 500 | from R1 500 |
| Content dashboard | R5 000 | R1 500 |
| Speed to lead | R4 500 | from R1 000 |

These stay **enquiry-only**. Phase A bills their recurring portion
automatically once an admin records the closed deal; it never sells them
self-serve.

### D.2 Platform capabilities that could realistically be sold separately

Ranked by how close they are to sellable. "Needs enforcement" means the gate
must be written first (§C).

| candidate | basis | state |
|---|---|---|
| **Content & Marketing studio** | `content_studio` + generation + campaigns + calendar | **enforced — sellable now** |
| **AI generation top-up** | `ai_generations_monthly`, metered per call | **enforced — sellable now** (natural consumable add-on) |
| **Custom .co.za domain** | `custom_domain` | **enforced — sellable now** |
| **Longer analytics history** | `advanced_analytics` | **enforced — sellable now** |
| Extra staff seats | `max_staff` | needs enforcement |
| Larger catalogue | `max_products` / `max_services` | needs enforcement |
| Multiple locations | `multi_location` | needs enforcement + the feature may not exist yet |
| Advanced AI | `advanced_ai` | needs enforcement + definition (what is it, vs `ai_business_buddy`?) |
| Advanced storefront | `advanced_storefront` | needs enforcement; premium storefront currently ships to all |
| Advanced team tools | `advanced_staff` | needs enforcement + definition |

`ai_token_budget_monthly` is the cleanest cost-control lever you own and is
already wired — granting it to a plan is one row.

## E. Exact decisions still required from you

Phase A is blocked on 1 and 2. The rest can follow but shape the work.

1. **`GROW` and `PRO` monthly prices** (integer cents, ZAR). I will not invent
   these. One `UPDATE` per plan, no deploy.
2. **VAT** — see §E.1. Affects invoice *content and wording*, not just totals.
3. **Packaging** — confirm or change the recommendation in §E.2.
4. **Enforcement scope for Phase A**: ship billing against the five
   *already-enforced* levers only, or write enforcement for the eight unenforced
   keys first? (Recommendation: bill on what's enforced; enforce the rest in a
   separate, clearly-communicated change — tightening a limit on existing
   businesses is a customer-trust event, not a billing task.)
5. **Add-on pricing for D.2 items** you want to sell separately.
6. **Invoice numbering format** (e.g. `SKH-2026-0001`) and whether numbering
   restarts each financial year.
7. **Payment terms** — days until an EFT invoice is due (recommend 7), and the
   bank details to print.
8. **Who receives billing email** — `BusinessSubscription.billingEmail` already
   exists and is unused; fall back to the owner's account email?

### E.1 What depends on whether Skhokho Laboratory is VAT registered

I am making **no VAT assumption**. Confirm with your accountant, not with me.
These behaviours differ:

| if **registered** | if **not registered** |
|---|---|
| Invoices must be headed **"Tax Invoice"** | Must **not** say "Tax Invoice" |
| Must print SGDataInt's VAT number | No VAT number |
| Must show a VAT line and the rate | **No VAT line at all** |
| `vat_cents` populated | `vat_cents` = 0 |
| Credit notes become "Tax Credit Notes" with the same fields | Plain credit note |
| Must declare whether `plans.price_cents` is **inclusive** or **exclusive** | Price is simply the price |

Further decisions that only arise if registered:

- **Inclusive or exclusive storage.** If `price_cents` is inclusive, VAT is
  derived at 15/115 of the total. If exclusive, 15% is added at invoice time.
  The *same number* means two different things, so this must be fixed before
  the first invoice is issued and recorded in the plan table's own comment.
- **Rounding** — per line or per invoice total. Pick one and test it.
- **Showcase labelling** — prices need "incl. VAT" / "excl. VAT" on the public
  page; today they carry neither.
- **Future registration.** If you are not registered now but cross the
  threshold later, either prices rise ~15% or margin drops ~13%. Decide now
  which, because it changes how you advertise today.

The data model carries `vat_cents` and `subtotal_cents` either way, so the
schema does not depend on this answer — only the invoice renderer, the
wording, and the public price labels do. **No invoice may be issued until this
is settled**, because a wrongly-worded invoice is a compliance problem that has
to be credited and reissued.

### E.2 Packaging recommendation — recommendation only, not a decision

Built on what is *enforced*, and on your instruction that Content & Marketing
and AI are intentionally paid. **Your call, not mine.**

**Entry / FREE — keep it genuinely useful.** Storefront, subdomain, catalogue,
orders, customers, loyalty, merchant-direct card payments, sales overview, Ask
Skhokho with a small AI allowance (20/month). Rationale: a spaza shop must be
able to trade for free and feel the product works, or the funnel never starts —
and merchant-direct payments must never be paywalled, since that is how the
merchant earns the money to pay you.

**GROW — "the shop is working, now market it."** Everything in FREE, plus
Content & Marketing studio, AI content writing, campaigns (10/month), 150 AI
generations/month, 26-week analytics history. Rationale: every one of these is
enforced today, and it is a coherent story — the owner who is trading and now
wants customers coming back.

**PRO — "this is my main business."** Everything in GROW, plus custom .co.za
domain, content calendar, 500 AI generations/month, 50 campaigns/month.
Rationale: the domain is the single clearest "I'm serious" signal and is
properly enforced.

**Paid add-ons — consumables and one-offs, not tiers.** AI generation top-ups
(the natural metered upsell), the five agency services in D.1, and later extra
staff seats / larger catalogue once enforced.

**My recommendation on the eight unenforced keys:** remove
`advanced_storefront`, `advanced_staff`, `advanced_ai`, `multi_location` and
`advanced_business_insights` from the advertised plan rows until they are
enforced and defined. Advertising a benefit everyone already has is the kind of
thing a customer notices exactly once, and it costs you the sale you were
making honestly on content and AI.

## F. Recommended Phase A behaviour

1. **Invoices exist as records.** Generated for a plan period and/or add-ons,
   with immutable line items and a snapshot of the plan code and price.
2. **Settlement is manual.** An admin marks an invoice paid (EFT reference
   captured). No card, no tokenization, no PayFast call anywhere in Phase A.
3. **Payment moves entitlements, nothing else does.** Marking paid calls the
   existing `changeBusinessPlan` / `setSubscriptionStatus`. Entitlements are
   never written directly.
4. **Owners can see what they owe and what they paid**, with downloadable
   invoices.
5. **Anniversary from activation date** (your preference). Next period runs
   from the activation day-of-month; no month-end proration.
6. **10-day grace** (your preference) — one constant change, see §K.
7. **Nothing is automated that can take money.** The renewal *invoice* may be
   generated automatically; collection never is in Phase A.

## G. What Phase A will and will not automate

**Will automate**
- Invoice generation for the next period, from the subscription and active add-ons.
- Invoice numbering, totals, line items, due date.
- A reminder email before due, and on overdue.
- Grace-period entry/exit and the downgrade to FREE at grace end.
- The audit trail for every state change (`recordAudit`, existing).

**Will not automate**
- Charging a card. No tokenization, no ad-hoc API, no stored card. (Your items 12 and 14.)
- Collecting money by any means. Phase A records; a human settles.
- Selling add-ons self-serve. Enquiry → admin records the deal.
- Plan upgrades initiated by the owner. Phase A: they request, an admin applies.
- Refunds or credit notes beyond recording them.
- Anything touching the merchant PayFast checkout. (Your item 13 — Phase A does
  not go near `src/lib/payfast.ts`, `src/modules/payments/` or the merchant
  notify route. The `skhp_` namespace reservation in §H is a comment and a
  constant, not a change to the proven path.)

## H. Tables and migrations Phase A will add

One additive migration. No changes to any existing table, no changes to any
existing enum used by merchant payments.

```
platform_invoices        id, business_id FK(Restrict), number unique,
                         period_start, period_end, plan_code_snapshot,
                         subtotal_cents, vat_cents, total_cents,
                         currency (ZAR), status, due_at, paid_at,
                         settled_method, settled_reference, settled_by,
                         created_at
                         -- status: DRAFT | OPEN | PAID | UNCOLLECTIBLE | VOID
                         -- settled_method: EFT | CASH | CARD | WRITE_OFF
                         -- partial unique (business_id, period_start)
                         --   where status <> 'VOID'   ← idempotency

platform_invoice_lines   id, invoice_id FK(Restrict), kind, description,
                         quantity, unit_cents, amount_cents
                         -- kind: PLAN | ADDON | SETUP | PRORATION | CREDIT

platform_settlements     id, invoice_id FK(Restrict), business_id FK(Restrict),
                         reference unique, amount_cents, method,
                         received_at, recorded_by, note, created_at
                         -- the ledger: one row per money actually received
                         -- partial unique: one non-void settlement per invoice

business_addons          id, business_id FK(Restrict), service_slug,
                         setup_cents, monthly_cents, status,
                         started_at, ended_at
                         -- status: ACTIVE | SUSPENDED | ENDED
```

Deliberately **not** created in Phase A: `platform_payment_methods` and
`platform_charges`. Those are Phase B (cards) and have no purpose without
tokenization.

**Namespace reservation (your item 8).** The `skhp_` reference prefix and the
`/api/platform-billing/*` route space are reserved in Phase A — documented, with
the prefix as a constant — but no platform notify route is built, because
nothing sends notifications yet. Merchant references keep `skh_`. Nothing in
the merchant path changes.

**Idempotency at the database layer (your item 15).** Three partial unique
indexes carry it: one live invoice per business per period, one settlement per
invoice, one active add-on per business per service slug. A double-run of
invoice generation fails at the database, not in application logic.

**Ledger separation (your item 10).** Four streams, four record sets, no shared
table and no shared sum:

| stream | records | direction |
|---|---|---|
| Merchant GMV (customer → merchant) | `Order`, `BusinessPaymentAttempt` | never touches Skhokho |
| Skhokho Labs subscription revenue | `platform_invoices`, `platform_settlements` | merchant → SGDataInt |
| Skhokholetha delivery settlement | `NetworkDelivery`, `OrderDelivery` | per delivery |
| Driver earnings | `DriverLedgerEntry`, `DriverPayout` | SGDataInt → driver |

No report, query or view in Phase A sums across two of these. The driver ledger
is already append-only with no balance field (balance = SUM of entries, unique
`sourceKey` per event) — `platform_settlements` follows the same discipline.

## I. Merchant billing UX

`/dashboard/settings/billing`, gated on `canManageBilling` — granted by **no
role preset** (`src/types/index.ts:141`, pinned by `workspace-nav.test.ts:193`),
so owner-only in practice. Staff must not see what the business pays Skhokho.

Shows: current plan and what it includes · next invoice date and amount ·
invoice history, each downloadable · amount outstanding, if any · bank details
and reference for EFT · "Request a plan change" (opens an enquiry in Phase A,
not a checkout) · during grace, a plain banner stating what lapses and when.

Never shows: SGDataInt's PayFast credentials, any card data (none exists in
Phase A), another business's anything.

Copy follows house rules — plain warm South African English, `R 1 234.56`,
mobile-first. Degrades like `/dashboard/settings/payments` does: if billing is
not configured, a plain banner, never an env var name or a shell command.

## J. Control Centre (platform-admin) billing UX

Extends `src/app/platform-admin/(console)/`, which already has per-business plan
changes and an `EntitlementOverride` editor.

- **Invoices** — list and detail, global and per business; filter by status.
- **Record settlement** — mark paid with method, reference, date, note. Writes
  `platform_settlements` and moves the subscription in one transaction.
- **Overdue queue** — what is past due, by how long, with the owner's contact.
- **Write off** — `UNCOLLECTIBLE`, reason mandatory.
- **Void / credit** — never delete an invoice; void it and issue a credit line.
- **Add-ons** — record a closed deal (slug, setup, monthly, start date).
- Every action audited via `recordAudit` with the acting admin's identity.

## K. How plan and add-on entitlement changes apply after payment

No new mechanism. Recording a settlement calls the existing, tested path:

```
record settlement
  → changeBusinessPlan(businessId, planCode,
                       { status: 'ACTIVE', currentPeriodEnd: periodEnd })
  → (add-ons: business_addons row ACTIVE)
```

Entitlements then resolve on the **next read** —
`getBusinessEntitlements` → `resolveEntitlements`. There is no cache to bust and
no deploy. Billing never writes `plan_entitlements` or `entitlement_overrides`.

**Anniversary (your preference).** `currentPeriodEnd` = activation date + 1
month, rolling. Already a plain field; no schema change.

**Grace change (your preference).** `SUBSCRIPTION_GRACE_DAYS` moves 7 → 10 in
`src/modules/billing/entitlements.ts`. This is the one existing-code edit Phase A
needs, and it affects: that constant, `subscriptionAccess` (reads it),
`entitlements.test.ts` (asserts on it), and any owner-facing copy stating a
number of days. Nothing else reads it.

**Retry schedule (day 0, 2, 5, 8).** Recorded in the spec as the Phase C design
and *not implemented in Phase A* — there is no card to retry. It fits inside 10
days with two days to spare, which is why 10 works.

## L. What happens when an EFT invoice is unpaid

| when | what | owner sees |
|---|---|---|
| due − 3d | reminder | friendly email: amount, reference, bank details |
| due | invoice `OPEN`, past due | email + dashboard banner |
| due + 3d | reminder | email |
| due + 7d | reminder | email, states the date access changes |
| due + 10d | grace ends → §N | email confirming the downgrade |

Plan stays fully active for the whole window. Tone per your preference —
friendly, specific, no threats. These are businesses with thin month-end cash
flow; the email states the amount, the reference, the bank details and the date,
and offers a reply.

## M. What happens during grace

- **The paid plan keeps working in full.** Already implemented and tested:
  `subscriptionAccess` returns state `GRACE` with `usesSubscribedPlan: true`.
- Status `PAST_DUE`, `graceEndsAt` set.
- Owner sees a banner with the amount and the date.
- **The storefront, orders, and merchant-direct card payments are untouched.**
  A merchant behind on their Skhokho invoice keeps trading and keeps getting
  paid by their own customers — their money is theirs, and we never hold it.
- Add-ons keep working.
- No data is touched.

## N. What happens after grace

- Subscription → `EXPIRED`. Invoice → `UNCOLLECTIBLE` (admin can still record a
  late settlement, which reactivates).
- Entitlements fall back to the **default plan (FREE)** — the resolver's
  existing, tested behaviour for every downgrade path.
- Paid add-ons → `SUSPENDED` (your preference: removable after grace). Suspended,
  not deleted, so reactivating is one row.
- **No destructive deletion of any merchant business or order data. Ever.**
  Products over the FREE limit are hidden from the storefront, never removed;
  staff over the limit lose dashboard access, their records stay; content drafts
  and campaigns stay and become read-only. Everything returns on payment.
- The storefront keeps trading on FREE. Merchant-direct card payments keep
  working — they are core product and are not gated by any plan.

*(Hiding over-limit products/staff requires the `max_*` enforcement that does
not exist today — §C. Until it is written, an expired business keeps whatever it
had. That is the honest current behaviour and should not be described to
customers as a limit.)*

## O. Confirmation: the two money flows are completely separate

**Confirmed, by construction, and unchanged by anything in Phase A.**

| | Customer → Merchant | Merchant → Skhokho Labs |
|---|---|---|
| Built | Yes, live | Phase A: records only |
| PayFast account | **The merchant's own** | SGDataInt's own (Phase B+) |
| Credentials | `loadCredentials(connectionId)` | `platformCredentials()` |
| Reference prefix | `skh_<32hex>` | `skhp_<32hex>` (reserved) |
| Tables | `Order`, `BusinessPaymentAttempt`, `BusinessPaymentConnection` | `platform_invoices`, `platform_invoice_lines`, `platform_settlements` |
| Notify route | `/api/payments/payfast/notify` | `/api/platform-billing/…` (Phase B+) |
| Who holds the money | the merchant, always | SGDataInt, for its own fees only |

Guarantees Phase A preserves:

1. **Customer order money continues to settle into each merchant's own PayFast
   account.** `resolveCheckoutPayment` offers card only on a `VERIFIED` + `LIVE`
   connection belonging to that business. There is no platform fallback and
   Phase A adds none.
2. **Phase A writes no merchant payment table** and calls no function in
   `src/lib/payfast.ts` or `src/modules/payments/`.
3. **Phase A touches the proven merchant checkout not at all** — the `skhp_`
   reservation is a new constant in new code, not an edit to the merchant path.
4. **Neither flow can affect the other.** A merchant `PAST_DUE` with Skhokho
   keeps trading and keeps being paid. A merchant whose own customers fail to pay
   them has their Skhokho plan untouched.
5. **Four money streams stay unmixed** — merchant GMV, Skhokho Labs subscription
   revenue, Skhokholetha settlement, driver earnings (§H).

---

## STOP

No code will be written until you provide:

1. **`GROW` and `PRO` monthly prices.**
2. **The VAT registration answer** and, if registered, inclusive-or-exclusive.

Decisions 3–8 in §E can follow during implementation, but 1 and 2 gate the
first invoice.
