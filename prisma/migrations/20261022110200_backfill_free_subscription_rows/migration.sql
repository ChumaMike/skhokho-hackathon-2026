-- Give every business a business_subscriptions row, so none is the odd one out.
--
-- Raised by the Production bring-up tab: on the production copy one live store
-- (Beauty by Nomsa) has NO business_subscriptions row at all, while the other
-- 36 are plan_free / ACTIVE.
--
-- WHAT WAS ALREADY FINE. A business with no row resolves to the default plan
-- with state NO_SUBSCRIPTION (entitlements.ts subscriptionAccess: a null
-- subscription returns NO_SUBSCRIPTION, and resolveEntitlements then grants the
-- default plan). So entitlements, limit enforcement, Settings › Plan, the
-- Control Centre billing page, the nightly cron and the whole customer-facing
-- storefront and checkout path all already behave exactly as FREE. Nothing was
-- broken and no merchant was denied anything.
--
-- WHY BACKFILL ANYWAY. One owner-facing control is a dead end without a row:
-- the billing-email form on Settings › Plan does an UPDATE and, finding no row,
-- honestly reports "There's no billing account to update yet" (plan/actions.ts
-- checks updated.count === 0 rather than claiming a false success). That owner
-- could never set a billing address. The Phase A billing_email backfill
-- (20261022110000) is an UPDATE over business_subscriptions too, so it skips
-- that business entirely — leaving it the only store with no billing email.
--
-- WHY THIS IS INERT. current_period_end is deliberately left NULL:
--   * generateRenewalDrafts selects `currentPeriodEnd: { not: null, lte: horizon }`,
--     so a NULL-period row is never picked up and no invoice is ever drafted.
--   * draftInvoiceForPeriod raises NothingToInvoiceError on a zero total anyway
--     (FREE is 0 and these businesses have no add-ons), and the caller skips it.
--   * Dunning and grace are driven by invoices, of which there are none.
--   * The granted entitlements are identical either way: FREE before, FREE after.
-- The only visible change is the plan page's status line, which moves from
-- "You're on the Free plan." to "Active." — which is what the other 36 free
-- businesses already show, so this makes the set consistent rather than odd.
--
-- Idempotent twice over: the NOT EXISTS guard and the unique index on
-- business_id. Deterministic ids ('bs_' || business id) so a re-run is
-- traceable and cannot create a second row for the same business.

INSERT INTO "business_subscriptions" (
  "id", "business_id", "plan_id", "status", "current_period_end", "billing_email", "updated_at"
)
SELECT
  'bs_' || b."id"::text,
  b."id",
  'plan_free',
  'ACTIVE',
  NULL,
  au."email",
  CURRENT_TIMESTAMP
  FROM "businesses" b
  LEFT JOIN "app_users" au ON au."id" = b."auth_user_id"
 WHERE NOT EXISTS (
         SELECT 1 FROM "business_subscriptions" bs WHERE bs."business_id" = b."id"
       )
ON CONFLICT ("business_id") DO NOTHING;
