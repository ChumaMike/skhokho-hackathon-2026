# Skhokho Platform

Multi-tenant platform for South African businesses — self-registration, customer
identity, loyalty and operations (orders, bookings, products, services, inventory).

Extracted from `ChumaMike/skhokho-labs` on 2026-08-02. The **agency** product
(marketing site, client dashboard, staff intranet, 9-agent build factory) stays
in that repo and is not part of this app.

## Purpose

Give a South African business a place to register itself and track its own
customers and loyalty, without the agency doing the work for them. P1 is the
extraction only: the app builds and carries the full data layer, but just
`/join` and `/r/[slug]` are wired. Tenant UI, the backend port and the showcase
are P2–P4. Graduation record:
`docs/engineering/tool-graduation/skhokho-platform.md`.

## Owners

- **Business owner:** Chuma Meyiswa — nmeyiswa@gmail.com
- **Technical owner:** Chuma Meyiswa — nmeyiswa@gmail.com
- **Owning business unit:** Agentive Labs (incubated product).

Both roles are held by one person. That satisfies Normative Rule 2, which
requires the roles to be named rather than separate, but it means production
approval is a single signature and there is no second person to escalate to.
See the graduation record's Purpose and Ownership section.

**Run `gh auth switch --user Chuma-SG` before pushing this workspace** to
`SGDataInt/sg-os`. The agency product in `ChumaMike/skhokho-labs` uses
`ChumaMike`, and each repo is invisible to the other's account — the wrong
active account fails with a misleading "Repository not found".

Pinning the account into the remote URL does **not** work: the `gh` credential
helper supplies the active account's token regardless of the URL username.
Switching before pushing is the only working procedure.

## Support Status

**Incubation — not supported.** No SLA, no on-call, no production deployment.
Not client-facing. Escalation route is the technical owner above.

## Dependencies

Next.js 15 · React 19 · Prisma 6 · Neon Postgres · `jose` + `bcryptjs` JWT auth · `zod`

No `@skhokho/*` and no SGOS workspace packages. The app is deliberately
self-contained at P1 — see the graduation record's Placement Decision for what
was retained in-product and why.

## Environment Variables

Names only; values live in Vercel and a local `.env`. See `.env.example`.

| Name | Purpose |
|---|---|
| `POSTGRES_PRISMA_URL` | Neon pooled connection — runtime queries |
| `POSTGRES_URL_NON_POOLING` | Neon direct connection — migrations and DDL |
| `DATABASE_URL` / `DIRECT_URL` | Legacy aliases for tooling that expects them |
| `JWT_SECRET` | Signs session tokens (`jose`) |
| `ADMIN_SESSION_TTL` | Admin session lifetime, seconds |
| `STAFF_SESSION_TTL` | Business-staff session lifetime, seconds |
| `PLATFORM_USER_SESSION_TTL` | Owner session lifetime, seconds |
| `PLATFORM_DOMAIN` | Apex host for tenant routing — **not active at P1** |
| `ADMIN_DOMAIN` | Admin host for tenant routing — **not active at P1** |
| `PLATFORM_ID` | Platform instance identifier |
| `CONSENT_VERSION` | POPIA consent wording version stamped on consents |

## Local Verification

    cp .env.example .env
    pnpm install                                          # from the sg-os root
    pnpm --filter skhokho-platform db:generate
    pnpm --filter skhokho-platform typecheck
    pnpm turbo run build --filter=skhokho-platform        # from the sg-os root
    pnpm --filter skhokho-platform dev                    # port 3002

## POPIA

Cross-business customer linking ships **dark behind a feature flag** until the
Information Regulator grants s57 prior authorisation. The global Skhokho ID is
never exposed to a business — they see only the pairwise membership `public_id`
and short code. See `docs/legal/`.
