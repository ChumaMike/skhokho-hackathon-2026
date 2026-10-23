# Splitting Skhokho Labs into two products — design

**Date:** 2026-08-02 · **Status:** approved (P1 scope) · **Owner:** Chuma Meyiswa

Related: [`2026-07-14-customer-platform-design.md`](./2026-07-14-customer-platform-design.md) ·
SG-OS [`docs/engineering/TOOL-GRADUATION-STANDARD.md`](../../../../SG/SG-OS/sg-os/docs/engineering/TOOL-GRADUATION-STANDARD.md)

---

## 1. The problem

Skhokho Labs is currently **two different products living in one folder and one git repo, separated
only by a branch**.

| | A. Live agency product | B. Platform |
|---|---|---|
| Location | branch `main`, `ChumaMike/skhokho-labs` → skhokholabs.xyz | branch `feat/neon-platform-migration`, 29 commits ahead |
| What it is | AI automation studio + 9-agent build factory. Clients get sites built *for* them. | Multi-tenant platform. Businesses self-register and run their own customers/loyalty/operations. |
| Database | Supabase (Postgres + Auth + RLS), 56 migrations applied live | Neon + Prisma, unified `prisma/schema.prisma` (~30 models) + SQL identity layer |
| Auth | Supabase magic link | Custom JWT (`jose` + `bcrypt`), `AppUser` table |
| UI | 324 files — marketing, client dashboard, staff intranet, agent portal | 4 files — `/join`, `/r/[slug]`, 2 API routes |
| Deployed | yes, live | never |

### Why this is urgent, not cosmetic

1. **The 29 platform commits have never been pushed.** The branch's upstream is
   `origin/feat/neon-platform-migration` — i.e. **ChumaMike/skhokho-labs**, the personal repo, the
   opposite of the recorded decision. `SG-DataInt/skhokho-platform` and `SGDataInt/skhokho-platform`
   both return *"Repository not found"*. All of it exists on one laptop.
2. **`.vercel/project.json` in the labs folder points at `skhokho-platform`**
   (`team_8psMCkVzmCti7dUkhwEV4FnW`), not the live labs project. Any `vercel` command run from the
   labs folder targets the wrong project. (`.vercel` is gitignored, so it has not spread.)
3. **Untracked platform work:** `apps/web/src/app/api/platform/`, `/join`, `/r`,
   `prisma/migrations/` are not in git at all.
4. Both products share `apps/web`, `packages/*`, `prisma/`, `supabase/`. Prisma+Neon and Supabase
   sit in the same `package.json`. They will conflict on every merge.

---

## 2. Decisions taken

| Decision | Choice |
|---|---|
| Where the platform lives | **Inside the sg-os monorepo**, at `business-units/agentive-labs/repos/skhokho-platform` |
| What moves | The **full** Skhokho platform — backend especially — with a tenant-facing UI carrying skhokholabs' polish |
| Build factory in the platform? | **No.** The showcase surfaces what a tenant can get; picking something **files an enquiry into the owner's approvals queue**. The 9-agent factory stays in labs. |
| The labs folder | **Cleaned in place** — stays the live-agency folder on `main` |

### Why `business-units/agentive-labs/repos/`

Agentive Labs owns "idea intake, rapid prototyping, and internal product incubation… through
incubation, investment, and governed spin-out". `repos/` already hosts five self-contained apps
(`bantcolon`, `bantmarketplace`, `corporate-website`, `lightenmusic`, `sg-labs`) as
`pnpm-workspace.yaml` members. `sg-labs` there is the SGDataInt marketing site, **not** Skhokho, so
the name `skhokho-platform` is free.

This satisfies the Tool Graduation Standard's intent — *independent deployment, shared platform*:
own Vercel project and release cadence later (P5), while staying in the Group monorepo and
consuming shared capability.

---

## 3. Scope — P1 only

This spec covers **P1: the split**. It adds **no features**. Its entire job is that nothing is lost,
the live site is never at risk, and both folders build.

| | Sub-project | Spec |
|---|---|---|
| **P1** | **The split** — two clean folders, platform imported into sg-os with history, builds green | **this document** |
| P2 | Backend port — labs backend → Prisma/Neon (customers, loyalty, orders, bookings, products, services, inventory, WhatsApp agent, metrics) | later |
| P3 | Tenant UI — skhokholabs polish, tenant-facing | later |
| P4 | Showcase catalogue → enquiry → owner approvals queue | later |
| P5 | Graduation — own Vercel project, domain, env, graduation record | later |

**Explicitly out of scope for P1:** any new feature, any schema change, any deploy, any change to the
live Supabase database or the live Vercel project, wiring the ported agent/shared modules.

---

## 4. Step 0 — back up before touching anything

The 29 commits are unpushed. Before any move or delete:

1. **Commit the untracked platform files** on `feat/neon-platform-migration`:
   `apps/web/src/app/api/platform/`, `app/join/`, `app/r/`, `prisma/migrations/`,
   `.claude/skills/neon`, `.claude/skills/neon-postgres`, `skills-lock.json`.
2. **Commit the working-tree modifications as a separate, clearly-labelled commit.** These five
   files are **live-agency work, not platform work** — a preview-URL plumbing fix
   (`preview_url` was written to `agent_projects` but every client-facing surface reads
   `client_journeys.preview_url`, so good deploys still showed "Preview not ready yet"):
   `apps/api/src/lib/journey-sync.ts`, `apps/api/src/lib/preview-deploy.ts`,
   `apps/api/src/routes/agent-projects.ts`,
   `apps/web/src/app/dashboard/projects/[id]/ProjectDetailClient.tsx`, `.gitignore`.
   Keeping them in their own commit is what makes step §5.2 possible.
3. **Leave the remaining untracked labs files alone** — `mint-pitch/`, `.agents/`,
   `docs/superpowers/plans/2026-07-29-factory-to-revenue-90-days.md`,
   `docs/superpowers/specs/2026-07-29-mint-group-pitch-design.md`. They are labs business work,
   they are untracked so `git checkout main` will not disturb them, and committing them is a
   separate decision outside this spec.
4. `git push origin feat/neon-platform-migration`.

Pushing a branch touches neither `main` nor the live deploy. It is pure insurance and it must happen
first.

---

## 4b. The branch is a three-way stack — this is what makes the split clean

`feat/neon-platform-migration` is not one effort. It is three, stacked, and the boundary is already
branch-marked:

| Segment | Commits | What it is | Destination |
|---|---|---|---|
| `main..feat/customer-platform-spec` | 15 (→ `5ccf8e8`) | Customer identity foundation, Supabase | labs |
| `…..feat/customer-crm` | 22 total (→ `a77845a`) | + Customers tab, WhatsApp owner customer commands, API routes, rate limiter | labs |
| `a77845a..33ef7f7` | 7 | **Neon platform migration** — Prisma schema, identity SQL, service layer, seed | **sg-os** |

**The first 22 commits are live-product work that was never merged.** `docs/STATUS.md` records them
green: shared 10/10, api 18/18, agents 13/13, typechecks clean; only the pgTAP run is pending Docker.
`feat/customer-crm` already exists as a local branch pointing exactly at `a77845a`.

Consequences:

- **The platform import is `a77845a..33ef7f7` only — 33 files, 6,714 insertions.** Not the 58-file
  diff against `main`.
- **`feat/customer-crm` is kept, not deleted.** It goes to labs as a normal PR to `main` on its own
  schedule. Nothing about it is port-source material.
- The Supabase migrations (`20260714000001_customer_identity.sql`,
  `20260714000002_migrate_loyalty_stamps.sql`), `packages/agents/src/tools/customer-tools.ts`, the
  `owner-assistant.ts` delta and the `packages/shared` deltas **all belong to that labs branch** and
  are not touched by the extraction.

---

## 5. Folder A — `Skhokhos/labs` (live agency)

Stays `ChumaMike/skhokho-labs`, branch `main`, deploying to skhokholabs.xyz. Unchanged as a product.

After the platform extraction is verified:

1. `git checkout main`. Of the 58 changed files, most are new additions that simply disappear; a
   handful (`package.json`, `pnpm-lock.yaml`, `docs/STATUS.md`, `packages/agents/*`,
   `packages/shared/*` — the 61 deletions in the diffstat) are **modifications to files that exist
   on main**, and checking out main reverts those to their live-agency state. That is the intent:
   Prisma, Neon and the customer-tools deltas leave the labs package graph entirely.
2. **Recover the live-agency fix.** Cherry-pick the Step 0.2 commit onto a branch off `main`
   (`fix/preview-url-plumbing`) so the preview-URL work is not stranded on a deleted platform
   branch. It is a genuine bug fix for the live product and belongs in labs.
3. Remove the untracked platform directories now that they are committed and imported:
   `apps/web/src/app/api/platform/`, `apps/web/src/app/join/`, `apps/web/src/app/r/`,
   `prisma/migrations/`.
4. Delete `.vercel/` so this folder cannot deploy to the wrong project. Re-link with the `ChumaMike`
   account when next needed.
5. Delete the local `feat/neon-platform-migration` branch — **only after** the sg-os import is
   verified and pushed *and* step 2 has landed. The backup from Step 0 remains on `origin`
   regardless.

**`feat/customer-crm` and `feat/customer-platform-spec` are kept.** They are 22 commits of live-product
Supabase work (customer identity, Customers tab, WhatsApp owner commands, API routes, rate limiter)
that were never merged. They stay as labs branches and go to `main` through a normal PR on their own
schedule. This spec does not touch them, and deleting `feat/neon-platform-migration` does not
endanger them — it is a descendant, so its parents survive independently.

We never touch Supabase or the ChumaMike Vercel project. The live site is untouched end to end.

**Note:** `gh` is currently active as `Chuma-SG`. Per `CLAUDE.md`, any labs issue/PR work needs
`gh auth switch --user ChumaMike` first.

---

## 6. Folder B — `sg-os/business-units/agentive-labs/repos/skhokho-platform`

A self-contained Next.js 15 app, package name `skhokho-platform`, added to sg-os's root
`pnpm-workspace.yaml` — the same pattern its siblings follow. Gets its own `AGENTS.md` and
`CLAUDE.md`.

### 6.1 Imported and wired — must build

The complete manifest — every file added by `a77845a..33ef7f7`, plus the four untracked directories:

| Source (labs) | Destination (platform) |
|---|---|
| `prisma/schema.prisma` (739 lines) | `prisma/schema.prisma` |
| `prisma/sql/00_functions.sql`, `10_identity_rpcs.sql`, `identity_layer.sql` | `prisma/sql/` |
| `prisma/seed.ts`, `prisma/migrations/` *(untracked)* | `prisma/` |
| `apps/web/src/lib/auth/guards.ts` | `src/lib/auth/guards.ts` |
| `apps/web/src/lib/prisma/client.ts`, `tenant-client.ts` | `src/lib/prisma/` |
| `apps/web/src/lib/tenant/context.ts` | `src/lib/tenant/context.ts` |
| `apps/web/src/modules/auth/auth.service.ts` | `src/modules/auth/` |
| `apps/web/src/modules/customers/customer.service.ts` | `src/modules/customers/` |
| `apps/web/src/modules/inventory/inventory.service.ts` | `src/modules/inventory/` |
| `apps/web/src/modules/orders/order.service.ts` | `src/modules/orders/` |
| `apps/web/src/modules/tenant/tenant.service.ts` | `src/modules/tenant/` |
| `apps/web/src/types/index.ts` | `src/types/index.ts` |
| `apps/web/src/app/join/`, `app/r/[slug]/`, `app/api/platform/` *(untracked)* | `src/app/` |
| `docs/legal/` (s57 application, consent wording) | `docs/legal/` |
| `docs/research/2026-07-14-*`, the customer-platform spec + plans, this spec | `docs/` |

**`apps/web/src/lib/utils.ts` is a modification, not an addition** — on `main` it is the labs
`cn()` helper; the platform phase appended nine independent helpers. Only the added block moves, as
a new file `src/lib/utils.ts`: `slugify`, `generateOrderNumber`, `formatZAR`, `formatCents`,
`normalizeSAPhone`, `formatSAPhone`, `ok`, `fail`, `handleApiError`. Extract with
`git diff a77845a..33ef7f7 -- apps/web/src/lib/utils.ts`. The labs copy is left untouched.

**Config is synthesized, not copied** — the platform app needs its own `package.json`,
`next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `src/app/layout.tsx` and
`src/app/globals.css`. Labs' equivalents carry `transpilePackages`, `@skhokho/*` workspace deps,
three.js/leaflet/recharts and 20 marketing redirects — none of which the platform has any use for.
The root `package.json` Prisma scripts (`db:validate`/`generate`/`push`/`migrate`/`deploy`/`seed`/
`studio`) and the 10 added `.env.example` keys (`DATABASE_URL`, `DIRECT_URL`, `PLATFORM_DOMAIN`,
`ADMIN_DOMAIN`, `PLATFORM_ID`, `JWT_SECRET`, `ADMIN_SESSION_TTL`, `STAFF_SESSION_TTL`,
`PLATFORM_USER_SESSION_TTL`, `CONSENT_VERSION`) do move.

Note `/join` and `/r/[slug]` currently render inside the labs root layout, which is not imported.
Giving the platform its own minimal root layout is P1 work, not P3 — without it the app cannot
build.

### 6.2 Imported as reference, not wired — `docs/port-source/`

Two files, copied verbatim with a README stating provenance and what later phases must do:

- `supabase/tests/customer_identity_test.sql` — the pgTAP suite. The only executable proof of
  pairwise-ID isolation and append-only visits; porting it to Neon is a **P2** deliverable. It is
  reference here and simultaneously stays live on `feat/customer-crm` as part of the labs feature.
- `apps/web/src/middleware.kasi.ts` — the Kasi tenant-routing middleware. **It must not be
  activated in P1.** It rewrites every non-static request by hostname zone to `/platform-admin/…`,
  `/tenant/…` or `/marketing/…`, and none of those route groups exist in the platform app yet — the
  only pages are `/join` and `/r/[slug]`, neither of which is in its `PUBLIC_PATHS` exemption set.
  Dropping it in as `src/middleware.ts` would 404 the entire working surface. It gets wired in
  **P3**, once the tenant route groups exist, along with a decision on `PLATFORM_DOMAIN` (it
  currently defaults to `kasi.co.za`).

### 6.3 Not imported

Studio marketing / client dashboard / staff intranet UI · Supabase clients · the Hono API app ·
the 9-agent build factory · `agent-org/`.

**`plugPrisma/` is dropped** — a staging drop already reconciled into `prisma/schema.prisma`.

### 6.4 History

**Decided: plain file copy.** A `git filter-repo` path-filtered import was considered and rejected —
it would rewrite paths across three stacked branches whose boundary sits *mid-file* in
`apps/web/src/lib/utils.ts` (a modification, not an addition), for provenance that is a convenience
here rather than a requirement.

Provenance is preserved by three cheaper means: the backup branch `origin/feat/neon-platform-migration`
is never deleted; the sg-os commit messages name what moved and from where; and the labs `STATUS.md`
entry records the split with the commit range. Per-file `git blame` in sg-os can be reconstructed
from the backup branch if it ever proves necessary.

---

## 7. POPIA constraint (carries across unchanged)

The cross-business linking layer stays **dark behind a feature flag** until the Information Regulator
grants s57 prior authorisation. The global Skhokho ID is never exposed to a business — they see only
the pairwise membership `public_id` / short code. Per-business loyalty and CRM are not gated. The
split must not alter this; the s57 drafts move with the platform.

---

## 8. Done when

- [ ] `feat/neon-platform-migration` pushed to `origin`, with the untracked platform files and the
      live-agency preview-URL fix committed as two distinct commits
- [ ] `repos/skhokho-platform` present in sg-os and listed in root `pnpm-workspace.yaml`
- [ ] Platform folder: `pnpm build` clean, `pnpm typecheck` clean, `prisma validate` clean
- [ ] `pnpm install` at the sg-os root still succeeds with the new workspace member
- [ ] `docs/port-source/README.md` accounts for every unwired file and its P2 destination
- [ ] Labs folder on `main`: builds clean, no platform files, no `.vercel/`
- [ ] Preview-URL fix cherry-picked onto `fix/preview-url-plumbing` off `main`
- [ ] `feat/customer-crm` and `feat/customer-platform-spec` still present and unmodified
- [ ] Local platform branch deleted only after every bullet above passes
- [ ] Live skhokholabs.xyz still serving — verified by request, not assumption
- [ ] No change made to the live Supabase database or the ChumaMike Vercel project

## 9. Risks

| Risk | Mitigation |
|---|---|
| Unpushed work lost during the move | Step 0 pushes the branch before anything is moved or deleted |
| Deploying labs to the wrong Vercel project | `.vercel/` deleted from the labs folder in step A.3 |
| Platform import breaks sg-os's workspace install | Platform is self-contained with its own `package.json`; verify `pnpm install` at sg-os root after adding the workspace entry |
| Deleting the labs branch too early | Explicitly gated behind a verified, pushed sg-os import |
| Ported agent/shared modules half-wired | They land in `docs/port-source/`, not `src/` |
| Live-agency preview-URL fix stranded on the deleted branch | Committed separately in Step 0.2, cherry-picked onto `main` in §5.2, and gated in "Done when" |
