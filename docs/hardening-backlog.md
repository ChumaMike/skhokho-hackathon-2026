# Post-blocker hardening backlog

Source: the independent production-readiness audit (October 2026). These were
found NON-blocking; they are tracked here so none are silently dropped. Each
item records where it lives and its status. Blockers B1–B12 are tracked in the
remediation sprint, not here.

Status: `open` · `in progress` · `done (phase N)` · `decision needed`

## Domains

| Item | Evidence | Status |
|---|---|---|
| VERIFYING rows are never re-checked, so a hostname can be locked forever | `recheckDomains` now sweeps VERIFYING and PENDING rows too; a VERIFYING row whose proof disappears drops back to PENDING | done (2026-10-21) |
| Squat / re-add race: an unverified claim blocks the real owner for 72h and can be renewed by re-adding | removal keeps the row as REVOKED (original createdAt); re-adding revives it, so the window is never renewed; a REVOKED row is claimable by anyone at once; the daily sweep releases unproven claims past the window | done (2026-10-21) |
| DNS resolver errors (SERVFAIL/timeout) count as a failed ownership check | `ownership.ts` marks resolver failures `transient`; `checkDomain` records the error and changes nothing else (no failed check counted, no status move) | done (2026-10-21) |
| Legacy `Business.customDomain` routes with no ownership proof | `src/lib/tenant/context.ts` step 5 | open — audit production rows first |
| Sandbox registrar must never share a database with production | `registrar.ts`, `domain-registration.service.ts` | open |
| Path ending in a file extension skips tenant route pinning | `src/middleware.ts` `STATIC_FILE` check runs before pinning | open |

## Payments

| Item | Evidence | Status |
|---|---|---|
| ITN source check (PayFast IP ranges / host) | `src/lib/payfast-source.ts`: caller IP must resolve from www/sandbox/w1w/w2w.payfast.co.za (hourly DNS cache); DNS unavailable → 503 retry; on in production, `PAYFAST_ITN_SOURCE_CHECK` overrides | done (2026-10-21) |
| Refund-due has no "refund done" workflow | `refund-resolution.service.ts`: merchant (Settings › Payments › Refunds to make) or FINANCE (attempt page) records the refund with a reason; audited; attempt stays REFUND_DUE with a `payment_refund_resolutions` row | done (2026-10-21) |
| `/store/pay/[orderId]` creates payment attempts on GET (link previews can exhaust the cap) | `store/pay/[orderId]/page.tsx` | open |
| Money stored as `Decimal(10,2)` rand, against the integer-cents rule | `Order.total`, `BusinessPaymentAttempt.expectedAmount` | open |
| `.env.example` labels the platform PayFast account as "online order payments" | `.env.example` PayFast block | done (sprint) |
| Code rollback is unsafe once a `REFUND_DUE` row exists (old client can't read the enum value) | `20261004140000_payment_refund_due_and_events` | open — document in rollback runbook |
| PayFast notify tests reuse fixed provider payment ids; an aborted run poisons the next | `notify/route.test.ts` | done (sprint: per-run ids) |

## Auth, staff and operations

| Item | Evidence | Status |
|---|---|---|
| Sessions can't be revoked before expiry (stateless JWT) | `auth.service.ts` | partly done (deactivation revokes on next request); token versioning open |
| Active-staff check on every staff request | `guards.ts` `requireStaff` | done (phase 1, B4) |
| Origin check on cookie-authenticated JSON routes | `src/lib/auth/origin.ts` applied in `middleware.ts` to every state-changing `/api/*` request carrying a session cookie (Sec-Fetch-Site or Origin must match the addressed host; Bearer and cookie-less calls untouched) | done (2026-10-21) |
| Counter page shows orders to any role | `counter-access.ts`: page needs canManageOrders, canProcessPayments or canIssueLoyalty; POS and active orders need canManageOrders, stamping needs canIssueLoyalty | done (2026-10-21) |
| Order transitions lack state guards (`completeOrder`, `advanceOrderStatus`) | `ORDER_TRANSITIONS` table in `order.service.ts`; cancel, complete-on-delivery and in-person payment are now conditional writes too (terminal orders never move; a cancelled order can't be paid) | done (2026-10-21) |
| Bookings don't check the BOOKINGS capability or opening hours | `booking-rules.ts` enforced in `createAppointment` (capability + the slot inside that day's hours, SAST; unconfigured hours fail open, a closed day refuses); availability offers only the day's real window and nothing when Bookings is off | done (2026-10-21) |
| Tracking links rely on cuid entropy and expose customer geolocation | `api/orders/[orderId]/tracking` | open |

## AI and learning

| Item | Evidence | Status |
|---|---|---|
| No post-check of AI copy against the business's facts | `copywriter.ts`, `validate.ts` | open |
| Buddy chat has no daily cap; three Anthropic calls have no timeout | `llm-provider.ts`, `onboarding-provider.ts`, `category-classifier.ts` | done (sprint: daily allowance + 15s timeouts) |
| Client-sent `ENQUIRY_CLICK` counts as a learning conversion | `storefront-learning/patterns.ts` | open |
| No platform-admin login model; pattern approval page is unreachable | `api/platform/login` (OWNER only) | decision needed |

## Storefront

| Item | Evidence | Status |
|---|---|---|
| No `sitemap.ts` / `robots.ts`; thin product metadata; checkout pages not `noindex` | `src/app/store/[slug]/**` | open |
| Images use `<img>` without width/height | Shopfront components | open |
| Accessibility: hero overlay contrast, search `outline: none`, 32px steppers, duplicate menu alt | Shopfront CSS/components | open |
| Menu categories ordered by first-seen product, not category order | `catalog-groups.ts` | open |

## Platform and compliance-adjacent

| Item | Evidence | Status |
|---|---|---|
| No `error.tsx` / `global-error.tsx` | `src/app` | done (sprint) |
| No CSP / HSTS | `src/lib/security-headers.ts` via `next.config.ts`: CSP (self + Google Maps scripts, forms to self + PayFast, no plugins/frames/base), HSTS 2y incl. subdomains (no preload), Permissions-Policy. Transitional: script-src still carries 'unsafe-inline' until a per-request nonce exists | done (2026-10-21), nonce follow-up open |
| ~10 env vars read by code missing from `.env.example` | `CRON_SECRET`, `VERCEL_DOMAINS_TOKEN`, `DOMAIN_REGISTRAR`, `ANTHROPIC_*` … | done (sprint: .env.example + env-check.ts) |
| Plan limits (`max_staff`, `max_products`, `max_services`) never enforced | `billing/entitlements.ts` `withinLimit` has no callers | open |
| No data export / erasure; `ON DELETE RESTRICT` blocks deleting a business | `docs/data-subject-requests.md`: admin-side export (JSON) and erasure for a customer (keyed by phone, `erase_membership` RPC + snapshot scrub) and for a suspended/deactivated business (de-identification; RESTRICT history kept with personal fields scrubbed); every request recorded in `data_subject_requests`. Customer self-service waits for Customer accounts | done (2026-10-21) |
| Email address logged when email isn't configured | `lib/email.ts` | done (sprint) |
| 3 stale delivery-settings tests (pre-existing since b5168de9) | `capabilities.test.ts`, `storefront-content.test.ts`, `storefront-config` test | done (sprint: contract asserted explicitly) |
| CI never runs `migrate deploy` against an empty database (would have caught B1) | `.github/workflows/ci.yml` | correction: CI visual-smoke DOES run `migrate deploy` on fresh PG16; B1 was never pushed so CI never saw it |
