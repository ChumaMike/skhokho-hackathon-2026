# Production configuration matrix

The one authoritative list of environment variables for the Skhokho
platform (Skhokho Laboratory, "Skhokho Labs"). Source of truth for
behaviour: `src/lib/env-check.ts` (classes and failure messages),
`src/instrumentation.ts` (startup refusal), `.env.example` (comments).
No values appear here — values live in Vercel project settings and in the
team vault (`docs/backup-restore.md`).

Owners: **ENG** = on-call engineer · **FIN** = finance · **OPS** =
operations lead · **FOUNDER**. Environments: **prod**, **preview** (Vercel
preview deployments against a non-production database), **local**.

## Fail-closed behaviour (verified in code)

- A missing **startup** variable on a production deployment makes the
  instance refuse to start (`instrumentation.ts` throws after logging
  `[config] FATAL`). Previews and local only warn.
- `JWT_SECRET` shorter than 32 characters is fatal in production.
- `NEXT_PUBLIC_APP_URL` must be https; without it `getAppUrl()` throws in
  production rather than trusting the Host header.
- `PAYMENT_ENCRYPTION_KEY` missing: saving merchant PayFast credentials and
  admin MFA enrolment fail loudly (`secret-box.ts` throws). No derived key.
- `CRON_SECRET` missing: every cron route returns 503; wrong: 401.
- Platform PayFast credentials missing in production: platform payments
  are `unconfigured` and refused, never the public sandbox.
- Skhokholetha switches and the external AI switch are OFF unless the
  value is exactly `true` / `enabled`.
- The sandbox domain registrar throws in production.
- The demo seed refuses to run on production or preview and needs
  `SEED_DEMO_DATA=yes` locally.

## Matrix

| Name | Purpose | Required | Secret | Environments | Safe default | Failure behaviour | Owner |
|---|---|---|---|---|---|---|---|
| `POSTGRES_PRISMA_URL` | Pooled Neon connection for the app | startup | yes | prod, preview (non-prod DB), local | none | production refuses to start | ENG |
| `POSTGRES_URL_NON_POOLING` | Direct Neon connection for `prisma migrate deploy` | startup | yes | all | none | refuses to start; migrations cannot run | ENG |
| `DATABASE_URL`, `DIRECT_URL` | Legacy aliases of the two above for tooling | no | yes | local | unset | nothing in the app reads them | ENG |
| `JWT_SECRET` | Signs every owner, staff, driver and admin session; keys recovery-code HMAC and IP hashes | startup (≥ 32 chars) | yes | all | none | refuses to start; rotation ends every session | ENG + FOUNDER (vault) |
| `NEXT_PUBLIC_APP_URL` | Public origin for email links, PayFast notify URL, redirects | startup (https) | no | all | none | refuses to start; never falls back to Host | ENG |
| `CRON_SECRET` | Bearer token Vercel Cron sends to `/api/cron/*` | startup | yes | prod, preview | none | cron routes 503; reconciliation, dispatch backstop, earnings release stop | ENG |
| `PAYMENT_ENCRYPTION_KEY` (+ `_V<n>` for rotation) | AES-256-GCM key for merchant PayFast credentials, admin MFA secrets, driver payout accounts | pilot | yes | all | none | saving credentials / MFA enrolment fail loudly; existing rows unreadable without it | ENG + FOUNDER (vault) |
| `PAYMENTS_ALLOW_LIVE_VERIFICATION` | Allows the R5 LIVE PayFast verification (stage D) | stage D | no | prod only | unset (off) | no merchant can take card payments | FIN decides, ENG sets |
| `PAYFAST_MERCHANT_ID` / `_KEY` / `_PASSPHRASE` / `PAYFAST_SANDBOX` | Skhokho Labs' own PayFast account for platform billing (not built) | no | yes | none for the pilot | unset | platform payments `unconfigured` (refused) in production | FIN |
| `RESEND_API_KEY` | Transactional email provider | pilot | yes | prod, preview | none | no emails; `email_unconfigured` alert | ENG |
| `EMAIL_FROM` | Sender on a Resend-verified domain | pilot | no | prod, preview | `Skhokho <no-reply@skhokho.app>` (must be verified) | sends rejected by Resend → `email_failed` | ENG |
| `PLATFORM_DOMAIN` | Host of the platform app | pilot | no | prod | `skhokho.sgdataint.co.za` | wrong host → 404 from middleware | ENG |
| `ADMIN_DOMAIN` | Host of the Control Centre | pilot | no | prod | `admin.<PLATFORM_DOMAIN>` | console reachable only via `/platform-admin` on the platform host | ENG |
| `STOREFRONT_DOMAIN` | Root for `<slug>.<domain>` storefronts | stage C | no | prod | unset (storefronts at `/store/<slug>`) | no subdomains; nothing breaks | ENG |
| `PLATFORM_OWNED_DOMAINS`, `PLATFORM_EXTRA_HOSTS` | Reserved hosts merchants may never claim; extra app hosts | no | no | prod | unset | only configured hosts reserved | ENG |
| `PLATFORM_ID` | Tenant routing id used by middleware | no | no | all | unset | — | ENG |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob for product, logo, banner images | pilot | yes | prod, preview | unset | uploads fail with a friendly message; nothing else | ENG |
| `GOOGLE_MAPS_API_KEY` | Server geocoding (distance pricing, Skhokholetha drop-off pin) — restrict to Geocoding API | stage C (distance) / E | yes | prod | unset | geocoding returns null: distance pricing unavailable, network requests refused "couldn't be located" | ENG |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Browser map on the tracking page — restrict by HTTP referrer | stage E | no (public, referrer-restricted) | prod | unset | tracking map does not render; text status still works | ENG |
| `SKHOKHOLETHA_ENABLED` | Master switch for the delivery network | stage B/E | no | prod | unset (off) | nothing new starts; running deliveries finish | OPS decides, ENG sets |
| `DRIVER_SIGNUP_ENABLED` | New driver accounts and applications | stage B/E | no | prod | unset | sign-up refused with a plain message | OPS / ENG |
| `DELIVERY_REQUESTS_ENABLED` | Shops may request a network driver | stage B/E | no | prod | unset | requests refused; own drivers unaffected | OPS / ENG |
| `DRIVER_APPROVALS_ENABLED` | Admins may approve / reinstate drivers | while approving | no | prod | unset | approvals refused | OPS / ENG |
| `DRIVER_TERMS_VERSION`, `DRIVER_TERMS_URL` | Current driver terms (https) — legal gate | stage B/E | no | prod | unset | no driver can accept, apply or be approved | FOUNDER (legal) / ENG |
| `DRIVER_PRIVACY_VERSION`, `DRIVER_PRIVACY_URL` | Current driver privacy notice (https) | stage B/E | no | prod | unset | as above | FOUNDER (legal) / ENG |
| `ANTHROPIC_API_KEY` | External model key | no (pilot: unset) | yes | none for the pilot | unset | every AI feature uses built-in rules | FOUNDER |
| `BUDDY_EXTERNAL_AI` | The ONE switch for every external model call (`src/lib/ai/external-ai.ts`; also the emergency AI stop) | no | no | none for the pilot | unset (off) | a key alone does nothing; every AI feature uses rules or says it is switched off | FOUNDER (legal) |
| `ANTHROPIC_*_MODEL` | Optional model overrides | no | no | — | built-in defaults | — | ENG |
| `VERCEL_DOMAINS_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | Attaching merchant custom domains to Vercel | no (pilot) | yes | prod | unset | domains can be added but never go live | ENG |
| `DOMAIN_REGISTRAR` | Domain purchase provider | no | no | none | unset | purchase not offered; `sandbox` refused in production | ENG |
| `ADMIN_SESSION_TTL`, `STAFF_SESSION_TTL`, `PLATFORM_USER_SESSION_TTL` | Session lifetimes (seconds) | no | no | all | 12 h / 7 d / 30 d | defaults apply | ENG |
| `CONSENT_VERSION` | Version stamped on loyalty consent records | no | no | all | `v1.0` | default applies | FOUNDER (legal) |
| `SEED_DEMO_DATA` | Guard for `prisma db seed` | never in prod | no | local | unset | seed refuses | ENG |
| `VERCEL_ENV`, `NODE_ENV`, `NEXT_RUNTIME` | Set by the platform; drive the fail-closed rules above | platform | no | all | — | — | — |

Monitoring: there are no monitoring-provider variables. Observability is
structured logs to Vercel, the Control Centre, and the external uptime probe
described in `docs/uptime-probe.md`, which needs no application variable.

## Pilot production set (stage C, the first real merchant)

Set: the five startup variables, `PAYMENT_ENCRYPTION_KEY`, `RESEND_API_KEY`,
`EMAIL_FROM`, `PLATFORM_DOMAIN`, `ADMIN_DOMAIN`, `STOREFRONT_DOMAIN`,
`BLOB_READ_WRITE_TOKEN`, `GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
Leave unset: everything Skhokholetha, `PAYMENTS_ALLOW_LIVE_VERIFICATION`,
`ANTHROPIC_API_KEY`, `BUDDY_EXTERNAL_AI`, `PAYFAST_MERCHANT_*`,
`VERCEL_DOMAINS_*`, `DOMAIN_REGISTRAR`.

After any change: `vercel env pull` into the vault copy, and redeploy —
Vercel applies env changes on the next deployment, so a switch is "flip +
redeploy", not instant.
