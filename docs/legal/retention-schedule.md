# Retention schedule — every table that holds personal information

**DRAFT FOR ATTORNEY REVIEW.**

**Version:** v0.1-draft-2026-10-21 · **Status:** DRAFT FOR ATTORNEY REVIEW · **Owner:** the Information Officer · **Law:** POPIA section 14 (retention and restriction of records)

> Skhokho Laboratory ("Skhokho Labs") is the responsible party or operator for every table below (see the Privacy Notice, section 1). Table names are the real Postgres tables (`prisma/schema.prisma`, checked 2026-10-21). "Enforced" says whether the period is applied by code today. Where it says **manual** or **not yet**, the period is the rule we commit to and the purge job is engineering work listed in docs/legal-dependencies.md. **[ATTORNEY: …]** marks a period counsel must set or confirm against the Tax Administration Act, Companies Act, FICA, ECTA s43(?) and CPA record-keeping rules — the periods below are proposals, not statements of law.

Periods are counted from the event in the "From" column. "Operational period" means while the account, business, card or delivery is live.

---

## 1. Customers (identity core — written only through the SECURITY DEFINER RPCs)

| Table | Personal data | Period | From | Why | Enforced |
|---|---|---|---|---|---|
| `customers` | display name, language | Operational, then **3 years** after the last visit at any business **[ATTORNEY]** | last `memberships.last_seen` | one rewards identity per number; inactive identities removed | not yet (no purge job) |
| `customer_identifiers` | mobile number, email, WhatsApp id | Same as `customers` | same | matching the person to their card | not yet |
| `memberships` | card code, display name at that business, first/last seen | Operational, then **3 years** after last seen **[ATTORNEY]**; immediately on a deletion request | `last_seen` | the business's customer relationship | not yet |
| `visits` | visit kind, time, idempotency key (per membership) | **3 years** after the visit **[ATTORNEY]** | `created_at` | loyalty history; dispute evidence | not yet |
| `consents` | purpose, channel, granted / revoked times, source, evidence | **Revoked rows kept 5 years** after revocation **[ATTORNEY: proof of consent / opt-out]**; active rows while the membership exists | `revoked_at` | proving consent and withdrawal (POPIA s69) | never deleted (append / revoke only) |
| `reviews` | rating, comment, membership | Until the business or the customer removes it, or the membership is deleted | — | published content | manual |
| `audit_log` | actor, action, object, **IP address** (identity RPC audit) | **2 years** **[ATTORNEY]**; IP column to be hashed **[ENGINEERING]** | `created_at` | security and accountability | not yet |

## 2. Orders, bookings, payments

| Table | Personal data | Period | From | Why | Enforced |
|---|---|---|---|---|---|
| `orders` | membership link, notes, `metadata.notifyEmail` (email typed at checkout), terms version accepted | **5 years** after the order **[ATTORNEY: tax record period]**; `notifyEmail` cleared **90 days** after completion | `created_at` / completion | financial record; email only for that order's messages | not yet |
| `order_items`, `order_item_options` | none directly (items and options) | With the order | — | financial record | with order |
| `order_deliveries` | delivery address snapshot, instructions, contact phone, drop-off coordinates, driver position, customer key hash | Address, instructions, contact phone and coordinates cleared **90 days** after the delivery ends; the row (fee, status, times) kept with the order **[ATTORNEY]** | `delivered_at` / `failed_at` | the delivery needed them; the sale record does not | not yet |
| `appointments` | membership link, notes, terms version accepted | **3 years** after the appointment **[ATTORNEY]** | `start_time` | booking record; dispute evidence | not yet |
| `business_payment_attempts` | reference, amount, PayFast payment id, merchant id snapshot — **no card data, no customer name** | **5 years** **[ATTORNEY: tax / PayFast dispute window]** | `created_at` | payment reconciliation; chargeback evidence. **ON DELETE RESTRICT** on the order | kept |
| `business_payment_events` | provider status, amount, outcome | **5 years** | `received_at` | as above | kept |

## 3. Businesses, owners, staff

| Table | Personal data | Period | From | Why | Enforced |
|---|---|---|---|---|---|
| `app_users` | email, password hash, reset token, last login | Operational, then **1 year** after the last business or driver role ends **[ATTORNEY]**; reset tokens expire by TTL | account end | sign-in | tokens: yes; rows: not yet |
| `businesses` | business contact details, address, legal name, returns text, complaints contact (`settings.legal`), map pin | Operational, then **5 years** after closure **[ATTORNEY: Companies Act / tax]** for the business record; owner's personal contact fields cleared at closure + 1 year | closure | the trading record | not yet |
| `business_profiles` | onboarding answers, brief, template choice | Operational, then with the business | — | storefront generation | with business |
| `business_staff` | name, email, phone, avatar, password hash, reset token, job title, last login | Operational, then **1 year** after deactivation, then de-identify **[ATTORNEY]** | `is_active = false` | staff access; audit cross-reference | not yet |
| `business_staff_sessions` | session token hash, device info | Until expiry (7 days) + purge | `expires_at` | sign-in | expiry enforced; purge not yet |
| `business_roles` | none (role names and permissions) | With the business | — | — | — |
| `business_payment_connections` | PayFast merchant id, encrypted key and passphrase | Until retired, then **1 year** (retired rows keep merchant id only) **[ATTORNEY]** | `retired_at` | payment verification; dispute trail | not yet |
| `business_notifications`, `business_notification_reads` | order numbers, amounts, staff read marks | **1 year** | `created_at` | console inbox | not yet |
| `assistant_conversations`, `assistant_messages` | what the owner typed to the Business Buddy, answers | **1 year** after the last message **[ATTORNEY]** | `updated_at` | the owner's own history | **not yet — never purged today** |
| `buddy_actions` | proposed actions, params, preview | **90 days** after decision or expiry | `decided_at` / `expires_at` | approval trail | **not yet — never purged today** |
| `content_drafts`, `content_campaigns` | owner-written marketing text, staff ids | With the business | — | the owner's own content | with business |
| `ai_usage_events` | business, actor id, feature, token counts, outcome — **no prompts or answers** | **2 years** | `created_at` | metering and cost control | not yet |
| `storefront_revisions` | staff ids, storefront spec | With the business | — | design history | with business |
| `business_domains`, `business_slug_history` | hostnames, verification tokens | With the business; retired hostnames kept **1 year** to avoid reuse confusion | `revoked_at` | routing | not yet |
| `domain_registrations` | registrant name and email | **Life of the registration + 5 years** **[ATTORNEY: registrar / ZACR rules]**. **ON DELETE RESTRICT** | `expires_at` | registrar record | kept |
| `business_subscriptions`, `entitlement_overrides` | billing email | With the business + **5 years** (billing records) | — | billing | not yet |

## 4. Skhokholetha — drivers and deliveries

| Table | Personal data | Period | From | Why | Enforced |
|---|---|---|---|---|---|
| `driver_profiles` | name, phone, availability, **last coarse position** (latest only), payout bank details (account encrypted; last 4 shown), acceptance versions, review notes, suspension reason | Position: overwritten every ping and cleared when offline **[ENGINEERING: confirm clear-on-offline]**. Profile: operational, then **5 years** after deactivation **[ATTORNEY: earnings / tax record; contractor disputes]**, then de-identify. Bank details cleared **90 days** after the last payout | `suspended_at` / deactivation | dispatch, payouts, the contractor record | not yet |
| `driver_vehicles` | vehicle type, registration number, make/model | With the profile | — | eligibility | with profile |
| `driver_documents` | **ID document, driver's licence, vehicle registration — the file itself**, hash, review note | **[FOUNDER + ATTORNEY DECISION — the register says "kept indefinitely today"]** Proposal: rejected or withdrawn applications **90 days**; approved drivers — the document for the **life of the approval + 1 year**, then delete the bytes and keep only kind, status, review date and expiry date | `reviewed_at` / deactivation | identity verification of drivers; the bytes are the sensitive part | **not yet — no purge job** |
| `driver_legal_acceptances` | version accepted, URL, time, hashed IP, user agent | **5 years** after the driver's last activity **[ATTORNEY]**. Append-only; **ON DELETE RESTRICT** | `accepted_at` | proof of acceptance | kept |
| `network_deliveries` | pickup/drop-off coordinates, driver's latest position during the delivery, code nonces, tracking hash | Driver position cleared when the delivery ends (code); coordinates cleared **90 days** after the end; the delivery row (fees, times, status) kept **5 years** with the order **[ATTORNEY]** | `ended_at` | dispatch; earnings; disputes | position: yes; coordinates: not yet |
| `delivery_offers` | driver id, distance | **90 days** | `created_at` | dispatch fairness audit | not yet |
| `delivery_events` | actor ids, transition data | **2 years** | `created_at` | dispute evidence | not yet |
| `driver_ledger_entries`, `driver_payouts` | amounts, references, admin ids | **5 years** **[ATTORNEY: tax]**. **ON DELETE RESTRICT** | `created_at` | earnings and payout record | kept |

## 5. Platform administration and security

| Table | Personal data | Period | From | Why | Enforced |
|---|---|---|---|---|---|
| `platform_admins`, `admin_recovery_codes` | admin user link, encrypted MFA secret, recovery code hashes | With the admin account | — | admin sign-in | — |
| `platform_audit_events` | actor ids, business, reason, metadata (redacted), **hashed IP**, request id | **5 years** **[ATTORNEY: accountability record]** | `created_at` | accountability for admin and money actions | never deleted |
| `rate_limit_buckets` | IP-derived key and counts | **2 days** | `window_start` | abuse prevention | **yes** (`purgeRateLimitBuckets`) |
| `storefront_daily_stats` | **none** (counters by page/section/device/day) | **400 days** | `day` | storefront learning | **yes** (`purgeExpiredStorefrontStats`) |
| `storefront_pattern_candidates` | none | — | — | — | — |
| `job_runs` | none (job names, timings, error text — must stay free of personal data) | **90 days** | `started_at` | operations | not yet |
| `platform_enquiries` | name, phone, email, business name, message (marketing-site form) | **1 year** after handling **[ATTORNEY]** | `handled_at` | replying to the enquiry | not yet |

## 6. Outside the database

| Where | What | Period | Enforced |
|---|---|---|---|
| Vercel server logs | request logs; must not carry personal data (`src/lib/redact.ts`; known backlog: `src/lib/email.ts` logs the recipient address when email is unconfigured) | Vercel's log retention for the plan **[FILL IN]** | provider |
| Vercel Blob | logos and product photos (public URLs) | Until the owner replaces or removes them, or the business closes + 90 days | manual |
| Resend | sent-email records (recipient, subject) | Resend's retention **[FILL IN: check the account setting]** | provider |
| Email mailboxes (support, DSR) | correspondence | **[ATTORNEY]** | manual |
| Backups (Neon history / branches) | copies of everything above | Neon point-in-time history: **[FILL IN: 7 days configured per docs/plans/2026-10-21-workstreams.md]**; a deletion propagates when the history window passes | provider |

## 7. Review

The Information Officer reviews this schedule every **12 months** and whenever a new table holding personal information is added (a migration that adds one must update this file in the same pull request).

---

### Change log

| Version | Date | Change |
|---|---|---|
| v0.1-draft-2026-10-21 | 2026-10-21 | First complete schedule covering every table in the schema. Most periods are proposals pending counsel; only rate-limit and storefront-stat purges are enforced. |
