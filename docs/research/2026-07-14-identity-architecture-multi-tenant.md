# Architecture Research Report: Shared Customer Identity Graph + Multi-Tenant Loyalty/CRM on Supabase

Context: a platform where many small SA businesses share one central customer database. Each customer has one global "Skhokho ID" plus a per-business relationship. Stack: Next.js 15, Hono API, Supabase (Postgres + RLS), Turbo monorepo. Regulatory frame: POPIA.

---

## 1. Identity modelling

### 1.1 The core pattern: global person + per-tenant membership

The industry-standard shape (CDP / "Customer 360" world calls this the golden record + identity graph) is three layers, not two:

```
customers            -- the global person ("Skhokho ID"). Minimal PII.
customer_identifiers -- identity graph edges: phone, email, WhatsApp wa_id,
                        each with verified_at, source, is_primary
memberships          -- the per-business relationship (customer_id, business_id,
                        pairwise public_id, short_code, loyalty balance,
                        per-business consent flags, first_seen/last_seen,
                        business-local notes/tags)
```

Key design points, drawn from how CDPs do identity resolution ([CDP.com on golden records](https://cdp.com/glossary/golden-record/), [entity resolution](https://cdp.com/glossary/entity-resolution/), [Hightouch on why identity resolution is hard](https://hightouch.com/blog/identity-resolution-why-cdps-fall-short)):

- **Separate identifiers from the person.** A phone number is *evidence of* an identity, not the identity. Put phone/email in `customer_identifiers` with `verified_at` timestamps so a person can change numbers, hold two numbers, or lose a number without losing their Skhokho ID and history.
- **Deterministic matching only, at v1.** When shop B registers `+27 82 xxx`, look for a customer with a *verified* matching identifier; if found, create a new `membership` linking to the existing customer. Probabilistic matching (name + fuzzy similarity) is where CDPs generate bad merges — industry data shows 30%+ duplicate rates in typical CRM databases and merges that "restore themselves" if entry-point data quality isn't fixed. Skip probabilistic entirely for v1.
- **Merging duplicates: soft-merge with survivorship and an audit trail.** When you discover two `customers` rows are the same person (e.g., they verify an old number on a new account):
  - Keep both rows; add `merged_into uuid` on the loser and repoint memberships/identifiers in one transaction.
  - Never hard-delete the loser row — you need the tombstone so old references resolve, and so a bad merge can be *unmerged* (record what was moved in a `merge_events` table). Unmergeable merges are the classic CDP failure mode.
  - Survivorship rule: most-recently-verified identifier wins; earliest `created_at` row is the survivor.
- **Critical rule: only merge on *verified* identifiers.** Shop staff typing a phone number is not verification. If two shops typed the same number for what they believe are two people, that's a *candidate* link (queue it), not an automatic merge — otherwise one typo cross-contaminates two strangers' purchase histories across businesses, which is both a data bug and a POPIA breach.

### 1.2 Phone number as the natural key in emerging markets

Right instinct for SA (it's what Square Loyalty, M-Pesa, and every spaza-adjacent product uses), but treat it as a *login/lookup* key, never a *primary* key.

**Pros**
- Universal, memorable, already how SA small businesses know their customers; WhatsApp identity is phone-based, so it aligns with the WhatsApp stack.
- Enables frictionless enrolment at point of sale ("what's your number?") — exactly Square Loyalty's model.

**Cons / pitfalls**
- **Number recycling.** ~35M numbers/year recycled in the US alone; a Princeton study found 215 of 259 sampled recycled numbers were vulnerable to account hijack via recovery flows ([Princeton recycled numbers study](https://recyclednumbers.cs.princeton.edu/), [Telesign](https://www.telesign.com/blog/number-deactivation-and-the-recycled-phone-number-dilemma), [IDlayr](https://idlayr.com/blog/the-huge-issue-with-mobile-based-identity-login-recycled-numbers/)). SA prepaid churn makes this worse: MNOs recycle inactive prepaid numbers aggressively. Mitigations: store `verified_at` per identifier; re-verify on sensitive actions if the number hasn't been seen in N months; when a "known" number returns after long dormancy with mismatching name, treat as possibly-new-person and fork rather than attach.
- **Shared phones.** Households sharing one handset/SIM are common; one number may be two loyal customers of the same shop. Model: allow a number to be attached to multiple customers with only one `is_primary/verified` holder at a time, and let a business's membership carry a display name. Don't build full household modelling in v1 — just don't make the schema forbid it.
- **SIM swap / OTP hijack.** SMS OTP proves control of the number *now*, not identity — see M-Pesa's long fight with SIM-swap fraud ([Rest of World on M-Pesa SIM swap fraud](https://restofworld.org/2023/mpesa-sim-swap-fraud/)). Fine for loyalty points; not sufficient alone if you ever attach money/vouchers.
- **Numbers are PII and semi-public.** M-Pesa exposing sender phone numbers in every transaction became a fraud vector serious enough that the Central Bank of Kenya approved masking them in 2026 ([TechCabal](https://techcabal.com/2026/03/02/m-pesa-simple-fix-stop-scams/)). Lesson: never display full numbers to businesses beyond what they entered themselves; Square shows subsequent sellers only the last 4 digits ([Square buyer privacy notice](https://squareup.com/us/en/legal/general/buyer-features)).
- Normalise to E.164 (`+27...`) at every ingress point, once, in one shared library (`packages/shared`).

### 1.3 ID format

Three different IDs for three different jobs — do not try to make one ID do all three:

| ID | Format | Purpose |
|---|---|---|
| Internal PK (`customers.id`, `memberships.id`) | **UUIDv7** | Joins, FKs. Time-ordered so B-tree insert performance approaches serial, unlike UUIDv4 ([SayBackend benchmark](https://saybackend.com/blog/uuidv7-postgres-comparison/), [Honeybadger on UUID/ULID](https://www.honeybadger.io/blog/uuids-and-ulids/)) |
| API-exposed ID | The UUID (or a prefixed form like `cus_01H...`) | Opaque, non-enumerable. Never sequential ints — sequential IDs are the classic IDOR enabler and leak business volume |
| Human short code (per membership, per business) | 6–8 chars, e.g. `KHU-4F7`, from an unambiguous alphabet (Crockford base32: no I/L/O/U/0/1 confusion), optionally with a check character | What a customer reads out in a shop or shows on a lock screen. Scoped per business so it doubles as the pairwise ID (see §3) |

Notes: a short code read aloud in a noisy spaza must survive mishearing — unambiguous alphabet plus a check digit (Luhn mod N or Damm) rejects most typos. But expect the *phone number* to be the primary in-shop lookup and the code a fallback. One caveat on UUIDv7 for *exposed* IDs: they embed a timestamp (signup time leaks); if that bothers you, expose a separate random public ID.

---

## 2. Multi-tenancy in Postgres/Supabase

### 2.1 Shared schema + tenant_id + RLS — clearly correct here

Every recent comparison lands the same way: shared schema with `business_id` on every tenant-scoped row and RLS enforcing isolation is the default; schema-per-tenant is for a handful of high-value regulated tenants, which is the opposite of this shape (thousands of tiny tenants) ([PlanetScale on Postgres tenancy](https://planetscale.com/blog/approaches-to-tenancy-in-postgres), [AWS RLS multi-tenant pattern](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/)). Schema-per-tenant with thousands of spaza shops = catalog bloat, N-times migrations, connection/search_path pain, and no cross-tenant identity graph — which is the whole product. **Also decisive: the central `customers` table is inherently cross-tenant, so per-tenant isolation at the schema level is architecturally impossible for the identity graph anyway.**

### 2.2 The three-audience access model

"Platform sees all, business sees only theirs, customer sees only themselves" maps cleanly onto Supabase:

- **Customer (Supabase Auth, anon key + JWT):** RLS policies mapped to `auth.uid()`; customer reads their own `customers` row and their own `memberships`. If customers authenticate by OTP without a full Supabase Auth account, route them through the Hono API instead and don't give them direct PostgREST access at all.
- **Business (staff users):** a `business_users(user_id, business_id, role)` table; RLS policy on every tenant table: `business_id IN (select business_id from business_users where user_id = (select auth.uid()))`. Crucially, businesses should **not** get row access to the global `customers` table at all — only to `memberships` plus a *view/RPC* that projects the permitted slice of customer data (display name, masked phone). This is where the privacy model (§3) is enforced structurally rather than by discipline.
- **Platform:** `service_role` key, used **only** from the Hono API (server-side), never shipped to the browser. Prefer routing even admin dashboards through the API rather than handing service-role to any frontend.

Since the Hono API is the main data path, adopt the AWS pattern for API-side access: a *non-superuser, non-`bypassrls`* role plus `SET LOCAL app.current_business_id = ...` per transaction, with policies reading `current_setting('app.current_business_id')` ([AWS blog](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/)). That gives defense in depth: even if a Hono handler forgets a WHERE clause, the DB refuses cross-tenant rows. Do not run app queries as `service_role` "because it's easier" — that turns every handler bug into a cross-tenant leak.

### 2.3 RLS pitfalls to engineer around

From Supabase docs and production write-ups ([Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security), [Makerkit RLS best practices](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices), [designrevision guide](https://designrevision.com/blog/supabase-row-level-security)):

- **A table without RLS enabled is fully exposed** via PostgREST with the anon key. Add a CI check / pgTAP test asserting `relrowsecurity = true` on every table in `public`.
- **Views and SECURITY DEFINER functions bypass RLS by default.** Use `security_invoker = true` on views (Postgres 15+); audit every `SECURITY DEFINER` function — they're the controlled escape hatches (e.g., the "look up customer by phone" RPC) and each one needs its own internal authorization checks.
- **Never authorize from `raw_user_meta_data`** — users can edit it. Use `app_metadata` or a DB table.
- **Performance:** policies are implicit WHERE clauses. Index `business_id` (and every column policies filter on), wrap `auth.uid()` in `(select auth.uid())` so it's evaluated once per statement not per row, and prefer policies that check a cached claim over per-row subqueries. Unindexed/complex policies cause 2–11x slowdowns.
- **RLS applies per table in joins** — a join to a policy-protected table silently drops rows; design policies knowing this.
- **`WITH CHECK` can't see the old row** — use column-level grants or triggers to stop clients rewriting `business_id`/`customer_id` on update.
- **Storage and Realtime have their own policies** — a leak there is as bad as a table leak.
- **Test isolation explicitly:** pgTAP tests that set the JWT claims of business A and assert zero rows of business B, for every table ([OWASP Multi-Tenant Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)).

---

## 3. Privacy-preserving design

This is the section that makes or breaks the "platform tracks which businesses a customer visits" product, both ethically and under POPIA.

### 3.1 Pairwise per-business identifiers

Adopt the OIDC pairwise-subject pattern ([OIDC Core §8](https://openid.net/specs/openid-connect-core-1_0.html), [Connect2id pairwise guide](https://connect2id.com/products/server/docs/guides/pairwise-subject-identifiers)): each business sees a *different, stable* identifier for the same person, so two businesses comparing exports cannot join their customer lists on platform IDs. Implementation is trivial in this model: the `memberships.id` (or its short code) **is** the pairwise identifier — never expose `customers.id` (the Skhokho ID) to any business through API, export, webhook, or URL. The global ID lives only in the platform tier and in the customer's own app.

The Connect2id guide's caveat is the important part: **pairwise IDs are pointless if you hand businesses the linking attribute anyway.** Phone number is the linking attribute. So:

- A business sees the full number only if *they* collected it (Square's exact rule — subsequent sellers see `–0190` masking). In practice, since enrolment at a shop usually involves the customer giving their number, most businesses will legitimately hold it — but exports and cross-promotions should still use pairwise IDs and masked numbers wherever possible.
- Never expose "this customer also shops at X" or aggregate cross-business stats at any granularity that identifies businesses or customers to each other. Cross-business insight is a *platform* asset (and a customer-facing one: "your points across shops"), not a tenant-facing one.

### 3.2 Data minimisation

- The global `customers` row holds the minimum: name, verified identifiers, language pref. Everything business-specific (notes, tags, purchase history, points) lives in the membership, owned by that tenant.
- Businesses' free-text notes are theirs; don't surface them cross-tenant, ever.
- Retention: define it now (POPIA purpose limitation). E.g., membership data deleted/anonymised N months after a business churns; identifier dormancy handling per §1.2.

### 3.3 Consent per purpose

POPIA is opt-in for unsolicited electronic marketing (s69) with a narrow existing-customer exception; the 2024 Information Regulator Guidance Note tightened this further ([Global Policy Watch summary](https://www.globalpolicywatch.com/2024/12/long-awaited-popia-guidance-on-direct-marketing-published-by-south-africas-information-regulator/), [DLA Piper](https://www.dlapiperafrica.com/en/south-africa/insights/2025/Data-Protection-Guidance-Note-on-Direct-Marketing)). Design:

```
consents(customer_id, business_id NULLABLE, purpose, channel,
         granted_at, revoked_at, source, evidence)
```

- Purposes at minimum: `loyalty_program`, `marketing`, `cross_business_insights` (platform-level), each per channel (`whatsapp`, `sms`, `email`). `business_id NULL` = platform-scope consent.
- Consent is per-business by default (Square works the same way). Enrolment at Shop A is not consent for Shop B to message the customer.
- Append-only: revocation is a new row/`revoked_at`, keeping evidence of when and how consent was given — the Regulator expects you to be able to prove it. India's Account Aggregator framework is the best large-scale reference for machine-readable per-purpose consent artefacts and its known weakness — users don't actually read consent screens — argues for very short, plain-language WhatsApp-style consent prompts ([Dvara Research](https://dvararesearch.com/designing-effective-consent-artefacts-under-the-account-aggregator-framework/), [HyperVerge](https://hyperverge.co/blog/account-aggregator-framework-rbi/)).
- Every outbound-marketing send path must check the consent table at send time, not at campaign creation time.

### 3.4 Audit logging

- Append-only `audit_log(actor_type, actor_id, business_id, action, object_type, object_id, ip, created_at)` for: PII reads via lookup endpoints, exports, merges/unmerges, consent changes, staff access to customer profiles.
- Writable only by the API role via a SECURITY DEFINER function or trigger; no UPDATE/DELETE grants to anyone.
- This is also the POPIA s24 (data subject access) and breach-notification (s22) evidence, and merge-dispute forensics.

---

## 4. What comparable platforms did

**Square Loyalty / Customer Directory** — the closest analogue and largely the model to copy. Phone number is the loyalty identifier, enrolment happens at POS in seconds, and Square maintains one buyer identity across sellers while each seller has their own directory entry. What worked: near-zero enrolment friction; per-seller opt-in for marketing; masking contact info from sellers who didn't collect it ([Square directory help](https://squareup.com/help/us/en/article/6217-get-started-with-your-customer-directory), [buyer privacy notice](https://squareup.com/us/en/legal/general/buyer-features), [Loyalty API model](https://developer.squareup.com/docs/loyalty-api/loyalty-accounts) — note their API shape: a `loyalty_account` per program that *references* a global `customer`, i.e. exactly the membership pattern). What drew criticism: sellers feel they don't "own" their customer relationship, and automatic profile creation from receipts caused confusion about who consented to what — clarity about data ownership per tenant is a product feature, not just legal text.

**Shopify customer accounts** — moved from per-store password accounts to passwordless email OTP plus Shop (a cross-store identity via Shop Pay/OIDC). What worked: OTP-only login massively reduced friction; a platform-level identity (Shop) layered *optionally* over per-store relationships. Lesson: cross-store identity was retrofitted painfully over legacy per-store accounts — you get to build it native from day one ([Shopify docs](https://help.shopify.com/en/manual/customers/customer-accounts/new-customer-accounts/customer-experience), [Auth0 x Shopify](https://auth0.com/blog/shopify-auth0-a-new-era-for-retail-customer-identity/)).

**wiGroup (SA)** — built wiCode, a token-at-POS layer connecting issuers (loyalty, vouchers, mobile money) to 55,000+ POS lanes across Shoprite, Pick n Pay etc. What worked: being the *interoperability rail* with deep POS integration. What went wrong: a financial-mismanagement crisis in 2019 nearly killed it, and the Yoyo merger diluted the SA focus ([TechCentral](https://techcentral.co.za/wigroup-hit-by-financial-mismanagement-crisis/200579/), [Finextra](https://www.finextra.com/pressarticle/84505/yoyo-to-create-global-loyalty-brand-following-merger-with-south-africas-wigroup)). Architectural lesson: enterprise POS integration is heavy — their moat was integration depth, but it also made them dependent on a few big retail contracts. The spaza/SMME segment inverts that: many tiny tenants, so onboarding cost per tenant must be near zero (WhatsApp-first, no POS hardware).

**India's Account Aggregator** — proof that consent-artefact-based, "data-blind intermediary" architecture works at national scale, and that its weakest link is consent comprehension, not technology. Takeaways: standardised consent records with expiry; friction reduction is the selling point of shared identity.

**M-Pesa** — the canonical phone-number-as-identity ecosystem. What worked: the phone number as universal ID drove adoption in exactly this demographic. What failed: SIM-swap and social-engineering fraud at scale, agent-level KYC fraud, and phone-number exposure in transaction messages becoming a targeting vector — fixed only in 2026 by masking numbers. Lessons: phone = identity works, but plan for SIM-swap from day one on anything of value, and mask numbers everywhere by default.

---

## 5. Security essentials

- **Tenant-scoped credentials.** Business staff authenticate as users with a `business_id` binding in the DB (`business_users`), not via shared per-business API keys. If you later expose a partner API, issue per-business keys that are hashed at rest, prefixed (`sk_biz_...`), scoped to one `business_id`, and revocable — and resolve the tenant from the *key*, never from a client-supplied header or body param ([OWASP Multi-Tenant Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)).
- **BOLA/IDOR:** the #1 API risk (OWASP API1). Every Hono handler that takes an object ID must verify the object belongs to the caller's tenant — and RLS via `SET LOCAL app.current_business_id` makes the DB enforce it even when a handler forgets ([StackHawk on BOLA](https://www.stackhawk.com/blog/understanding-and-protecting-against-api1-broken-object-level-authorization/)). Use opaque UUIDs, return 404 (not 403) for other-tenant objects, and write automated two-tenant cross-access tests.
- **Phone/customer enumeration.** The "look up customer by phone" endpoint is the most sensitive surface. Require an authenticated business session; rate-limit per business and per staff user; return an enrolment-invitation flow (not a bare "not found" vs "found" distinction) where possible; audit-log every lookup.
- **OTP hardening.** 6-digit OTP over WhatsApp (cheaper and more phishing-resistant in SA than SMS) with: max 3–5 sends per number per hour, per-IP and per-device caps, exponential backoff, 5-attempt verify lockout, short expiry, constant-time compare. Guard the *send* endpoint against SMS pumping — mitigations: per-number/per-IP caps, `+27` country allow-listing, disposable/VoIP number detection, alerting on send-to-verify ratio collapse ([Sardine on SMS pumping](https://www.sardine.ai/blog/sms-pumping), [Prelude OTP fraud 2026](https://prelude.so/blog/secure-otp)).
- **PII at rest.** Supabase is encrypted at rest by default. Do **not** use pgsodium/Transparent Column Encryption — Supabase deprecated it as misconfiguration-prone ([Supabase pgsodium deprecation](https://supabase.com/docs/guides/database/extensions/pgsodium)). If you want defense beyond disk encryption for identifiers, do application-level encryption in the Hono layer for a *small* set of fields — store `phone_e164_encrypted` + `phone_hash` (HMAC with a server-side pepper, not plain SHA-256 — phone number space is tiny and trivially brute-forced without a secret key) for exact-match lookup. Keep secrets in Supabase Vault or env vars. For v1 the bigger wins are RLS correctness, masking in every UI/export, and audit logging.
- **General:** service-role key never leaves the server; webhooks signed; logs scrubbed of full phone numbers; alert on anomalous cross-tenant access attempts and bulk-read patterns (one staff account reading 500 profiles in an hour).

---

## 6. Avoid this / do this instead

| Avoid | Do instead | Why |
|---|---|---|
| Phone number as primary key / FK | UUIDv7 PK; phone as verified identifier row | Numbers recycle, change, and are shared; PK churn corrupts history |
| One `customers` table with a `business_id` column (customer duplicated per shop) | Global `customers` + per-business `memberships` | The whole product is the cross-business graph; dedup later is 10x harder than modelling it now |
| Auto-merging on unverified phone match | Merge only on OTP-verified identifiers; queue the rest for review | A typo at one shop must not leak another person's history across businesses |
| Hard-delete on merge | Soft-merge with `merged_into` tombstone + merge event log | Bad merges happen; you need unmerge and audit evidence |
| Exposing the global Skhokho ID to businesses | Pairwise membership ID / short code per business | Prevents cross-tenant correlation (OIDC pairwise pattern); the global ID is the crown jewel |
| Sequential customer numbers in APIs/URLs | Opaque UUIDs + unambiguous short codes with check digit | Sequential IDs enable enumeration/IDOR and leak volume |
| Schema-per-tenant | Shared schema + `business_id` + RLS | Thousands of tiny tenants + a cross-tenant identity graph make per-tenant schemas both painful and impossible for the core tables |
| Running app queries as `service_role` | Dedicated non-bypassrls API role + `SET LOCAL` tenant context; service_role only for true admin jobs | RLS as a safety net only works if you don't bypass it on the hot path |
| RLS policies referencing `raw_user_meta_data` or per-row `auth.uid()` calls | `app_metadata`/join tables; `(select auth.uid())`; index every policy column | User-editable claims = privilege escalation; unoptimised policies = 2–11x slowdowns |
| One global "I agree" consent checkbox | Per-purpose, per-channel, per-business consent rows with evidence and revocation | POPIA s69 requires specified purpose/channel; you must prove consent |
| Showing businesses full contact details platform-wide | Business sees only what it collected; mask elsewhere (last-4) | Square's model; M-Pesa's number exposure became a fraud vector |
| "Customer not found" vs "found" on unauthenticated/loose lookup endpoints | Authenticated, rate-limited, audited lookup; uniform responses | Phone enumeration is the top abuse vector for this design |
| Unlimited OTP sends | Per-number/IP/device caps, `+27` allow-list, verify-ratio alerting | SMS pumping fraud can burn thousands before you notice |
| pgsodium/TCE column encryption | Default encryption at rest + (if needed) app-layer encryption with peppered HMAC lookup hash; Vault for secrets | pgsodium is deprecated by Supabase as misconfiguration-prone |
| Trusting `business_id` from request body/header | Derive tenant from the authenticated session/key server-side | Classic BOLA: client-supplied tenant IDs are attacker-supplied |
| Probabilistic identity matching in v1 | Deterministic (verified phone) only | Probabilistic merges are where CDPs create unfixable data corruption |

---

## 7. Scope: a sensible v1 slice

**v1 (build now):**
1. Tables: `customers`, `customer_identifiers`, `businesses`, `business_users`, `memberships` (with pairwise short code), `consents`, `audit_log`, plus one loyalty primitive (points or visit-stamps ledger — append-only ledger, balance derived). All with RLS from day one; pgTAP cross-tenant isolation tests in CI.
2. Flows: enrol customer at a business by phone (WhatsApp OTP verify); deterministic auto-link when a verified number enrols at a second business; business dashboard of *their* members only; customer view ("my shops, my points") via WhatsApp or a lightweight portal.
3. Security floor: opaque IDs, tenant-context RLS on the API path, OTP rate limits + `+27` allow-list, masked numbers in UI/exports, audit-logged lookups.
4. POPIA floor: per-business marketing consent at enrolment, plain-language, revocable via "STOP"; consent check on every send.

**Defer (v2+), with the schema leaving room:**
- Merge/unmerge admin tooling and a candidate-duplicate queue (v1: log candidates, handle manually; the `merged_into` column exists from day one).
- Probabilistic matching, household/shared-phone modelling.
- Cross-business insights products (for customers first — "your points everywhere" — before any business-facing aggregate analytics, which need careful anonymisation).
- Partner/public API with per-business keys; webhooks.
- Application-level PII encryption; anomaly detection on access patterns.
- Cross-business promotions/coalition loyalty — commercially attractive, but it multiplies the consent and correlation problems; only after the pairwise-ID and consent machinery is proven.
- Number-dormancy/recycling automation (re-verification campaigns); v1 just records `verified_at` so v2 can act on it.

The v1 test: *one customer, verified by one phone number, enrolled at two shops, each shop seeing a different opaque ID and only its own relationship, the platform seeing the join, every lookup audited, every marketing message consent-checked.* That single vertical slice exercises every architectural decision above; everything else is layering.
