# Multi-Tenant Domain & Auth Architecture — Skhokho Platform

**Status:** Draft — authoritative brief for the next phase of work. Not yet implemented.
**Scope:** `business-units/agentive-labs/repos/skhokho-platform`

This document is the full engineering brief for evolving Skhokho into a
production-grade multi-tenant merchant platform, where every registered
business can operate its own branded storefront, booking system and
administration portal — on either a free Skhokho subdomain or their own
custom domain, from the same application, infrastructure and database.

It has four parts, meant to be worked in order:

1. **Phase 1 — Discovery & Architecture Plan.** Read-only investigation of
   the existing repo, followed by a written engineering plan. No code
   changes until this plan exists and is reviewed.
2. **Phase 2 — Implementation.** Incremental build-out of the approved
   architecture, phase by phase, with tests/typecheck/lint after each step.
3. **Phase 3 — Production Readiness Hardening.** An adversarial
   security/reliability pass once Phase 2 is functionally complete, ending
   in an explicit go/no-go call.
4. **Update — Domain Ownership & Branding Specification.** A refinement
   layered on top of Phase 1–3: the two operating modes (Skhokho subdomain
   vs. merchant-owned domain), per-surface domain mapping, primary-domain
   redirects, and white-label branding policy.

---

## Ground rules (apply to all phases)

You are acting as a Principal SaaS Architect, Staff Backend Engineer,
Security Engineer, Product Engineer, Database Engineer and DevOps Engineer
working together on Skhokho — a multi-tenant operating platform for
township and small businesses.

- Before changing any code, thoroughly inspect the entire repository and
  understand how the existing application actually works.
- **Do not** rewrite the system simply because you would have architected
  it differently.
- **Do not** introduce microservices, Kafka, Kubernetes, Redis, queues,
  event buses or additional infrastructure unless the existing
  requirements genuinely require them.
- Prefer strengthening the existing modular-monolith architecture.
- Do not assume documentation is accurate when code can verify the claim.
- Use current official documentation for the project's installed versions
  rather than relying on outdated implementation patterns.

### Target product model

A merchant called "Bantcolon" should initially receive platform domains
such as:

- `bantcolon.skhokho.co.za` — storefront
- `bantcolon.bookings.skhokho.co.za` — bookings
- `bantcolon.admin.skhokho.co.za` — administration

If they own `bantcolon.co.za`, they should later be able to connect:

- `bantcolon.co.za` — storefront
- `bookings.bantcolon.co.za` — bookings
- `admin.bantcolon.co.za` — administration

These should all run from the same Skhokho application and database.

The hostname must resolve to:

```
hostname
  → domain mapping
  → tenant/business
  → surface
  → authorization context
  → application functionality
```

Surfaces should at minimum support: `STOREFRONT`, `BOOKINGS`, `ADMIN`.
Potential future surfaces: `LOYALTY`, `ORDERS`, `CUSTOMER_PORTAL` — do not
build these unless useful architectural preparation is trivial.

### Core principle

**Never trust `business_id`, `tenant_id` or `merchant_id` supplied by a
client as proof of tenancy.**

Tenant context must come from trusted server-side information:

1. resolved hostname/domain mapping
2. authenticated user
3. verified business membership
4. database-level authorization/RLS

---

## Phase 1 — Discovery & Architecture Plan

### Task 1 — Repository discovery

Inspect: project structure; framework and framework version; database
technology; ORM/query layer; authentication; authorization;
business/tenant schema; current RLS implementation; current
middleware/proxy/routing; current storefront architecture; current
booking architecture; staff accounts; customer identities; payments;
loyalty; notifications/email; environment configuration; Vercel/deployment
configuration; tests; migrations; logging; monitoring.

Identify what is already implemented and what is missing.

### Task 2 — Domain architecture

Design a robust domain model. At minimum consider:

```
business_domains
  id
  business_id
  hostname
  surface
  status
  verification_status
  verification_token/hash
  provider
  is_primary
  created_at
  verified_at
  activated_at
  revoked_at
```

Possible statuses: `PENDING`, `VERIFYING`, `ACTIVE`, `FAILED`, `REVOKED`.

Enforce globally: `UNIQUE(hostname)`. A hostname must never resolve to
more than one business. Unknown or inactive domains must never fall back
to another tenant — return a safe 404/unknown-business response.

Determine whether domain lookup should remain in Postgres or whether a
small derived hostname registry/cache is genuinely necessary. **Postgres
must remain the source of truth.**

### Task 3 — Registration model

Design the merchant onboarding flow:

1. user registers
2. email verified
3. business created
4. owner membership created
5. unique business slug selected
6. platform domains assigned
7. merchant enters setup wizard
8. merchant configures store information
9. optional custom domain connection
10. owner invites admins/staff
11. security configuration
12. store goes live

Registration must be resumable. Do not create partially configured
businesses that become impossible to recover.

### Task 4 — Admin identity

Design a membership model separate from business records:

```
business_memberships
  id
  business_id
  user_id
  role
  status
  invited_by
  joined_at
  created_at
```

Roles: `OWNER`, `ADMIN`, `MANAGER`, `STAFF`.

Define permissions explicitly rather than scattering role checks
throughout UI code, e.g.:

```
customers.read       customers.write
loyalty.issue         loyalty.adjust
orders.read           orders.manage
bookings.read         bookings.manage
catalogue.read        catalogue.manage
staff.invite          staff.manage
analytics.read        settings.manage
domains.manage        billing.manage
```

Owners and admins should support/recommend MFA. Investigate the project's
existing authentication provider before implementing this. If Supabase
Auth is used, investigate its current application-MFA / AAL capabilities
and determine where `aal2` should be required.

### Task 5 — Authentication across custom domains

**This is security-critical.**

- Do **not** create a session cookie using `Domain=.skhokho.co.za`.
- Do **not** create broadly shared authentication cookies across
  customer-controlled or public subdomains.
- Prefer host-bound `Secure` + `HttpOnly` cookies.

Investigate whether the existing authentication architecture can
authenticate directly on merchant admin domains. If email confirmations,
magic links, OAuth or password reset flows require a central callback,
design a secure central authentication broker such as `auth.skhokho.co.za`:

```
admin.bantcolon.co.za
  → auth.skhokho.co.za
  → authenticate
  → secure one-time code
  → admin.bantcolon.co.za/auth/callback
  → exchange once
  → establish host-bound session
```

Do not put reusable access/refresh tokens into URLs. Use PKCE / one-time
authorization codes where appropriate. Protect against: open redirects,
CSRF, session fixation, subdomain attacks, replay attacks, expired
handoffs, tenant confusion.

### Task 6 — Custom domain connection

`Settings → Domains → Connect your domain`. Merchant enters e.g.
`bantcolon.co.za`; Skhokho guides them through configuring
`bantcolon.co.za`, `admin.bantcolon.co.za`, `bookings.bantcolon.co.za`.

Design a domain-verification state machine. **Never activate a hostname
purely because a user typed it into a form.** Verify ownership using the
hosting provider's supported verification process and/or DNS TXT
verification. Show: DNS record type, host/name, value, verification
status, SSL status.

After verification: attach domain → wait for SSL → mark active → allow
selection as primary domain. Keep platform fallback domains available
unless explicitly disabled. Consider domain removal, DNS changes,
re-verification and abandoned-domain/takeover scenarios.

### Task 7 — Admin emails

Skhokho should **not** become an email mailbox provider in this phase. An
"admin email" means a verified login identity. A business owner can use
`owner@gmail.com` or `owner@merchantdomain.co.za`, and can invite
additional staff/admins using verified email addresses.

Build: invitation token, expiry, single use, hashed storage, `accepted_at`,
`revoked_at`. Do not reveal whether arbitrary emails are registered when
that could enable enumeration. Prevent deleting the last `OWNER`.
Sensitive operations should require recent authentication and, when
supported, MFA/AAL2.

### Task 8 — Optional branded email sending (design only)

Design but do not necessarily implement: a future feature letting
merchants verify a sender domain (e.g. `orders@bantcolon.co.za`,
`bookings@bantcolon.co.za`). Treat this separately from user
authentication. Require SPF/DKIM/domain ownership verification via the
selected mail provider. Initial implementation may use a
Skhokho-controlled sender such as `notifications@notify.skhokho.co.za`
with `Reply-To:` set to the merchant's contact email.

### Task 9 — Tenant security

Review every tenant-owned table. All tenant records should either contain
`business_id` directly or have an unambiguous database relationship to a
tenant. Investigate adding RLS, tenant-aware foreign keys, composite
constraints, database invariants.

Create an explicit map of: table → tenant ownership → RLS policy → write
authorization → cross-tenant risk. **No tenant security should depend
exclusively on UI filtering.**

### Task 10 — Output first, code second

Before making changes, produce:

1. Existing architecture summary
2. Problems discovered
3. Security risks ranked P0/P1/P2
4. Proposed target architecture
5. Database changes
6. Domain routing architecture
7. Authentication architecture
8. Merchant registration sequence
9. Staff/admin invitation flow
10. Custom-domain sequence
11. Migration strategy
12. Testing strategy
13. Exact files expected to change
14. Areas we should deliberately NOT change
15. Implementation phases

For every recommendation distinguish: **EXISTING / KEEP / MODIFY / ADD /
REMOVE**.

**Do not begin implementation until this repository-specific engineering
plan has been produced.**

---

## Phase 2 — Implementation

Continue implementing the approved Skhokho multi-tenant architecture.

Work as a Staff Full-Stack Engineer with ownership over correctness,
security, UX, database integrity and maintainability. Do not perform a
large rewrite — work incrementally. **After every meaningful phase:** run
tests, run type checking, run linting, verify migrations, report exactly
what changed, identify anything still incomplete.

### Target experience

**Register.** "Create your business" — business name (Bantcolon), owner
name (Chuma), admin/login email (`owner@bantcolon.co.za`), password or
supported auth method, email verification.

**Business created.** Bantcolon now exists as its own tenant. Platform
domains generate automatically: storefront `https://bantcolon.skhokho.co.za`,
bookings `https://bantcolon.bookings.skhokho.co.za`, admin
`https://bantcolon.admin.skhokho.co.za`.

**Owner admin.** The owner signs into the ADMIN surface — the business
operating system. Primary admin navigation: Overview, Customers, Loyalty,
Orders, Bookings, Catalogue, Staff, Reviews, Analytics,
Messages/Notifications, Operations, Payments, Settings. Each section must
remain scoped to the current business.

### Overview

A useful merchant overview, not vanity analytics. Possible cards: sales
today, orders today, bookings today, returning customers, new customers,
loyalty stamps issued, rewards redeemed, upcoming bookings, low stock,
unfulfilled orders, lapsed customers, recent reviews, staff currently
active. **Do not fabricate statistics — every metric must come from real
business data.**

### Customers

Merchant can: search customers; view customer activity; view loyalty
balance/history; view orders; view bookings; view last visit; view
review/activity history where permitted; identify returning customers;
identify lapsed customers. Continue respecting the platform's pairwise
customer identity/privacy design.

### Loyalty

Implement loyalty as an append-only event ledger if the current
implementation uses mutable counters:

```
loyalty_events
  id, business_id, customer_id/pairwise_id, event_type, amount, reason,
  order_id, booking_id, staff_id, idempotency_key, metadata, created_at
```

Types: `EARN`, `REDEEM`, `ADJUSTMENT`, `REVERSAL`, `EXPIRY`. Do not
directly mutate balances without an auditable event.

### Orders

Operational statuses, e.g.: `NEW`, `AWAITING_PAYMENT`, `PAID`,
`PREPARING`, `READY`, `COMPLETED`, `CANCELLED`, `REFUNDED`. Preserve
existing valid semantics if already implemented.

### Bookings

Admin can: view daily/week bookings; filter by staff; filter by service;
confirm/cancel where appropriate; view customer; block time; configure
operating hours; configure staff availability. **Concurrency protection
must exist at the database level** where double-booking would otherwise
be possible.

### Catalogue

Products/services. Maintain: price snapshots on historical orders; stock
safety; atomic stock decrement; service duration; staff assignment;
visibility; availability.

### Staff

Owner/admin can: invite by email; change role; disable access; see
pending invitations; resend invitation safely; revoke invitation. Roles:
`OWNER`, `ADMIN`, `MANAGER`, `STAFF`. Permissions should be centralized —
**do not** implement authorization using scattered checks such as
`if (user.role === "admin")` throughout dozens of components. Create a
proper permission model.

### Admin invites

Owner enters email → create secure cryptographically-random invitation
token → store only a secure hash where practical. Invitation includes
business, role, inviter, expiry. Recipient accepts: if account exists,
authenticate then confirm invitation; if not, register → verify identity
→ accept invitation. Invitation is single-use. Expired/revoked
invitations fail safely. Prevent role escalation. Prevent cross-business
invitation confusion.

### Custom domain settings

`Settings → Domains`. Display platform domains (storefront, bookings,
admin) and a custom-domain entry point. Merchant enters e.g.
`bantcolon.co.za`; Skhokho explains it will configure `bantcolon.co.za`,
`bookings.bantcolon.co.za`, `admin.bantcolon.co.za`. Implement domain
records and verification workflow per the schema in Task 2/the Update
Specification below. Hostname must be globally unique; normalize
hostnames; reject malformed hostnames; prevent
localhost/internal/private-host SSRF-like abuse if any server-side
DNS/network inspection is performed.

### Domain routing

Every request must resolve `hostname → business + surface`. Do not rely
on tenant IDs submitted by the browser. For platform domains, parse only
trusted patterns; for custom domains, consult the verified mapping. After
resolution, create a trusted server-side tenant context. Admin requests
additionally require: authenticated user + active business membership +
required permission. Example invariant: `admin.bantcolon.co.za/orders`
must never allow a user from another business to retrieve Bantcolon
orders by changing IDs.

### Public surfaces

`bookings.bantcolon.co.za` and `bantcolon.co.za` are customer-facing and
must **not** receive the merchant ADMIN session cookie. Use host-scoped
`Secure` `HttpOnly` session cookies; do not broadly scope cookies across
merchant surfaces.

### Authentication

Investigate the existing auth system. If the application uses Supabase
SSR/Auth, preserve supported modern SSR/PKCE patterns. For
custom-domain authentication, avoid putting reusable auth tokens in URLs.
If necessary, introduce a central auth callback/broker (`auth.skhokho.co.za`)
using a short-lived, single-use, tenant-bound, destination-bound
authorization exchange. Never accept arbitrary redirect URLs — resolve
redirect targets from trusted database records.

### MFA

Support MFA for users if supported by the authentication stack. Require
or strongly enforce elevated assurance for `OWNER`/`ADMIN` and for
sensitive actions: domain changes, role changes, owner transfer, payment
configuration, MFA removal, email change, business deletion, large
loyalty adjustments.

### Database security

Enable or complete RLS for tenant-owned tables. Ensure policies use
authenticated identity + membership rather than client-supplied business
IDs. Write cross-tenant tests: Business A (Owner A, Staff A) and Business
B (Owner B, Staff B); attempt access across every major resource. Every
unauthorized operation must fail. Test at API/server layer **and**
database/RLS layer where practical.

### Custom domain infrastructure

Use the hosting provider's current supported custom-domain APIs. Do not
shell out to CLI commands from production application code. Wrap provider
integration behind an abstraction such as:

```
DomainProvider
  addDomain()
  getConfiguration()
  verifyDomain()
  removeDomain()
  getStatus()
```

Keep Vercel-specific code behind the provider adapter. Store provider
identifiers where necessary. Do not mark a domain `ACTIVE` until
verification and TLS configuration are valid.

### Onboarding UX

Turn merchant setup into a clear progress flow/checklist: business created
✓, owner email verified ✓, business profile, store hours,
catalogue/services, loyalty rules, staff, payments, custom domain, store
launch. **Do not require custom-domain setup to begin using Skhokho** —
default Skhokho domains should work immediately.

### Operational UX

The admin product should feel like the merchant's own software. On
`admin.bantcolon.co.za`, show Bantcolon branding, not repetitive "Welcome
to Skhokho." Skhokho may remain subtly visible as "Powered by Skhokho"
depending on plan/product strategy. Settings should support: logo, brand
colour, business name, business description, contact information,
operating hours, location, social links, booking configuration, loyalty
configuration, storefront configuration. Avoid turning this into a
generic page builder.

### Quality requirements

No mock data in production paths. No TODO-only functionality presented as
working. No silent catch blocks. No client-authoritative tenant context.
No broad auth cookies. No direct browser access using privileged service
keys. No unchecked domain activation. No destructive migration without
documented recovery. No mutable financial/loyalty history where an event
ledger is appropriate. No privilege based solely on UI visibility.

### Success criteria

1. Register a new merchant.
2. Verify owner email.
3. Automatically create tenant.
4. Automatically create platform domain mappings.
5. Open merchant storefront.
6. Open merchant booking page.
7. Open merchant admin page.
8. Sign in securely.
9. Admin sees only their business.
10. Owner invites another admin.
11. New admin accepts invite.
12. Permission rules apply.
13. Merchant begins custom-domain onboarding.
14. Domain ownership is verified.
15. Custom storefront activates.
16. Custom bookings domain activates.
17. Custom admin domain activates.
18. HTTPS works.
19. Admin cookies never leak to public surfaces.
20. Tenant B cannot access any Tenant A resource.
21. Disabling a domain stops routing it.
22. Removing a staff member removes access.
23. All changes have tests.

At completion, provide: files changed; migrations added; architectural
decisions; security decisions; tests written; manual tests required;
environment variables required; external configuration required;
remaining risks.

---

## Phase 3 — Production Readiness Hardening

Perform a production-readiness hardening pass on the Skhokho platform.
Act simultaneously as Principal Engineer, Application Security Engineer,
Database Reliability Engineer, SaaS Architect, QA Engineer, Payments
Engineer, SRE.

**This is not a feature-development sprint.** The objective is to prove
that Skhokho can safely onboard real merchants. Do not hide failures — if
something cannot be proven, mark it as unverified.

### Hardening 1 — Tenant isolation

Create at least two tenants with realistic data (Tenant A, Tenant B).
Test every major resource — business, memberships, customers, pairwise
identities, loyalty, products, services, orders, order items, bookings,
payments, reviews, analytics, domains, staff, invitations, settings,
notifications, AI tools if present — for read/list/create/update/delete
across tenants. Tenant B must never be able to operate on Tenant A
resources. Test API/server authorization, database RLS, ID guessing,
query/body/route parameters, server actions, exports, analytics, domain
routing.

### Hardening 2 — Domain attacks

Test: unknown hostname; unverified hostname; revoked hostname; duplicate
hostname; uppercase hostname; trailing-dot hostname; internationalized
hostname if supported; malformed hostname; domain belonging to another
tenant; removed domain; DNS changed after verification; custom
admin/booking hostname. No custom hostname may become active before
ownership verification. Check abandoned-domain/subdomain takeover risks.
Ensure removing a domain also removes/deactivates its hosting-provider
mapping appropriately.

### Hardening 3 — Session security

Verify admin sessions use `Secure`, `HttpOnly`, appropriate `SameSite`,
host-restricted scope. Prefer `__Host-` cookie semantics where compatible
with the auth framework. No public merchant surface should receive admin
session credentials. Test: CSRF; open redirect; session fixation;
replayed auth callback; expired auth code; wrong tenant callback; wrong
hostname callback.

### Hardening 4 — Authorization

Create explicit role tests for `OWNER`, `ADMIN`, `MANAGER`, `STAFF` —
every permission. Require elevated authentication/MFA where configured
for: domain changes, business deletion, owner transfer, payment settings,
staff privilege escalation, MFA removal, email change, large loyalty
adjustment. Ensure the last `OWNER` cannot accidentally remove or demote
themselves without an intentional ownership-transfer flow.

### Hardening 5 — Database invariants

Review database constraints. Where possible the database should prevent:
cross-tenant relations; negative impossible stock; duplicate payment
processing; duplicate loyalty reward; double booking; duplicate hostname;
duplicate membership; orphaned tenant data; invalid status transitions.
Do not depend on frontend checks for business invariants.

### Hardening 6 — Payments

Exercise the payment integration realistically. Verify: server-side
webhook/ITN verification; signature validation; amount validation;
transaction identity; idempotency; duplicate callback; delayed callback;
failed callback; cancelled payment; successful payment; refund state;
reconciliation. Browser return URLs must not mark payments as successful.
Payment event history should be auditable.

### Hardening 7 — Loyalty

Ensure loyalty is auditable. Test: issue, redeem, adjust, reverse,
duplicate request, concurrent request, staff authorization, tenant
authorization. Ensure identical transactions cannot accidentally award
loyalty twice. Create fraud/audit visibility for high-value or unusual
adjustments.

### Hardening 8 — Bookings

Simulate concurrent booking attempts. Two customers must not be able to
reserve an exclusive staff/time slot simultaneously. Validate: timezone
handling; DST assumptions if relevant; store hours; staff availability;
blocked time; service duration; cancellation.

### Hardening 9 — Stock

Simulate concurrent purchases against limited inventory. Inventory
updates must be atomic. Historical order items must retain name/price/
quantity at purchase — do not derive historical financial information
from current catalogue values.

### Hardening 10 — Email and invitations

Test: expired invitation; replayed invitation; revoked invitation;
wrong-user invitation; wrong-business invitation; duplicate acceptance;
email enumeration; malformed email; invitation privilege escalation.
Transactional email failure must not corrupt the underlying business
transaction. If email sending is asynchronous or retryable, ensure
idempotency.

### Hardening 11 — Observability

Create structured logs with fields such as: timestamp, request_id,
business_id, user_id, action, route, status, latency, error code. **Do
not log**: passwords, auth tokens, session cookies, payment credentials,
secret verification tokens. Establish alerts for meaningful operational
failures — at minimum: payment webhook failures, database failures,
domain verification failures, authentication spikes, repeated
unauthorized tenant access, notification failures, backup failures,
application error spikes.

### Hardening 12 — Database operations

Ensure schema migrations are versioned. Prove a clean database can
migrate from baseline to current version. Document deployment migration
strategy. Verify backups. Perform at least one restore exercise or
document exactly why it cannot yet be performed. Check the deployed
PostgreSQL version against current PostgreSQL security releases.

### Hardening 13 — Security headers

Review: HSTS, CSP, frame restrictions, content-type options, referrer
policy, permissions policy. Do not blindly add headers that break
required functionality.

### Hardening 14 — Rate limits and abuse

Protect: login, registration, password reset, email invitation, loyalty
issuing, review creation, domain verification, booking submission, order
submission, payment endpoints, AI endpoints. Rate limits should consider
tenant and user context where appropriate.

### Hardening 15 — AI

If an AI assistant is active, it must not have unrestricted SQL/database
access. Use explicit read-only tools. Authorization must happen outside
the model. Tenant context must be fixed by the server. Treat
database/customer text as untrusted model input. Attempt prompt
injection, cross-tenant retrieval, and asking the model to reveal
hidden/system data. If AI is not yet active, document these requirements
rather than adding unnecessary AI code.

*Note: Skhokho's `/dashboard/assistant` is read-only (no tools, no write
access), tenant-scoped via `requireStaff()`'s own session token, and
currently rules-based (no live model call, `ANTHROPIC_API_KEY` unset in
every environment) — see `docs/engineering/tool-graduation/
skhokho-platform.md`, Known Risks 12 and Open Gaps 16, for its current,
not-yet-governance-reviewed status.*

### Hardening 16 — Performance

Test public experiences under mobile conditions. Prioritize: storefront,
loyalty card, booking, checkout. Measure: JS payload, image payload,
number of requests, TTFB, LCP, CLS, interaction responsiveness. Do not
optimize the merchant dashboard at the expense of the public customer
experience.

### Hardening 17 — Final report

Produce a launch-readiness matrix. Classify every item: `PASS`, `PARTIAL`,
`FAIL`, `NOT TESTED`. Group findings into `P0` (blocks real customers),
`P1` (required before larger pilot), `P2` (operational improvement), `P3`
(later optimization).

Then answer explicitly: **"Would you personally approve this build for a
pilot involving real merchants and customer information?"** Answer YES or
NO. Do not soften the conclusion. If NO, state the exact blockers. Do not
implement speculative architecture simply to make the report look
sophisticated.

---

## Update — Domain Ownership & Branding Specification

Skhokho must support two equally valid operating modes for every
merchant.

### Mode 1 — Skhokho domain

Merchants who do not own a domain should be able to launch immediately
using Skhokho infrastructure — e.g. `bantcolon.skhokho.co.za`,
`bantcolon.bookings.skhokho.co.za`, `bantcolon.admin.skhokho.co.za`.
These generate and are managed automatically. The merchant should not
need to understand DNS, SSL or domain management to launch.

### Mode 2 — Merchant-owned domain

A merchant may instead connect their own domain, e.g. `bantcolon.co.za`.
Once verified, their business should be able to operate entirely through
it: `bantcolon.co.za`, `bookings.bantcolon.co.za`, `admin.bantcolon.co.za`.
Their customers should not need to see a `skhokho.co.za` URL anywhere in
the normal customer journey. The merchant-facing administration system
should also be accessible through `admin.bantcolon.co.za`. The merchant
continues using the same Skhokho application, infrastructure, database
and tenant internally.

**Do not:** create a separate deployment per merchant; create a separate
codebase; create a separate database purely because a custom domain is
used; copy application code into merchant-specific projects. Custom
domains are presentation/routing infrastructure over the same
multi-tenant application.

### Domain choice (setup UI)

"Choose your business web address" —

- **Option A — Use a free Skhokho address** (`bantcolon.skhokho.co.za`):
  instant, no DNS configuration, SSL automatically managed, can connect
  your own domain later.
- **Option B — Use my own domain** (`bantcolon.co.za`): your own brand,
  your own URL, storefront, booking portal, administration portal.

If the merchant chooses their own domain, guide them through DNS
ownership verification.

### Custom domain surfaces

Do not assume every business needs exactly three domains — allow
individual surfaces to be mapped. Example:

| hostname                  | surface    |
|----------------------------|------------|
| bantcolon.co.za             | STOREFRONT |
| bookings.bantcolon.co.za    | BOOKINGS   |
| admin.bantcolon.co.za       | ADMIN      |

A merchant could alternatively choose `shop.bantcolon.co.za`,
`book.bantcolon.co.za`, `manage.bantcolon.co.za` — the merchant chooses
the hostname while Skhokho controls which supported surface it maps to.

### Primary domains

Each surface should have one primary domain, e.g. STOREFRONT primary =
`bantcolon.co.za`, BOOKINGS primary = `bookings.bantcolon.co.za`, ADMIN
primary = `admin.bantcolon.co.za`. Platform Skhokho domains may remain as
fallback aliases. When a custom primary domain is active, the Skhokho
alias may redirect to the merchant's primary domain, e.g.
`bantcolon.skhokho.co.za → 308 → bantcolon.co.za`. Do not create redirect
loops.

### White-label behaviour

A merchant using their own domain should be able to have a customer
experience that does not visibly depend on the Skhokho brand. The
storefront should use the merchant's business name, logo, brand colour,
favicon, contact details, social links, SEO metadata, sharing image. The
browser title should say "Bantcolon" rather than "Bantcolon | Skhokho"
unless the merchant's plan explicitly includes Skhokho co-branding.

Support a plan-level branding configuration such as `SKHOKHO_BRANDED`,
`POWERED_BY_SKHOKHO`, `WHITE_LABEL`. Do not hardcode branding decisions
throughout components — use a centralized branding policy.

### Business email

Custom domains and login emails are separate concepts. A merchant with
`bantcolon.co.za` may sign into `admin.bantcolon.co.za` using
`chuma@gmail.com` or `chuma@bantcolon.co.za`. **Skhokho must not require
the login email domain to match the merchant's website domain** — account
identity and business-domain ownership are separate security concepts.

Later, after verifying `bantcolon.co.za`, Skhokho may allow branded
transactional sending such as `bookings@bantcolon.co.za`,
`orders@bantcolon.co.za`, `hello@bantcolon.co.za` — but Skhokho should not
become a mailbox/email hosting provider as part of the initial
implementation.

### Domain database model

```
business_domains
  id
  business_id
  hostname
  surface
  domain_type
  is_primary
  status
  verification_status
  provider_domain_id
  created_at
  verified_at
  activated_at
  revoked_at
```

- `domain_type`: `PLATFORM` | `CUSTOM`
- `surface`: `STOREFRONT` | `BOOKINGS` | `ADMIN`
- `status`: `PENDING` | `VERIFYING` | `ACTIVE` | `FAILED` | `REVOKED`

Constraints should include `UNIQUE(hostname)` and, preferably, one primary
active hostname per business per surface.

### Custom domain activation

Never trust a merchant merely entering `bantcolon.co.za` as evidence that
they own it. Flow:

```
Merchant enters domain
  → Create PENDING domain record
  → Generate verification requirement
  → Show DNS configuration
  → Verify ownership
  → Attach domain to hosting infrastructure
  → Verify TLS/SSL
  → Activate hostname
  → Merchant chooses whether it becomes primary
  → Update routing
```

If ownership cannot be verified, the domain must never route to that
tenant.

### Important product principle

Skhokho provides the infrastructure. The merchant owns the customer
relationship and can own the visible brand. The desired customer
experience: a customer visits `bantcolon.co.za` and feels like they are
interacting with Bantcolon. Behind the scenes, Skhokho provides identity,
loyalty, bookings, commerce, customer management, analytics, payments,
staff management, operations, infrastructure.

**This separation between merchant brand and platform infrastructure is a
core Skhokho product principle.**
