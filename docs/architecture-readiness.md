# Architecture map and future readiness

Naming: the legal entity is **Skhokho Laboratory** ("Skhokho Labs"); the
software product is **Skhokho**; the delivery capability is
**Skhokholetha**; the internal administration system is the **Skhokho Labs
Control Centre** (`/platform-admin`). Legal copy never identifies the
company as just "Skhokho".

## 1. Current architecture map

```
Skhokho Labs
|
+-- Skhokho platform (one Next.js 15 app, one Neon Postgres, Prisma 6)
|   +-- businesses      modules/tenant: Business + settings JSON (capabilities, fulfilment,
|   |                   delivery, ordering, payment), operating hours, slug, status lifecycle
|   +-- staff           modules/staff: BusinessStaff + presets (MANAGER, COUNTER, KITCHEN, DRIVER…),
|   |                   StaffPermissions checked server-side on every action
|   +-- storefronts     modules/tenant/storefront-*, modules/storefront-spec, modules/domains:
|   |                   spec-driven renderer, themes, revisions (AI drafts never auto-publish),
|   |                   /store/<slug>, <slug>.<STOREFRONT_DOMAIN>, verified custom domains
|   +-- catalogue       modules/catalog, modules/inventory: products, categories, option groups,
|   |                   services, stock
|   +-- orders          modules/orders: cart quote → order (fee from server-side quote only),
|   |                   status machine PENDING→CONFIRMED→PROCESSING→READY→COMPLETED/CANCELLED,
|   |                   kitchen view, own-driver OrderDelivery, customer notifications
|   +-- payments        modules/payments: merchant-direct PayFast (encrypted credentials,
|   |                   VERIFIED LIVE connection), attempts + append-only provider events,
|   |                   idempotent settlement, REFUND_DUE, daily reconciliation
|   +-- customers       identity tables behind SECURITY DEFINER RPCs (pairwise public ids only),
|   |                   memberships, consents, loyalty visits, appointments
|   +-- delivery        modules/delivery: zones, flat / distance / zone quotes; own drivers
|   +-- analytics       modules/analytics (weekly sales, orders, paid, cancelled, delivery split,
|   |                   AOV, bookings), modules/storefront-learning (visit counters, patterns)
|   +-- AI functionality modules/assistant (owner buddy: read-only chat + prepare→confirm actions),
|                        storefront-spec copywriter, onboarding brief, design-wizard content,
|                        template pages, signup classifier — ALL behind one gate (lib/ai/external-ai.ts)
|
+-- Skhokholetha (modules/skhokholetha)
|   +-- drivers         DriverProfile (DRAFT→PENDING_REVIEW→APPROVED/REJECTED/SUSPENDED),
|   |                   documents (bytes in DB, admin-only download, audited), versioned legal acceptance
|   +-- dispatch        search → offers (3 per round, 90 s TTL) → accept; ticks on every poll + daily backstop
|   +-- delivery        NetworkDelivery state machine with conditional updates; pickup / drop-off codes
|   +-- tracking        driver location (consented, stale after 10 min), customer tracking page
|   +-- earnings        append-only ledger (24 h hold → AVAILABLE), manual payouts by FINANCE
|
+-- Control Centre (app/platform-admin, modules/platform-admin) — admin host, password + TOTP MFA,
    roles SUPER_ADMIN / OPERATIONS / FINANCE / SUPPORT, every command = permission + reason + audit row
    +-- businesses      list with derived READINESS; detail: account, storefront, catalogue, staff,
    |                   trading, delivery, payments, operations, incidents, audit; suspend / reactivate
    +-- orders          cross-tenant list; "needs attention" (stuck-order detection, read-only)
    +-- payments        attempts + every provider notification; read-only by design
    +-- drivers         applications, documents, decisions, earnings, payouts
    +-- deliveries      lifecycle, offers, events, intervene (cancel before pickup / dispute)
    +-- security        24 h counters + SECURITY events; privileged admin actions
    +-- audit           platform_audit_events (append-only trigger), filters, request ids
    +-- system health   DB probe, alerts, job runs, config presence, SYSTEM failures
```

Cross-cutting: `src/lib/log.ts` (JSON logs with `env`, redacted), `src/lib/redact.ts`, `src/lib/rate-limit.ts` (Postgres fixed window), `src/lib/env-check.ts` (startup validation), `src/middleware.ts` (host → tenant, request id), `vercel.json` (one daily cron).

## 2. Data / event readiness

What exists today, event by event:

| Event | Recorded as | Good enough for |
|---|---|---|
| ORDER_CREATED | `orders.created_at`, `new_order` notification, storefront counter | analytics, ops |
| ORDER_PAID | `orders.paid_at` + `business_payment_events` (online) / `paid_at` only (in person, no actor) | analytics; ops; **not** "who took the cash" |
| ORDER_CONFIRMED / READY / COMPLETED | overwritten `orders.status` + `updated_at`; customer email fire-and-forget | current state only — **no history, no actor, no durations** |
| ORDER_CANCELLED | status + `order_cancelled` notification with reason | ops |
| DELIVERY_* (Skhokholetha) | `delivery_events` (append-only, actor, from/to, data) | everything |
| DELIVERY_* (own driver) | timestamp columns on `order_deliveries` | durations; no actor history |
| PRODUCT_CREATED / UPDATED | `created_at` / `updated_at` only | nothing beyond "exists" |
| STORE_OPENED / PAUSED | `settings.ordering.pausedUntil` only | current state only |
| Admin / security / system | `platform_audit_events` | ops, security |

Verdict: **sufficient for the pilot** (the Control Centre answers every "is X stuck" question from current state plus timestamps), **not sufficient for AI, content recommendations or automation** that need "what happened, when, by whom" for orders and products.

Recommended minimum (one additive migration, no event bus, when the first consumer exists):

- `order_events(id, business_id, order_id, type, from_status, to_status, actor_type, actor_id, data jsonb, created_at)` written inside the same transaction as every order status change, payment and cancellation (`order.service.ts` has one `advanceOrderStatus` and one `cancelOrder` to hook). Mirrors `delivery_events`, so the Control Centre and analytics read both the same way.
- Nothing for products or store pause until a consumer needs it.
- Keep `business_notifications` as the merchant-facing feed; do not turn it into an event log.
- Normalise notification `type` names to lower_snake when next touched (they currently mix styles).

## 3. Content / Marketing workspace

**Built on 2026-10-21 as the minimum foundation — see `docs/content-marketing.md`.** The recommendation below was the design it followed; what shipped: `modules/content` (brand profile in `settings.brand`, drafts, campaigns, calendar list, usage, overview), the `Grow › Content & Marketing` dashboard module, entitlement keys and the accounted AI wrapper. Social posting, ads, CRM and automation remain out.

**Original recommendation (kept for the record):** When pilot evidence asks for it, fit it into the existing merchant dashboard as one more module in `src/modules/dashboard/admin-modules.ts` (the same registry that already gates Orders, Catalogue, Storefront by permission), not as a second product.

What already exists and should be reused rather than duplicated:

- **Merchant context:** business profile, category, suburb, description, voice tone (`storefront-theme`), onboarding brief, differentiator — `src/modules/storefront-spec/facts.ts` already assembles exactly this for the copywriter.
- **Product data:** catalogue with names, prices, images, categories, featured flags; stock.
- **Brand data:** logo, banner, theme tokens, template, storefront revisions with `source` (AI / rules / human).
- **Sales insight:** weekly analytics (now with paid, cancelled, delivery split) and storefront engagement (top items by views / add-to-basket); enough for "what to promote this week".
- **Permissions:** `canManageSettings` (storefront content) and `canManageServices` (catalogue); add one `canManageContent` permission to the presets when the module lands.
- **Audit history:** `storefront_revisions` (who, when, from what) is the model to copy.

Minimum future architecture (one module, two tables):

```
modules/content
  content_drafts   (id, business_id, kind [storefront_copy|social_post|promo|product_description],
                    channel [storefront|whatsapp|instagram|facebook|print], title, body, assets jsonb,
                    status [DRAFT|APPROVED|ARCHIVED], source [AI|HUMAN], created_by_staff_id, approved_by_staff_id, timestamps)
  content_assets   (id, business_id, blob_url, kind, alt_text, created_by_staff_id)  — reuse lib/blob.ts
```

Generation goes through the same `externalAiEnabled()` gate and the same quoted-facts prompt pattern as the copywriter; "what is performing" comes from storefront-learning counters plus `order_events` once it exists. **No external posting** (no social APIs) until explicitly approved: the workspace produces approved, channel-specific text and assets the owner copies out. Campaign ideas and scheduling are a later column on `content_drafts` (`scheduled_for`), not a new system.

## 4. Unified AI assistant

**Partly built on 2026-10-21:** one merchant-facing assistant ("Ask Skhokho": the dock and the assistant page, both renamed), a capability registry (`modules/assistant/tools.ts`) that runs as the signed-in person with permission + entitlement checks, a rules intent router that works without any external model, model tool requests that only run through the registry, prepare → confirm → execute for the product-text write, `MERCHANT_ACTION` audit rows, and one accounted provider wrapper (`lib/ai/anthropic.ts`) behind every external call with usage, cost and allowance. Still future: more capabilities (analytics Q&A, delivery performance) and a conversation-memory model.

**Original recommendation (kept for the record):**

Today the merchant meets AI in six places (buddy page, buddy dock with briefing/readiness/actions, storefront AI drafts, design-wizard content, onboarding brief, and an invisible signup classifier). The strategic direction is **one assistant**. The current code can support that without a rewrite because every capability is already a server function with a tenant id and a permission check; what is missing is the layer that chooses between them.

Recommended boundaries:

| Layer | Recommendation | What exists to build on |
|---|---|---|
| **Orchestrator** | One entry point (`modules/assistant`) that classifies intent and calls one capability; the merchant sees one chat and one "Today" panel. The buddy dock is that surface already | `assistant.service.ts`, `buddy-chat.service.ts`, `llm-provider.ts` (rules fallback stays) |
| **Capability / tool layer** | Pure server functions with the signature `(actor: StaffActor, input) → result`: read catalogue, read orders, read analytics, read readiness, draft storefront, draft content, inspect delivery performance. Each one is the existing service, not a new query | `buddy-snapshot.ts`, `readiness.service.ts`, `analytics.service.ts`, `storefront-spec/copywriter.ts`, `platform-admin/merchant-readiness.ts` (reusable for the merchant too) |
| **Permissions** | The assistant runs **as the signed-in staff member**: every tool takes the same `StaffActor` the dashboard uses and calls `actorCan` — the model can never see or do more than the person. Already true for the buddy; make it the contract for every capability | `requireStaffActorWithFeature`, `actorCan` |
| **Tenant isolation** | Tools take `actor.tenantId` only; never a business id from the prompt or the model | already the rule in every buddy route |
| **Write actions** | Keep the prepare → confirm → execute pattern (`buddy_actions`, 15 min TTL, `NEVER_BUDDY_ACTIONS` list). Add kinds one at a time; high-impact writes (publish, payments, staff, cancel orders) stay on the never-list | `buddy-actions.ts` |
| **Audit** | Record applied AI actions in `platform_audit_events` with `actor_type: 'STAFF'` and `metadata.source: 'assistant'`, in addition to `buddy_actions`, so the Control Centre sees them where it sees every other change | `recordAudit` |
| **Prompt-injection safety** | Treat every merchant/customer string as data: adopt the copywriter's `"""quoted"""` + "never instructions" pattern for every prompt (the buddy, onboarding and classifier prompts do not quote today); keep structured zod validation of model output everywhere | `copywriter.ts` lines ~78–102 |
| **Cost control** | One `ai_usage(business_id, staff_id, capability, model, input_tokens, output_tokens, created_at)` table written by the single fetch wrapper; plan feature `ai_business_buddy` already gates the buddy — extend to the storefront/content capabilities; per-business daily caps like `DAILY_GENERATION_LIMIT` | `rate-limit.ts` (`buddyChatStaff`), `revision.service.ts` limits |
| **Data minimisation** | Send facts, not rows: the snapshot pattern (counts + a few names, customers pseudonymised) is right; never send phone numbers, addresses, emails, payment or driver data. The six fetches should become one `lib/ai/anthropic.ts` wrapper so the gate, timeout, redaction and usage accounting live in one place | `pseudonymiseForModel`, `redact.ts` |

The one foundational change made in this pass to prevent rework: every external model call now goes through `src/lib/ai/external-ai.ts` (`BUDDY_EXTERNAL_AI=enabled` + key), so turning the assistant on is one switch and one legal decision, not six.

## 5. What should NOT be built yet

Deferred until pilot evidence asks for it: full social publishing suite · large CRM · marketing automation · warehouse / enterprise inventory · advanced accounting · customer loyalty automation beyond the existing stamps · complex promotions · route optimisation · surge pricing · ML fraud detection · multi-currency · data warehouse · multi-location · fully autonomous AI agents · an event bus (Kafka / queues) · a billing platform (keep paid plans disabled) · SMS/WhatsApp notifications (needs a provider and consent wording) · a second AI surface of any kind.

Extension points preserved: `admin-modules.ts` registry for new dashboard modules; `settings` JSON readers in `capabilities.ts` (one reader + one writer per concern); `delivery_events` as the pattern for `order_events`; `buddy_actions` as the pattern for confirmed AI writes; `externalAiEnabled()` as the AI gate; `adminCommand` for any new Control Centre command.
