# Skhokho Customer Platform — Design Spec

**Date:** 2026-07-14 · **Status:** Approved by Chuma (plan-mode approval, this session)
**Research base:** `docs/research/2026-07-14-popia-legal-shared-customer-id.md`, `2026-07-14-identity-architecture-multi-tenant.md`, `2026-07-14-sa-market-landscape.md`

## 1. What we are building

Skhokho Labs shifts from "we build you a website" to a **platform**: businesses onboard, get their site, and register + track their customers. Each customer has:

- **One global Skhokho ID** — internal + customer-facing only. **Never exposed to any business.**
- **One per-business membership** with a pairwise public ID and a human short code (e.g. `KHU-4F7`) — the only identifier a business ever sees. Different at every shop, so businesses cannot correlate customers with each other.
- **Phone number as the lookup key** (never the primary key): stored as a verified identifier; a business sees the full number only if it collected it; masked everywhere else.

First target segment: **salons, barbers, taverns, takeaways** (repeat-visit informal businesses), WhatsApp-first, distributed through Skhokho's existing field-agent network. Customer capture flows: owner enters phone, customer self-registers on the business page, QR code, WhatsApp.

## 2. Legal gate (drives sequencing)

POPIA s57 requires **prior authorisation from the Information Regulator** before linking a unique identifier across multiple responsible parties (i.e., the cross-business layer). Per-business loyalty/CRM does **not** trigger it. Therefore:

- Build the per-business customer layer now; schema is cross-business-ready.
- The cross-business linking layer ships **dark behind a feature flag** and only turns on after the Regulator decides.
- Consent is per purpose, per channel, per business (`loyalty_program` / `marketing` / `cross_business_link`), append-only with evidence. Opt-out ≠ consent. STOP works on WhatsApp, free.

## 3. Data model (new tables, Supabase, RLS from day one)

```
customers            id uuid (v7) PK, display_name, language, merged_into uuid NULL, created_at
customer_identifiers id, customer_id FK, type (phone|email|wa_id), value (E.164 for phone),
                     verified_at NULL, source, is_primary
memberships          id, customer_id FK, business_id FK, public_id (pairwise, opaque),
                     short_code (Crockford base32 + check digit, unique per business),
                     display_name, first_seen, last_seen, status
visits               id, membership_id FK, business_id FK, kind (visit|stamp|redeem),
                     created_at  -- append-only ledger; balances derived
consents             id, customer_id FK, business_id FK NULL (NULL = platform scope),
                     purpose, channel, granted_at, revoked_at NULL, source, evidence
audit_log            id, actor_type, actor_id, business_id, action, object_type,
                     object_id, ip, created_at  -- append-only, trigger/RPC write path only
```

Existing `loyalty_stamps` (`business_id` + `customer_phone`) migrates into memberships + visits; `bookings.customer_phone` backfills memberships marked unverified (deferred to Phase 2). **No cross-business linking off unverified numbers, ever** — deterministic matching on OTP-verified identifiers only; ambiguous matches go to a candidate queue, never auto-merge; merges are soft (`merged_into` tombstone).

## 4. Access model

| Actor | Sees |
|---|---|
| Customer | Their own `customers` row, all their memberships/visits/consents (via API/WhatsApp; no direct PostgREST in v1) |
| Business | Only its `memberships` + a projection RPC of permitted customer fields (display name, masked-or-own-collected phone, short code). **No row access to `customers`.** |
| Platform (Hono API) | Everything, via service role server-side only; per-request tenant context; tenant always derived from the auth session, never from request body |

Security floor: RLS enabled + policies on every new table with pgTAP cross-tenant isolation tests in CI; opaque IDs everywhere (404 for other-tenant objects); phone-lookup endpoint authenticated, rate-limited, audit-logged; OTP over WhatsApp with per-number/IP caps, `+27` allow-list, lockout, send-to-verify alerting; numbers masked in every business-reachable UI and export.

## 5. Delivery phases

1. **Phase 1 — Identity & data foundation:** migrations above, E.164 util + short-code generator in `packages/shared`, types in `packages/shared/src/types.ts`, API skeleton (`apps/api/src/routes/customers.ts`), loyalty_stamps migration, tests. Acceptance: one customer, verified by phone, enrolled at two businesses; each business sees a different opaque ID and only its own data; platform sees the join; every lookup audited.
2. **Phase 2 — Business CRM:** dashboard Customers section (register / stamp / regulars / lapsed), WhatsApp owner commands ("register 0821234567", "stamp …", "how many regulars this month").
3. **Phase 3 — Customer-facing:** QR self-registration on `[slug]` sites → WhatsApp OTP → layered consent; "my stamps" / "my code" / STOP over WhatsApp; consent-checked broadcast path.
4. **Phase 4 — Cross-business (feature-flagged, gated on Regulator approval):** verified-phone auto-link with `cross_business_link` consent; customer's "all my shops, all my rewards" view; platform-internal analytics only.

**Parallel legal track (human + drafted docs):** POPIA attorney; s57 application (drafted from this spec); Information Officer registration + breach-portal credentials; merchant compliance templates (data-sharing agreement, consent wording, PAIA manual generator — also a product feature); NCC marketer registration + monthly opt-out-registry cleanse before any marketing sends; Supabase region → af-south-1; no raw PII to foreign AI APIs.

## 6. Non-goals

Payments/POS hardware; B2B stock ordering; consumer app; lending/credit (recording tick is future work; extending credit never — NCA); collecting SA ID numbers; exposing global IDs or cross-shop information to businesses; bundled single-checkbox consent; launching cross-business linking before the Regulator decides; probabilistic identity matching (v1 is deterministic only).

## 7. Verification

pgTAP RLS isolation tests per table; two-tenant IDOR API tests (expect 404); end-to-end two-shop enrolment test (pairwise IDs differ; cross-link only with consent + flag); OTP rate-limit tests; consent-required-before-send test; manual WhatsApp sandbox run of owner and customer flows.

## 8. Open items (Chuma)

POPIA attorney engagement + s57 filing; pricing for the salon/tavern tier; Supabase region migration; reward economics (who funds the free-product/airtime rewards).
