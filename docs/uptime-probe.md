# External uptime probe

The platform's own health page cannot tell anyone the platform is down. One
external check, from outside Vercel, closes that gap. No monitoring
platform is built; a hosted uptime service on its free tier is enough for
the pilot.

## What to probe

| Check | URL | Expect | Why |
|---|---|---|---|
| Liveness | `https://<PLATFORM_DOMAIN>/api/health` | HTTP 200, body exactly `{"ok":true}` | Process up and routing works. Returns no dependency state and no secrets (`src/app/api/health/route.ts`). |
| Readiness (optional, second check) | `https://<PLATFORM_DOMAIN>/api/health/ready` | HTTP 200 and body contains `"database":"up"` | Database reachable. 503 with `"database":"down"` when not. No details beyond that. |
| Storefront (stage C+) | `https://<PLATFORM_DOMAIN>/store/<pilot-slug>` | HTTP 200 and the shop name in the body | The customer-facing page renders. |

Neither health route needs authentication and neither reveals configuration
values, hostnames or versions; it is safe to hand the URLs to a third-party
checker.

## Setup checklist (any hosted checker: Better Stack, UptimeRobot, Checkly, Pingdom)

1. Create a free account under the Skhokho Labs ops email, not a personal one; enable MFA on it.
2. Add monitor **Skhokho liveness**: HTTP GET on the liveness URL, interval 1 minute (or the free-tier minimum), timeout 10 s, confirm from at least two regions, require the body to contain `"ok":true`.
3. Add monitor **Skhokho readiness**: same, 2–5 minute interval, require `"database":"up"`.
4. Alert rule: open an incident after 2 consecutive failures (avoids one-off network blips); resolve after 2 consecutive successes.
5. Notifications: push/SMS to the **on-call engineer**, email to the ops channel. Escalation: if unacknowledged for 15 minutes, notify the **engineering lead**; at 30 minutes the **FOUNDER**.
6. Status page: optional; if enabled, keep it unbranded until the Terms and Privacy Notice are published.
7. Record in `docs/pilot-operations-model.md` who holds the account and who is on the notification list.
8. Test it once: pause the production deployment in Vercel for two minutes (or probe a deliberately wrong path) and confirm the alert arrives and resolves.

## Responder and escalation

| Alert | Responder | First action | Escalate |
|---|---|---|---|
| Liveness failing | on-call engineer | `docs/runbooks.md` R2 (Vercel status → instant rollback) | lead at 15 min, FOUNDER at 30 min |
| Readiness failing, liveness fine | on-call engineer | `docs/runbooks.md` R1 (Neon status, connection limits) | lead at 15 min; merchants told at 30 min |
| Storefront failing, health fine | on-call engineer | check the business is not suspended (Control Centre › Businesses), then Vercel logs for the route | OPS tells the merchant |

## Status

Not configured yet: this repository cannot create accounts with external
services. The checklist above is the exact setup; it takes about 20 minutes
once the production domain exists.
