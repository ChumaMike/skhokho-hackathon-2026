# Platform admin control centre

One admin system: `/platform-admin/*` on the platform host, or the same pages
without the prefix on `admin.<platform>`. Console pages live in the route
group `src/app/platform-admin/(console)/` (layout = role-filtered navigation);
the two public sign-in steps (`/admin-login`, `/admin-mfa`) live outside it.

## Sign-in and MFA (mandatory)

1. `POST /api/admin/login` — password for an `ADMIN` app user. Issues ONLY the
   10-minute `admin_mfa` cookie (it can enrol or verify MFA, nothing else).
2. `/admin-mfa` — first time: `POST /api/admin/mfa/enroll` (QR + key) →
   `POST /api/admin/mfa/confirm` (code; returns 10 recovery codes once).
   After that: `POST /api/admin/mfa/verify` with a TOTP code or one recovery code.
3. Only then the `platform_admin` session (12h) with `mfa: true` and the
   admin's `session_epoch`.

`requireAdmin(permission)` (src/lib/auth/guards.ts) refuses anything else:
no/partial session, staff/driver/customer sessions, tampered tokens, an
inactive or non-ADMIN user, a stale epoch (after an MFA reset or role change),
or a role without the permission (that denial is a security event).

- TOTP: RFC 6238 via `otpauth` (SHA-1, 6 digits, 30s, ±1 step). Each step is
  accepted once (`mfa_last_step`) — no replay.
- Secret sealed with `secret-box` (`PAYMENT_ENCRYPTION_KEY`); without it
  enrolment fails closed.
- Recovery codes: HMAC-SHA256 (key from `JWT_SECRET`) only; single-use.
- Rate limits: 5 MFA attempts / 15 min per admin, 20 per IP.
- Reset: another super admin, with a reason (Settings › Admin team). Never
  your own. Break-glass when no super admin can sign in:
  `scripts/admin-bootstrap.ts reset-mfa|grant-super <email> "<reason>" --confirm`
  (needs database credentials; writes a SYSTEM audit event).

## Roles

| Role | Can |
|---|---|
| SUPER_ADMIN | everything, incl. audit & security logs, admin team, MFA resets |
| OPERATIONS | businesses (incl. suspend/reactivate), drivers incl. documents and decisions, deliveries incl. interventions, customer delivery details, domains, AI |
| FINANCE | payments, payouts and ledger adjustments; read-only drivers/deliveries |
| SUPPORT | read-only: businesses, users, orders, payments, drivers (no documents), deliveries, domains, AI |

First-admin activation, rehearsed on the test database on 2026-10-20 (no manual
database row, no demo seed): `create-admin` (prints a one-time password once,
writes `admin_bootstrap_create_admin`) → `grant-super` (ends the admin's sessions
by bumping `session_epoch`) → first sign-in at `/admin-login` → mandatory MFA
enrolment (QR + 10 recovery codes shown once; store them in the vault) →
Control Centre loads. Break-glass: `reset-mfa` / `grant-super` with database
credentials and a second person on the call (`docs/pilot-operations-model.md`).

New admins start as SUPPORT. The first admin account is made with
`scripts/admin-bootstrap.ts create-admin <email>` (a one-time password is
printed once; MFA enrolment happens on first sign-in), and the first super
admin with `scripts/admin-bootstrap.ts grant-super`. The demo seed
(`prisma/seed.ts`) is for local development only and must never run against
production. Full matrix: `src/modules/platform-admin/permissions.ts`.

## Modules

Overview · Businesses & shops (one business = one shop) · Users · Orders ·
Payments (business → order → attempt → provider notifications, read-only) ·
Drivers (pending/approved/online/busy/offline/rejected/suspended) · Deliveries
(state filters, lifecycle reconstruction) · Payouts · Domains · AI · Security ·
Audit log · System health · Settings.

## Commands, not editors

Every change is a named server action through `adminCommand`
(src/modules/platform-admin/command.ts): permission → reason (min 5 chars) →
the service's own validation → an `ADMIN_ACTION` audit event (strict).
Commands: business suspend/reactivate · driver approve/reject/suspend/
reinstate · document accept/reject · delivery cancel/dispute · payout create /
mark paid / mark failed · ledger adjustment (a new entry with actor, reason,
reference; ≤ R 5 000; idempotent) · admin role change · MFA reset ·
storefront pattern review. There is no status editor and no way to edit an
amount or a balance.

## Audit trail

`platform_audit_events` — append-only (database trigger). Categories:
ADMIN_ACTION, SECURITY, SYSTEM. Metadata passes `src/lib/redact.ts`: keys
naming passwords, codes, OTPs, tokens, cookies, auth headers, keys,
signatures, nonces, ciphers or account numbers are dropped; 9+ digit runs
are masked to the last 4; IPs and login subjects are stored as hashes.

## Observability

- Structured JSON logs (`src/lib/log.ts`, same redaction).
- `x-request-id` on every request/response (middleware), recorded on audit events.
- `job_runs`: every daily-cron task (duration, outcome, error). Failures also
  raise a SYSTEM event.
- SYSTEM events: `email_failed`, `email_unconfigured`, `notification_failed`, `job_failed`,
  `dispatch_tick_failed`, `payment_notification_processing_failed`.
- Merchant readiness (`merchant-readiness.ts`): derived per business from its own settings
  and rows (status, catalogue, hours, fulfilment, zones, pin, payment connection, platform
  email) — Businesses list column, business detail, Overview counts. Never typed in.
- Orders needing attention (`order-attention.ts`): paid-unconfirmed, new-unactioned,
  ready-no-driver, ready-not-collected, stuck-processing, unpaid-online, old-active —
  read-only lists on Orders, counts on Overview, three alert rules. Thresholds in code.
- SECURITY events: `admin_login_failed`, `admin_mfa_failed`, `admin_mfa_rate_limited`,
  `admin_permission_denied`, `staff_permission_denied`, `session_type_mismatch`,
  `rate_limit_triggered`, `payment_webhook_rejected`, `delivery_code_locked`,
  `admin_login`, `admin_mfa_enrolled`, `admin_recovery_code_used`.
- Dispatch latency (median to first offer / to assignment) on Overview and Health.
- `/api/health` (liveness) and `/api/health/ready` (database) report up/down only.
- Alert rules: `docs/alerts.md`.

## Privacy rules in the admin

Driver documents: only with `drivers.documents`, as downloads, each
download audited. Bank accounts: last 4 digits only, everywhere. Driver
phone: full only with `drivers.manage`. Customer address/phone:
`orders.customerDetails` only; customer identity (customers.id) never.
No delivery codes, nonces, tracking tokens or customer keys are ever
selected. AI: counts only, never conversation content. Merchant account ids
are masked. Configuration: present/absent only, never values.
