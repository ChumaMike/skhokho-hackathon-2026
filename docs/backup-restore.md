# Backup and restore

Status (2026-10-21): **rehearsed once, on a point-in-time branch of the
real production database** (log at the bottom). The 2026-10-20 attempt
could not run because this environment had no Neon session; on 2026-10-21
the `neon` CLI was signed in (`neon auth`, browser login as the Vercel-managed
Neon org "Vercel: SGDataint") and the full database procedure below was
executed and timed. Having backups configured is not the same as being able
to restore; this page now records that we can.

**Production Neon facts (checked 2026-10-21).** Project `dark-truth-18260408`
(console name "neon-emerald-kite" — identify it by its endpoint
`ep-odd-bird-av070t2h`, never by name), Postgres 17, `aws-us-east-1`, main
branch `br-mute-cell-avofdqzz`, about 36 MB. Plan **Free**: history
retention **6 hours**, 10 branches, fixed 0.25 CU, no protected branch, no
IP allow-list. The requirement in the table below (≥ 7 days) is **not met**
and cannot be met on the Free plan; raising it means upgrading the Neon plan
through the Vercel Marketplace (PLATFORM OWNER decision, open).

## What has to be recoverable

| Asset | Where it lives | Backup | Recovery assumption |
|---|---|---|---|
| Database (all tenants, orders, payments, drivers, audit) | Neon Postgres | Neon point-in-time restore (history retention is a Neon plan setting — **confirm it is ≥ 7 days on the production project**) | Restore = create a branch at a timestamp, verify, promote |
| Product / logo / banner images | Vercel Blob (public store) | **No independent backup.** Blob is durable object storage but a deleted blob is gone | Accept for the pilot: images are re-uploadable by the merchant. Before broader launch: a nightly copy of the store (list + download) to a second bucket |
| Driver identity documents | Database (`driver_documents.content` bytes) | Covered by the database backup | Restored with the database; access stays admin-only and audited |
| Encrypted secrets at rest (merchant PayFast credentials, admin MFA secrets) | Database, AES-256-GCM under `PAYMENT_ENCRYPTION_KEY` | Covered by the database backup — **useless without the key** | The key (and `JWT_SECRET`, `CRON_SECRET`) must be held in a password manager / secrets vault outside Vercel, with two people able to reach it |
| Environment configuration | Vercel project env vars | Not versioned by Vercel | Keep an encrypted export of production env (`vercel env pull`) in the vault after every change |
| Code | Git (GitHub) | — | Any commit redeploys from Vercel |

## RPO / RTO assumptions

| | Target | Basis |
|---|---|---|
| RPO (data loss) | ≤ 5 minutes | Neon point-in-time restore granularity; payments arriving during the gap are re-sent by PayFast (it retries non-200 responses for hours) and settle idempotently once the database is back |
| RTO (time to restore) | ≤ 2 hours for a full database restore; ≤ 10 minutes for a bad-deploy rollback | Branch + verify + repoint env + redeploy, by one engineer following this page |

Both are assumptions until the rehearsal records real numbers.

## Restore procedure (database)

1. Neon console → production project → **Restore** / create a branch from the production branch **at the target timestamp**. Name it `restore-YYYY-MM-DD-HHMM`. CLI equivalent (what the rehearsal used):
   `neon branches create --project-id dark-truth-18260408 --name restore-YYYY-MM-DD-HHMM --parent <ISO timestamp UTC>` (always pass `--org-id org-gentle-mode-61486297` to `neon projects ...`, otherwise the CLI prompts interactively and hangs).
2. Copy the branch's pooled and direct connection strings (`neon connection-string --project-id dark-truth-18260408 --branch <branch id> [--pooled]`). Run every Prisma command against the branch **from a directory outside the repo**, passing the branch URLs as environment variables and `--config <repo>/prisma.config.ts`: that config loads `.env.local` from the current directory, and inside the repo that file holds the production URLs.
3. Vercel → a **preview** deployment (never production yet): set `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING` to the branch; keep every other variable identical to production, including `PAYMENT_ENCRYPTION_KEY`.
4. Verify (next section).
5. Fail over: repoint the production env vars at the branch (or promote the branch in Neon) and redeploy production. Announce in the ops channel with the timestamp restored to.
6. After failover: Control Centre › System health — run the daily job by hand (`/api/cron/payments` first) so any PayFast notifications that arrived during the gap are reconciled.
7. Record the date, who ran it, and minutes-to-restore at the bottom of this page.

## Verification procedure

Run against the restored branch **before** failover:

- `npx prisma migrate status` → "Database schema is up to date".
- `/api/health/ready` → 200.
- Control Centre › Overview loads; business total matches the last daily pilot log.
- Control Centre › Businesses: open the pilot merchant(s); readiness still READY TO TRADE; products and zones present.
- Control Centre › Payments: the latest attempt and its provider notifications are present; one encrypted merchant connection decrypts (open Settings › Payments as the merchant on the preview, status shows VERIFIED — proves the key matches).
- Control Centre › Drivers: a driver document downloads (proves bytes restored).
- Admin sign-in with MFA works (proves MFA secrets decrypt under the key).

## Production migration-table repair (found during the rehearsal)

Every Vercel deployment since 2026-10-04 has failed with Prisma `P3009`
before building, so the live site runs a build older than PR #81. The
branch copy showed why: `_prisma_migrations` holds **two rows** for
`20261003090000_order_delivery_tracking_fields`. The first (started
2026-10-03 22:40 UTC) was marked rolled back at 07:02 and then applied at
07:26 on 2026-10-04 — a row with both timestamps set is ignored by
`migrate deploy`. The deploy at 07:30 therefore inserted a second row and
failed with `42701 column "delivery_lat" already exists`: the five columns
were already on the table. `migrate resolve --applied` answers `P3008`
(an applied row exists) and `--rolled-back` alone makes the next deploy
re-run the migration and fail the same way.

Fix, rehearsed on the branch on 2026-10-21 and to be repeated on
production with PLATFORM OWNER approval (dual approval rule, this is a
production database action outside a plain deploy):

1. The migration is now idempotent (`ADD COLUMN IF NOT EXISTS`, same
   result on a fresh database; its checksum changed, which `migrate deploy`
   does not check).
2. `prisma migrate resolve --rolled-back 20261003090000_order_delivery_tracking_fields`
   against the production direct URL (from outside the repo, as above).
3. `prisma migrate deploy` — re-runs that migration harmlessly, then applies
   the 16 migrations of PR #87 (45 s on the branch). The Vercel build runs
   this step itself on the next deployment; running it by hand first is the
   choice of whoever executes it.
4. `prisma migrate status` → "Database schema is up to date!";
   `prisma migrate diff --from-url <prod direct> --to-schema-datamodel prisma/schema.prisma`
   → "No difference detected."

Until step 2 is done, **no** deployment of any branch can succeed, and the
Preview environment, which shares the production `POSTGRES_*` values, will
attempt exactly this against production on every push.

## Rollback (code)

Vercel instant rollback is safe for every migration in this repository
(all additive), with one caveat: once a `REFUND_DUE` payment attempt exists,
a build older than migration `20261004140000` cannot read it. Migrations are
forward-only; never roll a migration back on production.

## Rehearsal log

| Date | Who | Branch | Minutes to verified restore | Notes |
|---|---|---|---|---|
| 2026-10-21 | Chuma (PLATFORM OWNER, authorised and ran the two blocked commands) with Claude Code Tab 1 | `restore-2026-10-21-1452` (`br-morning-base-avp0cvi8`, endpoint `ep-young-field-avucydji`), created 12:53 UTC from the production main branch at 12:42:57 UTC (10 minutes earlier, parent LSN `0/452A2A0`) | **31** (12:53 branch created → 13:24 health routes green; includes two permission waits) | Point-in-time branch within the 6 h window. Data on the branch matched the live site: 35 tables, 37 businesses (5 ACTIVE, 6 PENDING_VERIFICATION, 26 DEACTIVATED), 19 orders (latest 2026-10-04 06:01 UTC), 11 customers, 10 memberships. Then the full upgrade was dry-run on the branch: failed row resolved, 17 migrations applied in 45 s, 66 tables, row counts unchanged, `migrate status` up to date, `migrate diff` no difference. The production build (gate build of 2026-10-21) booted against the branch: `/api/health` 200 `{"ok":true}`, `/api/health/ready` 200 `database: up` (2.3 s), `/` 200, `/admin-login` 200. Not exercised: Control Centre sign-in, decrypt of a merchant PayFast connection and a driver document (none exist on production yet). Failover (step 5) deliberately not performed. Branch kept until production is upgraded, then delete it. Finding: history retention is 6 h (Free plan), requirement ≥ 7 days — open decision. |
