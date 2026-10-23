# Platform Billing — Design Spec (merchant → Skhokho)

**Date:** 2026-10-21 · **Status:** Draft, not approved. No code written.
**Scope:** How a business owner pays *Skhokho* for paid plans and add-on services.
**Not in scope:** How a customer pays a *merchant*. That is built and live — see
`src/modules/payments/`, `src/lib/payfast.ts`, `docs/merchant-operations.md`.

## 1. Why this document exists

The entitlement half of paid plans is built and tested. The collection half is
deliberately absent. Today the loop is manual: an owner enquires from the
showcase, SGDataInt quotes and invoices outside the platform, the owner pays by
EFT, and a platform admin runs `changeBusinessPlan`. Nothing in the product can
take money from a merchant.

This spec closes that, without disturbing merchant-direct settlement.

### What already exists (do not rebuild)

| Piece | Where | State |
|---|---|---|
| Feature catalogue (22 keys) | `src/modules/billing/features.ts` | Done |
| Entitlement resolver | `src/modules/billing/entitlements.ts` | Done, 219 lines of tests |
| Subscription lifecycle + grace | `entitlements.ts`, `SUBSCRIPTION_GRACE_DAYS = 7` | Done |
| `Plan` / `PlanEntitlement` / `EntitlementOverride` | `prisma/schema.prisma` | Done, seeded |
| Plan/person double gate | `src/lib/auth/entitlement-guards.ts` | Done |
| Admin plan change | `changeBusinessPlan`, platform-admin | Done |
| Showcase pricing + enquiry | `src/app/showcase/` | Done |
| SGDataInt's own PayFast seam | `platformCredentials()` in `src/lib/payfast.ts` | Stub, unused |
| Scheduled job host | `src/app/api/cron/daily/route.ts`, 03:00 daily | Done |

Three seeded plans: `FREE` (R0, default), `GROW` (`price_cents = NULL`),
`PRO` (`price_cents = NULL`). **The two NULLs are the real blocker** — see §10.

## 2. The invariant this spec exists to protect

Two money flows that must never share a write path:

```
Customer ──▶ Merchant's own PayFast account      (built: BusinessPaymentAttempt)
Merchant ──▶ SGDataInt's own PayFast account     (this spec: PlatformCharge)
```

Enforced by construction, not by convention:

1. **Separate tables.** Platform billing never writes `Order`,
   `BusinessPaymentConnection` or `BusinessPaymentAttempt`.
2. **Separate credentials.** Platform billing uses `platformCredentials()` only.
   Merchant checkout uses `loadCredentials(connectionId)` only. Neither function
   is reachable from the other's call path.
3. **Separate notify endpoint.** `/api/platform-billing/payfast/notify`, never
   the merchant route.
4. **Separate reference prefix.** Merchant attempts are `skh_<32hex>`; platform
   charges are `skhp_<32hex>`. Each notify route **rejects the other's prefix
   outright** before any lookup. Cheap, total, and greppable in logs.
5. **No coupling in either direction.** A merchant's own customers failing to
   pay them must never change their Skhokho plan. A merchant being `PAST_DUE`
   with Skhokho must never stop their customers paying them — their storefront
   and their settlement are theirs.

> Rationale: if platform billing reused `BusinessPaymentAttempt`, a bug in
> subscription collection could corrupt the record of who received a customer's
> money — which is the dispute and reconciliation record. And the two credential
> sets would travel one code path, where a single mix-up routes a customer's R45
> kota payment into SGDataInt's account.

**Point 5 has a corollary worth stating:** entitlements stay the *only* thing
that gates features. Billing never writes `plan_entitlements`; it only moves
`BusinessSubscription.status` and its dates. The resolver already fails closed
and already implements grace, so a billing outage cannot silently unlock or
revoke anything — it moves a date, and existing tested logic does the rest.

## 3. Collection mechanism

**Decision: tokenization, not scheduled subscriptions.**

PayFast offers both. Scheduled subscriptions have PayFast charge the card on a
frequency set at signup. Tokenization vaults the card in PayFast's PCI DSS
Level 1 database, returns a token, and lets us charge when we choose.

Tokenization wins because the pricing is add-on shaped — a plan plus optional
services at different monthly rates (`SERVICES` in `src/app/showcase/data.ts`:
R300–R1 500/month each, plus setup). A fixed-frequency subscription fights
mid-cycle upgrades, proration and add-ons. Controlling the charge also means
controlling the retry schedule, which has to line up with the grace period
that is already modelled and tested.

It also keeps card data out of Skhokho entirely: we hold a token, never a PAN,
which keeps our PCI scope at its current level. **No custom card form, ever.**

### Known API surface

From the official PHP SDK (`$api->subscriptions`): `fetch`, `pause`, `unpause`,
`cancel`, `update`, `adhoc(token, {amount, item_name})`. Endpoints take the form
`https://api.payfast.co.za/subscriptions/{token}/{action}`. Client is
constructed with `merchantId`, `passPhrase`, `testMode`. Recurring billing
requires the passphrase in the signature, and an optional IP whitelist can
restrict API callers.

### ⚠ Unverified — confirm before building

PayFast's developer docs are JS-rendered and could not be read directly. These
must be confirmed against `developers.payfast.co.za/api#recurring-billing`:

- The exact API request headers (`merchant-id`, `version`, `timestamp`,
  `signature`) and **how the API signature is computed** — it is not necessarily
  the same construction as the ITN/outbound form signature in `payfast.ts`.
  Assume nothing here; `signOutbound` and `signItnPayload` already differ from
  each other on empty-field handling.
- Whether `adhoc`'s `amount` is cents or rand. The SDK example passes `500`
  with no units given. **Getting this wrong is a 100× billing error.**
- `subscription_type`, `frequency`, `cycles` and `billing_date` semantics for
  the initial tokenization request. (A third-party package lists frequency
  `1`=daily … `3`=monthly … `6`=annually — third-party, unverified.)
- Whether an ad-hoc charge sends an ITN in addition to its synchronous
  response. §6 assumes it does and treats the ITN as authoritative; if it does
  not, §6 changes materially.

### A sandbox limitation to plan around

`createCardUpdateLink` fails in sandbox: *"Onsite is not available in Sandbox
mode."* So the card-update journey **cannot be tested in sandbox** and will
first execute against a live card. This is the same class of hazard as the
empty-ITN-fields bug documented in `payfast.ts` — a live-only path. Budget a
deliberate low-value live rehearsal for it (§9, Phase B exit).

## 4. Data model

New tables, all additive. Every FK `onDelete: Restrict` — these are financial
records and must never cascade away with a business row.

```
platform_payment_methods  id, business_id FK, provider (PAYFAST),
                          token_ciphertext, card_brand, last4,
                          expiry_month, expiry_year, status, created_at
                          -- status: ACTIVE | SUPERSEDED | INVALID
                          -- partial unique: one ACTIVE per business

platform_invoices         id, business_id FK, number unique, period_start,
                          period_end, plan_code_snapshot, subtotal_cents,
                          vat_cents, total_cents, currency (ZAR), status,
                          due_at, paid_at, created_at
                          -- status: DRAFT | OPEN | PAID | UNCOLLECTIBLE | VOID
                          -- partial unique: (business_id, period_start)
                          --                 where status <> 'VOID'

platform_invoice_lines    id, invoice_id FK, kind, description, quantity,
                          unit_cents, amount_cents
                          -- kind: PLAN | ADDON | SETUP | PRORATION | CREDIT

platform_charges          id, invoice_id FK, business_id FK,
                          reference unique (skhp_<32hex>), amount_cents,
                          attempt_number, status, provider_payment_id,
                          provider_status, failure_reason, created_at,
                          settled_at
                          -- status: CREATED | SUBMITTED | COMPLETE
                          --         | FAILED | EXPIRED
                          -- partial unique: one COMPLETE per invoice_id
                          -- partial unique: one per provider_payment_id

business_addons           id, business_id FK, service_slug, setup_cents,
                          monthly_cents, status, started_at, ended_at
                          -- service_slug matches SERVICES in showcase/data.ts
```

Deliberate mirrors of the merchant design, for the same reasons:

- **`token_ciphertext`, not `token`.** Encrypted with the existing
  `src/lib/crypto/secret-box.ts` (AES-256-GCM, versioned, rotatable). A vaulted
  card token is a bearer credential: whoever holds it plus SGDataInt's merchant
  credentials can charge that card.
- **A charge row per attempt, never reused.** Same reasoning as
  `BusinessPaymentAttempt`: one invoice may be attempted several times, and a
  per-invoice reference makes a late notification impossible to attribute.
- **Payment methods supersede, never overwrite.** A charge already in flight
  must stay resolvable against the method it was submitted under.
- **`plan_code_snapshot` and per-line amounts are copies, not joins.** An
  invoice is a historical record. Repricing a plan must never retroactively
  change what someone was billed.
- **One COMPLETE charge per invoice, in the database.** The only reliable
  double-charge guard.

`BusinessSubscription` gains nothing. Its deprecated pre-entitlement columns
(`maxStaff`, `hasAnalytics`, …) stay untouched and unread, to be dropped
separately.

## 5. Flows

### 5.1 Subscribe (owner adds a card and starts a paid plan)

1. Owner opens `/dashboard/settings/billing`, picks `GROW`, confirms the price.
2. We create a `DRAFT` invoice for the first period, then `OPEN` it.
3. Owner is handed to PayFast to authorise the card (tokenization request,
   auto-submitting form — reuse `AutoSubmitForm.tsx`, which already exists for
   exactly this reason: PayFast needs a real form POST, not a redirect).
4. PayFast vaults the card, returns a token, and notifies us.
5. On a verified notification: store the token encrypted, mark the charge
   `COMPLETE`, the invoice `PAID`, and call `changeBusinessPlan(businessId,
   'GROW', { status: 'ACTIVE', currentPeriodEnd: periodEnd })`.
6. Entitlements unlock on the owner's next page load. No cache to bust.

**Saving a card never grants a plan.** Only a settled charge does — the same
rule as `markConnectionVerified`, for the same reason.

### 5.2 Renew (automatic, daily)

A new task in `cron/daily`'s `TASKS` map (it already runs
`reconcileUnconfirmedAttempts`; the pattern and per-task `runJob` isolation are
in place):

```
for each ACTIVE subscription whose currentPeriodEnd is within 24h:
    if an invoice already exists for the next period: skip   (idempotent)
    create invoice (plan line + active addon lines)
    charge the ACTIVE payment method via adhoc
    on COMPLETE: extend currentPeriodEnd, status stays ACTIVE
    on FAILED:   status PAST_DUE, graceEndsAt = now + GRACE, schedule retries
```

Idempotency comes from the `(business_id, period_start)` partial unique index,
not from application logic. A cron that runs twice cannot double-bill.

### 5.3 Dunning (payment failed)

We control retries, so they must fit inside the grace the resolver already
honours. `SUBSCRIPTION_GRACE_DAYS = 7`, so:

| Day | Action | Owner sees |
|---|---|---|
| 0 | Charge fails → `PAST_DUE`, `graceEndsAt = +10d` | Email + dashboard notice |
| 2 | Retry | Reminder if it fails |
| 5 | Retry | Reminder if it fails |
| 8 | Final retry | "Last chance" notice |
| 10 | `EXPIRED`, invoice `UNCOLLECTIBLE` | Downgraded to FREE, data intact |

**This requires raising the default grace from 7 to 10 days**, or compressing
retries to 0/2/5 and finishing by day 6. Retries must finish *before* grace
ends, or the plan lapses while a retry could still succeed. Either change is
one constant in `entitlements.ts` plus its tests — decide explicitly, don't
let it fall out by accident.

Throughout grace, the paid plan **keeps working**. That is already implemented
and tested (`subscriptionAccess`, state `GRACE`).

### 5.4 Upgrade, downgrade, cancel

- **Upgrade mid-cycle:** prorate the remainder of the current period as a
  `PRORATION` line, charge immediately, move the plan on success.
- **Downgrade:** takes effect at `currentPeriodEnd`. Never refund by default,
  never mid-cycle. Access shrinks at the boundary; data is never deleted.
- **Cancel:** `status = CANCELLED`, `cancelledAt = now`, plan runs to
  `currentPeriodEnd`. Already implemented in `setSubscriptionStatus` and the
  resolver's `CANCELLED_PENDING` state.

### 5.5 Add-on services

The five showcase services (Website, WhatsApp ordering, AI voice agent, Content
dashboard, Speed to lead) carry setup fees of R1 500–R5 000. **These stay
sales-led and should not become self-serve.** Nobody should be able to click
into a R5 000 build commitment, and per `CLAUDE.md` the delivery work lives in
`ChumaMike/skhokho-labs`, not here.

What this spec adds for them: a `business_addons` row created by an admin after
the deal closes, so the recurring monthly portion is billed automatically
alongside the plan instead of being invoiced by hand every month. The setup fee
is a one-off `SETUP` line on the first invoice.

## 6. The notify endpoint

`/api/platform-billing/payfast/notify` — a separate route, mirroring the
verification discipline of the merchant route (`src/app/api/payments/payfast/
notify/route.ts`) because the same failure modes apply.

Order of checks, nothing written until all pass:

1. Reference present, and **prefixed `skhp_`** (reject `skh_` outright).
2. Resolve `skhp_…` → `platform_charges` row → invoice → business.
   Never resolve from the notification's own `merchant_id`.
3. `merchant_id` equals SGDataInt's own — a snapshot on the charge row, so a
   credential rotation can't retroactively invalidate in-flight charges.
4. Signature valid against `platformCredentials()`.
5. PayFast's own postback confirms it sent this (`validateWithPayfast`, already
   written and environment-parameterised). `UNAVAILABLE` ⇒ 503, not a pass and
   not a refusal.
6. Currency `ZAR`; `pf_payment_id` present.
7. Amount equals the invoice total exactly.

Then: settle idempotently (one `COMPLETE` per invoice, one per
`provider_payment_id`), extend the subscription, email the owner an invoice.

Response codes carry the same meanings as the merchant route — 200 verdict
reached, 503 postback unavailable, 500 our side broke before recording — so
PayFast's retry behaviour does the right thing.

**Amount mismatch is different here.** In the merchant flow a mismatched amount
becomes `REFUND_DUE` because a customer's money moved. Here *we* initiated the
charge for an amount we computed, so a mismatch is a bug in our own billing, not
a customer error. It must settle nothing, raise a `systemEvent`, and page a
human. Never extend a plan on an amount we did not ask for.

## 7. Owner-facing UI

`/dashboard/settings/billing`, gated on `canManageBilling`.

That permission is granted by **no role preset** (`src/types/index.ts:141` is
the owner-only grant; `workspace-nav.test.ts:193` pins this), so in practice
only the business owner reaches it. Correct: staff should not see or change
what the business pays Skhokho.

Shows: current plan and what it includes; next charge date and amount; card
brand + last 4 only; invoice history with downloadable invoices; change plan;
cancel. During `GRACE`, a clear banner with what fails and when.

Never shows: the token, a full card number, or SGDataInt's merchant credentials.

Follows the pattern already set by `/dashboard/settings/payments`: if
`PAYMENT_ENCRYPTION_KEY` is absent, show a plain banner and hide the forms —
never leak an env var name or a shell command to an owner.

## 8. Admin-facing

Extends `src/app/platform-admin/(console)/`, which already has per-business plan
changes and an `EntitlementOverride` editor:

- Invoice list and detail, per business and global.
- Failed-charge queue with manual retry and write-off (`UNCOLLECTIBLE`).
- Mark an invoice paid by EFT — the Phase A path, and the permanent fallback
  for owners who will never put a card on file. This matters: a meaningful
  share of SA small businesses pay by EFT on an invoice and will not tokenize
  a card. **EFT must stay a first-class path, not a workaround.**
- Every state change recorded via `recordAudit` with the acting admin.

## 9. Phasing

Each phase ships independently and is useful alone.

**Phase A — records and invoicing. No PayFast at all.**
Tables, invoice generation, admin UI, owner-visible invoice history, EFT
marking. Replaces the current manual process immediately and carries zero
payment risk. *Exit: an owner can see a real invoice; an admin can mark it paid
and the plan moves.*

**Phase B — card on file.**
SGDataInt's own PayFast account configured (`PAYFAST_MERCHANT_ID` / `_KEY` /
`_PASSPHRASE`). Tokenization flow, encrypted token storage, notify route, and
one admin-triggered charge. *Exit: a R5 live charge against a real card
settles, and the card-update link is rehearsed live (it cannot be tested in
sandbox — §3).*

**Phase C — automated renewal and dunning.**
The `cron/daily` task, retry schedule, grace alignment decision, owner emails.
*Exit: a renewal and a full failure-to-downgrade cycle both observed end to end
against a test business.*

**Phase D — self-serve plan change.**
Owner-driven upgrade with proration, downgrade at period end, cancel.

**Phase E — add-ons billed automatically.**
`business_addons` rows on invoices. Still sold by enquiry.

Phase A is worth doing even if B–E never ship.

## 10. Decisions needed before any of this is built

These are commercial, not technical, and Phase A is blocked on the first one.

1. **Set `price_cents` for `GROW` and `PRO`.** Both are `NULL`, so the showcase
   renders "Pricing coming soon" and there is nothing to collect. The NULL is
   deliberate — "prices are a commercial decision kept in data" — and changing
   it is one `UPDATE` per plan, no deploy.
2. **VAT.** Is SGDataInt VAT-registered? If so, are the showcase prices
   inclusive or exclusive? The model carries `vat_cents` so either works, but
   invoices must state it correctly from the first one issued. Recommend
   VAT-inclusive display (SA consumer convention) with `vat_cents` derived at
   15/115 — confirm with the accountant, not with me.
3. **Billing anniversary:** per-business signup date, or a common month-end?
   Month-end is simpler to reconcile; signup-date is fairer and avoids
   first-month proration entirely. Recommend signup-date.
4. **Grace vs retry window** (§5.3): raise `SUBSCRIPTION_GRACE_DAYS` to 10, or
   compress retries. Pick one deliberately.
5. **Dunning tone.** These are small businesses, often with thin cash flow at
   month-end. Warm, plain, specific — and the storefront must keep trading
   throughout. A merchant whose Skhokho plan lapses still has customers.

## 11. What must not change

- Merchant-direct settlement. No platform fallback for customer payments, ever.
- `platformCredentials()` stays unreachable from merchant checkout.
- Entitlements remain the only feature gate.
- A downgrade never deletes business data.
- No custom card form; card data never touches Skhokho.
- Credentials and tokens never appear in a log, an email, an error message or a
  server action's return value.

## 12. Open risk

Skhokho stores merchant PayFast credentials and (under this spec) vaulted card
tokens, while also being a payment-adjacent platform. The commercial terms with
PayFast for a platform that holds merchant credentials on their behalf are still
unconfirmed — flagged previously and still outstanding. Worth resolving before
Phase B, independently of the code.
