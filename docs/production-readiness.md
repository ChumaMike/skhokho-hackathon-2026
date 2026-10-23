# Production readiness — baseline repair (October 2026)

Companion documents: `docs/legal-dependencies.md` (POPIA / AI data boundary),
`docs/hardening-backlog.md` (non-blocking findings).

## 1. Architecture map

| Area | What it is |
|---|---|
| Framework / runtime | Next.js 15.5 App Router, React 19, Node.js (Vercel Functions; middleware on the Node runtime). |
| Package manager / repo | pnpm 9 monorepo (`SGDataInt_Group`), turbo; this app is self-contained (no `@skhokho/*` deps). |
| Database | Neon Postgres via Prisma 6 (47 models, 30 migrations). Identity tables (customers, memberships, visits, consents, audit_log) carry triggers and SECURITY DEFINER RPCs (`prisma/sql/`, mirrored in migrations). Writes to them go through the RPCs. |
| Frontend | Server components + small client islands; CSS modules; mobile-first. Storefront renderer driven by a validated spec (`src/modules/storefront-spec`). |
| API | Route handlers under `src/app/api/**` (public storefront, auth, payments, cron, dashboard JSON) + server actions under `src/app/dashboard/**/actions.ts`. |
| Auth / sessions | HS256 JWT (`JWT_SECRET` ≥ 32 chars) in an httpOnly, `sameSite=lax`, `secure` cookie. Owners sign in at `/login` (AppUser); staff at `/staff-login` (BusinessStaff). Every staff request re-checks the account is still active (`requireStaff`). |
| Authorization | Per-role `StaffPermissions` (`src/types`, presets in `modules/staff`), checked server-side by `requireStaffPermission` / `resolveStaffActor`; owners have all permissions. Plans/entitlements are a separate, additional gate (`modules/billing`). |
| Tenant isolation | Application-level (see §4, decision B2): tenant id always from the signed session or a verified Host; middleware strips client tenant headers and pins tenant hosts to their own `/store/<slug>` routes; public APIs bind Host ↔ businessId. |
| Storefronts | `/store/<slug>` and `<slug>.<STOREFRONT_DOMAIN>`; verified custom domains (`business_domains`). |
| Payments | Customer → merchant only, via each merchant's OWN PayFast account (credentials AES-256-GCM encrypted). ITN handler verifies merchant, signature, PayFast check-back, currency, amount; idempotent settlement; REFUND_DUE path; daily reconciliation. Merchant → Skhokho billing is **not built**. |
| Domains | TXT ownership proof → attach to Vercel → DNS/SSL → ACTIVE. Platform-owned hosts reserved (`src/lib/tenant/platform-hosts.ts`). Registrar: sandbox only. |
| AI | Storefront drafts (spec-validated, never auto-published); Business Buddy (role-scoped, prepare→confirm→execute actions, rules-only by default); onboarding/classifier helpers. All external calls time out (15s) and fall back to rules. |
| Delivery | Delivery settings (FLAT / PER_KM), driver assignment, live tracking. |
| Notifications | In-app `business_notifications`; transactional email via Resend. |
| Background jobs | One daily Vercel Cron → `/api/cron/daily` (payment reconciliation, domain re-checks, analytics retention + pattern detection, rate-limit purge, Skhokholetha dispatch backstop, driver earnings release). Every task is a `job_runs` row. No queue. |
| Storage | Vercel Blob for images (public). |
| Rate limiting | Shared Postgres fixed-window limiter (`src/lib/rate-limit.ts`). |
| Logging / monitoring | Structured JSON logs (`src/lib/log.ts`: `ts`, `env`, `level`, `event`, redacted fields) plus remaining `console.*`; SYSTEM / SECURITY audit events feed the Control Centre alerts (`docs/alerts.md`); health endpoints `/api/health` (liveness) and `/api/health/ready` (database). No APM/Sentry yet. |
| Errors | `src/app/error.tsx`, `global-error.tsx`, real 404s; API errors return generic messages (`handleApiError`). |
| Config | Classified in `src/lib/env-check.ts`; validated at start (`src/instrumentation.ts`) — production refuses to start without required variables. |
| Tests | `node --test` + tsx (~1 000 tests), DB tests on a dedicated Neon test database; `npm test` loads `src/lib/testing/test-env.ts`, which forces every DB URL to the test DB. Playwright visual smoke in CI. |
| CI/CD | `.github/workflows/ci.yml` (monorepo): build, lint, typecheck, unit tests; visual smoke runs `prisma migrate deploy` on a fresh Postgres 16. Vercel build runs `prisma migrate deploy` before `next build`. |
| Audit logging | `audit_log` (append-only, identity RPCs); `buddy_actions` (every buddy-prepared change); `business_payment_events` (every verified payment notification). |
| Backup / recovery | Neon point-in-time restore (see §7). |

## 2. Blocker tracker

P0 = launch blocker · P1 = conditional blocker · P2 = hardening (see backlog).

| ID | Sev | Area | Problem → root cause | Fix | Tests | Status |
|---|---|---|---|---|---|---|
| B1 | P0 | Migrations | `20261004090000_assistant_conversations/migration.sql` began with CLI output (`Loaded Prisma config…`) — captured stdout of `prisma migrate diff`. Replay from empty failed. | Line removed. Safe: commit `8c1276c9` is on no remote and the file could never have applied anywhere, so no database holds a record/checksum of it. | Replay from empty (PGlite) + `migrate diff` → empty; CI visual-smoke runs `migrate deploy` on fresh PG16. | **Fixed** |
| B2 | P0 | Data protection | Postgres RLS / runtime role in `prisma/sql/identity_layer.sql` never applied; raw SQL wrote consents directly. | Decision (§4): application-level isolation is the formal boundary; raw-SQL consent writes removed (B6). | `tenant-isolation.test.ts`, `domain-attacks`, `middleware`, buddy/learning isolation tests. | **Fixed (decision recorded)** |
| B3 | P0 | Auth | Owner's BusinessStaff row held a copy of the owner password; `/staff-login` issued owner sessions from it, so a reset didn't lock out the old password. | Staff-login refuses owner rows; new owner rows get an unusable password; migration `20261007090000` disables existing copies. Deactivated owner accounts lose sessions immediately. | `credential-lifecycle.db.test.ts` | **Fixed** |
| B4 | P0 | Staff | Deactivation left invite/reset links usable and set-password re-activated accounts; sessions survived deactivation. | Deactivation revokes password + links; set-password never activates and refuses inactive accounts; reactivation sends a fresh invite; `requireStaff` checks the account is active on every request. | `credential-lifecycle.db.test.ts` | **Fixed** |
| B5 | P0 | Abuse | No shared rate limiting. | `src/lib/rate-limit.ts` on login, staff login, recovery, set-password, sign-up, customer registration, checkout, quote, booking, reviews, analytics beacon, buddy chat; honeypot on public forms. | `rate-limit.db.test.ts` | **Fixed** |
| B6 | P0 | Identity/consent | Public forms recorded marketing / cross-business consent and attached emails to any phone without proof of ownership. | MVP (§5): public forms record no marketing/cross-business consent and attach no email; confirmations only to the email typed for that transaction. | `public-consent.db.test.ts` | **Fixed (MVP; OTP is next)** |
| B7 | P0 | Payments | ITN handler answered 200 on internal failure and on an unanswered PayFast check-back, so PayFast never retried. | 500/503 when processing couldn't complete; post-settlement side effects can't fail a recorded payment; verification promotion retried; check-back has a 10s timeout; daily reconciliation of unconfirmed attempts. | `notify/route.test.ts` (31) | **Fixed** |
| B8 | P0 | Domains | Merchants could add/remove platform hosts; removal detached anything the project had. | One reservation policy (`platform-hosts.ts`, apex-based); `providerAttached` — only the row that attached a hostname may detach it; legacy `customDomain` hosts unclaimable. | `domain-security.db.test.ts`, `domain.service.test.ts` | **Fixed** |
| B9 | P0 | Domains | Unverified domains were attached before proof; unknown hosts fell through to the app (login on look-alike domains). | Attach only after TXT proof; unknown / not-live hosts → 404 for pages AND APIs; app only on known platform hosts. | `domain-security.db.test.ts`, `middleware.test.ts` | **Fixed** |
| B10 | P0 | Legal / AI | No Terms/Privacy; customer names sent to Anthropic. | Technical part fixed: buddy external AI off by default, names pseudonymised when on. Legal documents need counsel (`docs/legal-dependencies.md`). | `ai-boundary.test.ts` | **Technical fixed · legal open** |
| B11 | P0 | Storefront | WhatsApp links built from local numbers (`wa.me/0…`) were dead. | `whatsappLink()` in `src/lib/utils.ts` used everywhere; numbers stored as +27… with a plain-words error. | `whatsapp-link.test.ts`, `credential-lifecycle.db.test.ts` (B11) | **Fixed** |
| B12 | P0 | Storefront | About section shipped merchant advice as its public heading. | Business's own tagline, else "Our story" (`about-heading.ts`). | `whatsapp-link.test.ts` | **Fixed** |
| C1 | P1 | SaaS billing | No merchant → Skhokho payment; plan limits not enforced. | — keep paid plans disabled. | — | **Conditional (disabled)** |
| C2 | P1 | Card payments | Live verification gated by `PAYMENTS_ALLOW_LIVE_VERIFICATION`. | Sign-off on the R5 live verification, then enable. | — | **Conditional (disabled)** |
| C3 | P1 | Domain sales | Only a sandbox registrar. | Integrate an accredited registrar; sandbox never on a production DB. | — | **Conditional (disabled)** |
| C4 | P1 | Config | `NEXT_PUBLIC_APP_URL` required. | Now enforced: production refuses to start without it, and `getAppUrl` throws in production. | `env-check.test.ts` | **Fixed (enforced)** |
| C5 | P1 | Data | Legacy `Business.customDomain` rows route without proof. | Audit production before launch: `SELECT id, slug, custom_domain FROM businesses WHERE custom_domain IS NOT NULL;` then verify via business_domains. | — | **Open (needs prod read)** |
| C6 | P1 | Migration | `business_domains_one_primary` may fail on existing data. | Before deploy: `SELECT business_id, surface, count(*) FROM business_domains WHERE is_primary GROUP BY 1,2 HAVING count(*) > 1;` must return no rows. | — | **Open (needs prod read)** |

Also fixed during this work: the stale delivery-settings tests (contract now
asserted explicitly), the tenant-isolation suite's racing root hooks, PayFast
test fixture isolation, AI call timeouts, PII in email logs, and `npm test`
pointing DB tests at the app database (§6).

## 3. Migrations added in this sprint

| Migration | Purpose | Existing-database impact |
|---|---|---|
| `20261007090000_owner_staff_row_not_a_credential` | Disables passwords stored on owner BusinessStaff rows | Data-only UPDATE; owners keep signing in at `/login` |
| `20261007100000_domain_attach_after_verification` | `business_domains.provider_attached` (+ conservative backfill) | Additive; unverified legacy attachments stay `false` and must be audited by hand |
| `20261007110000_rate_limit_buckets` | Rate-limit counters | Additive |

Modified: `20261004090000_assistant_conversations` (B1, banner line removed — see B1 for why this is safe).

## 4. Decision B2 — tenant isolation boundary

**Decision: application-level isolation is the enforced boundary. Postgres RLS is deferred, not abandoned.**

| Criterion | A. Application-level (chosen) | B. RLS + runtime role |
|---|---|---|
| Prisma compatibility | Native | Needs `SET LOCAL app.business_id` per transaction; every query must run inside an interactive transaction |
| Connection pooling (Neon PgBouncer, transaction mode) | Unaffected | Session settings must be transaction-local; any query outside a transaction silently sees nothing (or everything, if misconfigured) |
| Server actions / route handlers | Session → tenantId already threaded through services | Every entry point needs a wrapper; easy to miss one |
| Background jobs / cron / admin | Run as the app | Need a separate BYPASSRLS role and careful splitting |
| Tests | Existing suites prove it | Test infra must create roles; db push can't express policies |
| Migration complexity | None | High (policies on ~10 tables, grants, role provisioning on Neon) |
| Failure mode | A missed `businessId` filter leaks data — mitigated by tenant-scoped services and isolation tests | Misconfigured policy → silent empty results or production outage |
| Security guarantee | Strong where tested; relies on code review | Defence in depth at the database |

Why A now: the identity tables are only written through SECURITY DEFINER
RPCs that take the business id explicitly; customer global ids never reach a
business; the last raw-SQL writes into `consents` were removed (B6). The
proof is the isolation test suites (`src/lib/testing/tenant-isolation.test.ts`,
`src/lib/tenant/domain-attacks.test.ts`, `src/middleware.test.ts`, buddy and
learning isolation tests). Revisit RLS when there is time to wrap every
query path in tenant-scoped transactions; the design is in
`prisma/sql/identity_layer.sql`.

The warning inside the already-applied migration `20260809000001_identity_rpcs`
("do not put real customer data in before RLS is enabled") is superseded by
this decision; the migration file itself is not edited (it has run in
production and its checksum must not change).

## 5. Decision B6 — customer identity and consent (MVP)

1. **Owning a phone number** means being able to receive a code at it. Nothing in the product verifies that yet.
2. **Actions requiring verified identity:** marketing consent, attaching contact details to an existing customer, cross-business linking, viewing loyalty history remotely.
3. **Guest checkout does not need OTP:** an order is accepted against the typed number (the merchant sees what the customer typed); it creates or reuses a membership but changes nothing about an existing identity.
4. **Marketing consent needs stronger proof:** recorded only in person by staff (now) or after OTP (later).
5. **Merging an existing customer:** only via verified ownership; public forms never modify an existing identity.
6. **Two people, one phone:** treated as one customer at that business (pairwise membership); nothing is shared across businesses.
7. **Email ownership:** not verified; therefore never stored on the identity from public forms — used only to send that transaction's confirmation.
8. **Minimum POPIA-safe approach:** what is implemented now (above).
9. **SMS cost/friction:** an OTP per marketing opt-in only (not per order) keeps cost low; provider choice is a business decision.
10. **Data stored:** phone (E.164) and optional display name per membership; loyalty consent; email only when staff add it in person.

## 6. Test infrastructure findings

- **`npm test` wrote to the app database.** DB tests use the app's Prisma client, which read `POSTGRES_PRISMA_URL` (the app DB in `.env.local`). Fixed: `src/lib/testing/test-env.ts` (loaded via `--import`) re-points every DB URL to `TEST_DATABASE_URL`, refuses to run if they're the same database, and with no test DB points everything at an unreachable address. Guard test: `src/lib/testing/test-env.test.ts`.
- **"Server has closed the connection" flakes.** Root cause: the Neon test compute restarting / scaling to zero closes every pooled connection at once; Prisma then fails one query per dead pooled socket, so one restart cascades through several tests. Neon's Prisma guidance does not require `pgbouncer=true`. Mitigation without masking errors: the test pool is capped (`connection_limit=4`, `pool_timeout=30`, `connect_timeout=15`) so a restart costs at most a few queries; `warm-db` still pre-wakes the compute. Recommendation: disable auto-suspend on the test branch, or run DB tests against the CI Postgres service.
- **Tenant-isolation suite:** two root-level `before` hooks raced (one truncated the database while the other built fixtures). Merged into one ordered hook.
- **PayFast notify tests** reused fixed provider payment ids, so an aborted run poisoned the next; ids are now per-run.
- **Stale delivery tests:** the implementation was right (pricingMode + perKmFeeCents always written since b5168de9); tests now assert "delivery survives an unrelated update" against the real contract, plus a dedicated contract suite (`delivery-settings.test.ts`).

## 7. Operations

**Health:** `GET /api/health` (liveness, no dependencies) · `GET /api/health/ready` (database, 503 when down). Neither reveals details.

**Daily job:** `/api/cron/daily` (03:00 UTC). Each task is isolated; any failure returns 500 so the run shows as failed in Vercel. Requires `CRON_SECRET`.

**Backup / restore:** see `docs/backup-restore.md` (assets, RPO/RTO assumptions, restore and verification procedure, rehearsal log — not yet rehearsed).

**Restore procedure (must be rehearsed before launch — NOT verified in this sprint, no production access):**
1. In Neon, create a branch from production at the target timestamp (point-in-time).
2. Point a Vercel preview deployment's `POSTGRES_PRISMA_URL` / `POSTGRES_URL_NON_POOLING` at the branch.
3. Run `prisma migrate status` against it (must report up to date) and hit `/api/health/ready`.
4. Spot-check: business count, latest orders, latest `business_payment_events`.
5. To fail over: promote the branch (or repoint production env vars) and redeploy.
6. Record the rehearsal date and time-to-restore here.

**Rollback:** code rollback via Vercel instant rollback is safe for the additive migrations here, **except** once a `REFUND_DUE` payment-attempt row exists, an older build's Prisma client can't read it. Migrations are forward-only.

**Configuration (`src/lib/env-check.ts`):**

| Class | Variables | Missing → |
|---|---|---|
| Required at startup (production refuses to start) | `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `JWT_SECRET` (≥ 32), `NEXT_PUBLIC_APP_URL` (https), `CRON_SECRET` | instance stops with a logged reason |
| Payments | `PAYMENT_ENCRYPTION_KEY`, `PAYMENTS_ALLOW_LIVE_VERIFICATION` | merchants can't connect / take card payments |
| Paid plans | `PAYFAST_MERCHANT_ID/KEY/PASSPHRASE` (platform account) | paid plans stay disabled |
| Domains | `VERCEL_DOMAINS_TOKEN`, `VERCEL_PROJECT_ID`, `DOMAIN_REGISTRAR`, `STOREFRONT_DOMAIN` | domains never go live / not sold / no subdomains |
| AI | `ANTHROPIC_API_KEY`, `BUDDY_EXTERNAL_AI` | rules-only |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` | no emails (reset shows "unavailable") |
| Optional | `PLATFORM_DOMAIN`, `ADMIN_DOMAIN`, `PLATFORM_OWNED_DOMAINS`, `PLATFORM_EXTRA_HOSTS`, `BLOB_READ_WRITE_TOKEN`, Google Maps keys | documented defaults |

## 8. Features that must stay disabled

- Paid plans (no billing) — keep Grow/Pro prices NULL.
- Live card payments — keep `PAYMENTS_ALLOW_LIVE_VERIFICATION` off until the live verification is signed off.
- Domain purchase — keep `DOMAIN_REGISTRAR` unset.
- Business Buddy external AI — keep `BUDDY_EXTERNAL_AI` unset until legal approval.
- Cross-business linking — not built.
- Marketing messages to customers — until the Privacy Notice and consent wording exist.
- Skhokholetha — all four switches (`SKHOKHOLETHA_ENABLED`, `DRIVER_SIGNUP_ENABLED`,
  `DELIVERY_REQUESTS_ENABLED`, `DRIVER_APPROVALS_ENABLED`) stay unset. Approval is also
  technically impossible until the driver terms and privacy notice are published and
  configured (`DRIVER_TERMS_*`, `DRIVER_PRIVACY_*`; `docs/skhokholetha.md` › Legal gate).
