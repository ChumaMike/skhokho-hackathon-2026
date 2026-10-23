# Skhokholetha — the Skhokho delivery network

Skhokholetha is the logistics capability of the existing Skhokho platform, not
a second platform. It reuses Skhokho's users (AppUser), sessions (JWT
cookies), businesses, orders, order deliveries, delivery settings, payments,
notifications, rate limiter, encryption helper, cron and audit patterns.

## What already existed (and stays)

| Existing | Role in Skhokholetha |
|---|---|
| `AppUser` | A driver IS an AppUser (new or existing). No second user table. |
| JWT session cookies (`auth.service.ts`) | New token type `driver` (own cookie), same signing/verification. |
| `Business`, `Order`, `OrderDelivery` | `OrderDelivery` is the **delivery request** (drop-off address snapshot, customer contact, geocoded drop-off). The network delivery hangs off it 1:1. |
| In-house delivery (BusinessStaff drivers, `canPerformDeliveries`) | Unchanged. A shop either uses its own staff driver OR requests a Skhokholetha driver for an order — never both at once. |
| Delivery settings (`pricingMode`, `feeCents`, `perKmFeeCents`) | Input to the network quote (centralised in `pricing.ts`). |
| `business_notifications` | Shop notifications for delivery milestones. |
| `src/lib/rate-limit.ts` | Brute-force protection on pickup/drop-off codes, login, location pings. |
| `src/lib/crypto/secret-box.ts` | Payout bank details encrypted at rest. |
| Platform admin (`AppUser` role ADMIN, `requireSuperAdmin`) | Driver review and payouts. An admin sign-in route is added (none existed). |

## Flow

```
Order (DELIVERY, PAID) ─ OrderDelivery (request) ─ shop requests network driver
  → NetworkDelivery CREATED → quote stored (cents) → SEARCHING
  → offers to nearest ONLINE approved drivers (time-limited)
  → one ACCEPT wins (conditional update + partial unique index) → ASSIGNED
  → DRIVER_TO_PICKUP → ARRIVED_PICKUP → [pickup code from shop] PICKED_UP
  → IN_TRANSIT → ARRIVED_DROPOFF → [drop-off code from customer] DELIVERED
  → ledger: one earning per delivery (unique source key)
```

## State machine (server-only, `src/modules/skhokholetha/state-machine.ts`)

| From → To | Actor | Prerequisite / side effects |
|---|---|---|
| CREATED → SEARCHING | system (on request) | quote stored |
| SEARCHING → OFFERED | system (dispatch) | ≥1 offer created |
| OFFERED → SEARCHING | system | all offers expired/declined |
| SEARCHING/OFFERED → ASSIGNED | driver (accept) | live offer; atomic claim; driver ONLINE→BUSY |
| ASSIGNED → DRIVER_TO_PICKUP | assigned driver | — |
| DRIVER_TO_PICKUP → ARRIVED_PICKUP | assigned driver | — |
| ARRIVED_PICKUP → PICKED_UP | assigned driver | **valid pickup code** (from the shop) |
| PICKED_UP → IN_TRANSIT | assigned driver | — |
| IN_TRANSIT → ARRIVED_DROPOFF | assigned driver | — |
| ARRIVED_DROPOFF → DELIVERED | assigned driver | **valid drop-off code** (from the customer); earning created once; driver BUSY→ONLINE |
| CREATED…ARRIVED_PICKUP → CANCELLED | shop / admin | before pickup only |
| PICKED_UP…ARRIVED_DROPOFF → FAILED | assigned driver / admin | reason required |
| FAILED → RETURNING → RETURNED | assigned driver | goods back to shop |
| any non-terminal → DISPUTED | admin | — |

Terminal: DELIVERED, CANCELLED, RETURNED. Every transition is a conditional
UPDATE (`WHERE status = <expected from>`), writes one `delivery_events` row,
and is idempotent where retries are expected (accept, complete).

## V1 decisions

- **Payment:** only PAID orders can get a network driver (no cash handling by drivers in V1).
- **Pricing (quote parity):** the network cost is based on the EXACT delivery fee the customer paid at checkout (`order_deliveries.delivery_fee_cents`, priced by the shared rule in `src/modules/delivery/delivery-quote.ts`): `networkCost = max(customerFee, R25 minimum)`, `merchantCost = networkCost − customerFee` (shown to the shop and echoed back as the confirmed fee, so a shortfall is never silent), driver earning = network cost − platform fee (0% in V1). Both recorded on the delivery and frozen in the snapshot. Distance (shared road-distance rule) only gates the 25 km radius. See `docs/merchant-operations.md`.
- **Codes:** 6-digit pickup and drop-off codes derived with HMAC from a server secret + a per-delivery nonce (never stored in plaintext, never logged); 5 wrong attempts lock the code until the shop rotates it (rotation returns nothing to the shop — see *Proof of delivery*).
- **Documents:** stored in Postgres (`driver_documents.content`), never in public storage; type/size validated; served only to the owning driver (metadata) and platform admins (bytes).
- **Location:** consent required; ONLINE drivers send a coarse position every few minutes (latest only, no history); during an active delivery the latest position is kept on the delivery and cleared at the end. Customers see the driver only between pickup and arrival.
- **Tracking:** two separate unguessable links, both stored as hashes only. The shop's *status* link (`/track/<token>`, shareable, no secrets) and the customer's own page (`/delivery/<customer key>`, the only place the drop-off code appears). Both stop working 24 hours after the delivery ends.
- **Notifications:** shop → `business_notifications`; driver → offers shown in the driver app (polled); customer → their own delivery page (link in the checkout response and their own confirmation email). Notification failures never affect delivery state.
- **Payouts:** admin-controlled; the ledger is append-only with unique source keys.

## Where it lives

| Who | Screens | API / actions |
|---|---|---|
| Driver | `/driver/join`, `/driver/login`, `/driver` (onboarding → status → console + earnings) | `/api/driver/*` (session cookie `skhokho-driver-token`), `src/app/driver/actions.ts` |
| Shop | `Dashboard › Deliveries › Skhokholetha drivers` (quote, request, status, pickup code, tracking link, cancel, new codes) | `src/app/dashboard/deliveries/actions.ts` (`canManageDeliveries`) |
| Customer | `/delivery/<customer key>` (their own page: status + drop-off code); the shop may also share `/track/<token>` (status only). Both noindex, no referrer, rate limited, refresh every 30s | key issued at checkout (`/api/store/checkout`) |
| Platform admin | `/admin-login`, `/platform-admin/drivers[/<id>]`, `/platform-admin/payouts`, `/platform-admin/deliveries` | `src/app/platform-admin/drivers/actions.ts`, `/api/admin/driver-documents/<id>` |
| Scheduler | daily cron tasks `deliveryDispatch`, `driverEarnings` | request paths call the throttled `maybeTickDispatch` (see *Dispatch load*) |

Admin pages work on both hosts: `/platform-admin/...` on the platform host, and
the same pages WITHOUT the prefix on `admin.<platform>` (middleware adds it).
A prefixed path on the admin host is 308-redirected to the clean URL, and
`/admin-login` exists on both (`src/lib/tenant/admin-paths.ts`).

## Production switches

All server-side (`src/modules/skhokholetha/flags.ts`), checked in the service
layer — so routes, server actions and any future caller are covered — and OFF
unless set to exactly `true`. Every sub-switch also needs the master switch.

| Variable | Off means | Recommended now |
|---|---|---|
| `SKHOKHOLETHA_ENABLED` | no going online, no accepting, no new offers; drivers can still go offline; deliveries in progress can finish; shops/admins can still cancel; admin reads unaffected | unset (off) until the internal pilot |
| `DRIVER_SIGNUP_ENABLED` | no driver sign-up, no "add driving" for owners, no application submission | unset |
| `DELIVERY_REQUESTS_ENABLED` | shops can't request a network driver (existing deliveries carry on) | unset |
| `DRIVER_APPROVALS_ENABLED` | admins can't approve or reinstate drivers | unset |

## Legal gate

`DRIVER_TERMS_VERSION`, `DRIVER_TERMS_URL`, `DRIVER_PRIVACY_VERSION`,
`DRIVER_PRIVACY_URL` (https) name the CURRENT published documents
(`src/modules/skhokholetha/legal.ts`). The app holds no legal text.

- Until all four are set: nobody can accept, submit an application, be
  approved or be reinstated — even with `DRIVER_APPROVALS_ENABLED=true`.
- Acceptance is stored only for the version configured at that moment (the
  form posts the versions shown; a mismatch is refused). Each acceptance is a
  row in `driver_legal_acceptances` (driver, document, version, URL, time,
  SHA-256 of the IP, user agent) — append-only at the database level.
- Publishing a new version stops every driver from working (going online,
  being offered, accepting) until they accept it.

## Proof of delivery

The drop-off code must reach the customer without passing through the shop,
otherwise a shop and a driver together could complete a delivery that never
happened. So:

1. At online checkout the customer's browser receives a **customer key**
   (HMAC of the order delivery id + a nonce; only its hash is stored). The
   storefront keeps the link in that browser only, and it goes in the
   customer's own confirmation email. No business-facing endpoint, page,
   notification or event returns it.
2. The customer's page `/delivery/<key>` is the only place the drop-off code
   is shown. The shop's view, status link, notifications and events never
   contain it (`SEC 9` tests; HTTP tests check the rendered dashboard too).
3. Five wrong tries lock the code (`SEC 8`). The shop can rotate it, which
   returns nothing to the shop; the new code appears on the customer's page.
4. Orders without a customer key (taken in the shop, or placed before this
   change) can't get a network driver — the eligibility check says so.

Known limits: a customer who loses both the browser link and the email has
no code (support must cancel/return); the link is a bearer secret, so a
forwarded email gives its holder the code. SMS delivery of the code needs an
SMS provider (deferred).

## Driver source setting

A shop chooses who may deliver (`settings.fulfilment.deliverySources`: own
drivers, Skhokholetha, or both). `checkOrderEligibility` refuses a network
request for an "own drivers only" shop; `assignDriver` refuses a staff
assignment for a "Skhokholetha only" shop. Deliveries already in progress are
never affected by a change.

## Dispatch load

V1 stays poll-driven, with these safeguards (`dispatch.service.ts`):

- **One tick per 5 s, platform-wide.** Driver polls and shop page views call
  `maybeTickDispatch`, which takes a slot in the shared Postgres rate-limit
  table; every other caller in that window skips. 1,000 polling drivers
  cause one tick per 5 s, not 100 per second. The daily cron calls
  `tickDispatch` directly as a backstop.
- **Backoff per delivery.** A SEARCHING delivery with nobody nearby is
  rescanned at most every 15 s (`dispatch_attempt_at`, indexed with status).
  A round is claimed with a conditional update first, so concurrent triggers
  never both scan or both offer.
- **Batched expiry.** One `UPDATE … RETURNING … FOR UPDATE SKIP LOCKED`
  expires due offers (indexed on `(status, expires_at)`) and one
  `createMany` writes exactly one event per expired offer.
- The shop page no longer ticks once per tracked order (it was N+1).
- Unchanged and acceptable for V1: the candidate scan reads up to 200 online
  drivers with their documents per round (bounded by the backoff and the
  tick throttle); acceptance locks one delivery row with `NOWAIT`.

**Path to job-driven dispatch** (when volume needs it — not now): keep the
same service functions and move the trigger. (1) Enqueue a "dispatch round"
job on request creation and on offer expiry/decline, keyed by delivery id
for de-duplication, with a delayed job at `expiresAt`; (2) run
`runDispatch`/expiry from the job consumer instead of from polls;
(3) replace driver polling with push (web push or a WebSocket channel);
(4) add a geospatial index (PostGIS or a geohash column) to replace the
200-driver scan. The conditional updates, unique indexes and events stay
as they are, so the move doesn't change any correctness guarantee.

## Tests

| Layer | Where | Runs in |
|---|---|---|
| Pure rules (state machine, pricing, codes, eligibility, legal, flags) | `skhokholetha.test.ts`, `flags-legal.test.ts` | `npm test` |
| Database (E2E 1–6, concurrency, ledger, tenant isolation) | `skhokholetha.db.test.ts` | `npm test` (test DB) |
| Security regressions (code exposure, collusion, flags, legal gate, dispatch load) | `skhokholetha.security.db.test.ts` | `npm test` (test DB) |
| Static guard scan | `route-guards.test.ts` | `npm test` |
| Admin host routing + login destination | `src/lib/tenant/admin-host.test.ts` | `npm test` |
| **HTTP**: real `next start`, real cookies, middleware and guards | `src/http-tests/*.http.ts` | `npm run build && npm run test:http` |

Not covered at HTTP level: the shop's *server actions* (request, cancel,
rotate). Next.js server actions are addressed by build-specific action ids,
so they are tested at the service layer they call (tenant scoping, flags and
idempotency all live there), and the shop's rendered page is checked over HTTP.

## Release condition

Real drivers stay impossible until the driver terms and privacy notice are
published and configured (legal gate above) AND `DRIVER_APPROVALS_ENABLED`
is switched on. See `docs/legal-dependencies.md`.

## Deferred

Ratings, incidents beyond DISPUTED, photos/signatures, cash-on-delivery,
vehicle-class pricing, surge, batching, route optimisation, push/SMS
notifications, phone OTP, MFA for admins, automated payouts.
