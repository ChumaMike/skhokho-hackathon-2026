# Content & Marketing + AI usage accounting

The minimum secure, reusable and commercially enforceable foundation for
Skhokho's "grow the business" layer. Nothing here posts anywhere: the
merchant writes (or has the AI write), reviews, copies out and posts
themselves. No social APIs, no ad buying, no autonomous agents.

## Shape

```
src/lib/ai/
  external-ai.ts   the ONE switch (BUDDY_EXTERNAL_AI=enabled + key) for every external model call
  anthropic.ts     callModel(): switch → plan feature → monthly allowance → per-person rate limit → timeout → AiUsageEvent row
  pricing.ts       provider price ESTIMATES (USD/MTok) for the Control Centre only

src/modules/content/
  brand-profile.ts settings.brand: voice, audience, personality, phrases, default CTA (reuses storefront voice tone; never duplicates name/logo/description/contact)
  context.ts       gatherContentContext(): storefront facts + brand + ONE subject (product / category / offer / idea / sales insight); no customer data
  generation.ts    generateContentDraft(): permission → plan → context → accounted call → strict JSON validation → DRAFT row → MERCHANT_ACTION audit
  drafts.ts        tenant-scoped CRUD, status machine DRAFT → READY → PUBLISHED_MANUALLY → ARCHIVED, calendar list
  campaigns.ts     name/goal/products/categories/dates; monthly creation limit; "write the set" = N metered generations
  usage.ts         human-readable usage ("34 / 150 generations used this month"); tokens and cost stay internal
  overview.ts      counts, usage, suggestions (labelled evidence-based only when backed by sales rows)

src/modules/assistant/
  tools.ts         Ask Skhokho's capability registry: draft_content, create_campaign, suggest_products_to_promote; rules intent router
  assistant.service.ts  one assistant: rules intent → tool; else model (tools offered) → tool request checked by the registry; else read-only answer
  buddy-actions.ts APPLY_PRODUCT_TEXT: prepare → preview → confirm → updateProduct (the catalogue's own service) → audit

src/app/dashboard/content/   Overview · Create · Drafts · Campaigns · Brand · Calendar (nav group "Grow")
```

Database (one additive migration, `20261021090000_content_marketing_foundation`):
`ai_usage_events`, `content_campaigns`, `content_drafts`, audit category
`MERCHANT_ACTION`, and plan entitlement rows (below).

## Entitlements — capabilities, never plan names

Feature keys (`src/modules/billing/features.ts`): `content_studio`,
`content_generation`, `content_campaigns`, `content_calendar`,
`advanced_business_insights` (boolean); `ai_generations_monthly`,
`ai_token_budget_monthly`, `content_campaigns_monthly` (limits). The
assistant itself stays under the existing `ai_business_buddy` key (label
"Ask Skhokho (AI assistant)").

No feature code mentions a plan code. Packaging is rows in
`plan_entitlements`; a pilot merchant gets a feature with an
`entitlement_overrides` row (Control Centre › business › Plan &
entitlements: grant / deny / clear, reason required, optional expiry,
audited). Changing a plan is the same page (`business_plan_changed`).

Seeded packaging (prices untouched — still NULL for paid plans):

| Feature | FREE | GROW | PRO |
|---|---|---|---|
| Ask Skhokho assistant | yes | yes | yes |
| AI generations / month | 20 | 150 | 500 |
| Content studio (drafts, brand, by-hand writing) | — | yes | yes |
| AI content writing | — | yes | yes |
| Campaigns / month | — | 10 | 50 |
| Content calendar | — | — | yes |
| Business insights for content | — | — | yes |

## Accounting and cost protection

Every external call, from any feature, is one `ai_usage_events` row:
business, actor, feature key, capability (`content.social_post`,
`assistant.chat`, `storefront.draft`, `onboarding.brief`,
`storefront.wizard_content`, `storefront.template_pages`,
`signup.classify`), provider, model, input/output tokens, estimated cost
(micro-USD, null when the model is unpriced), outcome, duration, error
class, idempotency key. Never the prompt or the answer.

Order of refusal inside `callModel` (each refusal is recorded, costs
nothing): `BLOCKED_DISABLED` (switch off) → `BLOCKED_ENTITLEMENT` (plan
lacks the feature) → `BLOCKED_ALLOWANCE` (calendar-month generations or
token budget used up) → `BLOCKED_RATE_LIMIT` (60 calls / person / hour).
Then the call with a hard timeout; `FAILED` / `TIMEOUT` on error;
`REJECTED_OUTPUT` when the answer fails validation. Client-side counters
never decide anything; the UI only displays the server's figure.

Emergency stop: unset `BUDDY_EXTERNAL_AI` (and redeploy on Vercel). Every
feature falls back to its rules path or a plain "switched off" message.

## Security model

- Tools run as the signed-in person: `actorCan(permission)` and
  `hasFeature(feature)` are checked in the registry, not by the model.
  An unknown tool name, bad input, missing permission or missing
  entitlement is refused and explained.
- Reads are permission-scoped; the only write (`APPLY_PRODUCT_TEXT`) goes
  through prepare → preview → confirm → the catalogue's `updateProduct`.
- Tenant isolation: every query is `where: { businessId: actor.tenantId }`;
  a product, category, draft, campaign or action from another business is
  "not found"; foreign ids in campaign product lists are dropped.
- Prompt boundaries: system instructions / FACTS from server rows (quoted
  `"""…"""`) / UNTRUSTED merchant text (product descriptions, offers,
  ideas, instructions) quoted and labelled as data. The model may ask for a
  tool; server code decides.
- Data minimisation: the model sees business name, category, location,
  description, catalogue sample names, the subject product (name, price,
  description), brand profile and an aggregated 30-day top-seller list. No
  customer names, phone numbers, addresses, payments or delivery codes.
- New permission `canManageContent`: owners and Managers; nobody else.

## Audit

`MERCHANT_ACTION` events: `content.generated`, `product_text.generated`,
`content.draft_created`, `content.marked_published`, `campaign.created`,
`product_description.applied`, `product_title.applied`. Metadata is shape
only (type, channel, source type, ids) — never the text. Admin commands:
`business_plan_changed`, `entitlement_override_granted / _denied / _cleared`.

## Control Centre

Business page › Plan & entitlements (effective plan, each content key,
overrides, change-plan and override commands) and › Content & AI (this
month's generations / limit, tokens, estimated cost, failures, refusals,
draft and campaign counts, calls by capability). AI page › External AI
calls (month totals, 24 h, spend estimate, businesses at 80 % of their
allowance). Draft and campaign text is never shown to admins.

## Tests

`src/modules/content/content.security.db.test.ts` (15) covers tenant
isolation, permission denial, unentitled refusal, allowance, the global
switch, provider failure/timeout accounting, rejected output, product
context scoping, apply-needs-confirmation, campaign scoping, admin
visibility without content, prompt-injection tool refusal, idempotency and
provider-body hygiene. `src/lib/ai/anthropic.test.ts` covers the month
window and price estimates. Existing assistant, billing, nav and provider
tests were updated for the new action kind, nav group and gate.
