-- Reinstate `advanced_storefront` on GROW and PRO.
--
-- Decision: Chuma, 2026-10-21 14:53, chosen from two options put to him and
-- recorded in the decisions log in docs/plans/2026-10-21-status.md. It reached
-- this tab relayed by the product/coordinator tab, not direct, so the log is
-- the authority for it rather than this header.
-- Supersedes the withdrawal of this one key in 20261022110000_platform_billing
-- _phase_a. The other four keys withdrawn there (advanced_staff, advanced_ai,
-- multi_location, advanced_business_insights) stay withdrawn.
--
-- Why this key comes back when the other four do not: Phase A withdrew all
-- five because they had ZERO enforcement sites and every FREE business already
-- had them, so they could not honestly be sold. That is no longer true here.
-- The storefront-websites tab built four customer workflows — quote request,
-- enquiry, pickup request and callback — together with their pages, the ENQUIRE
-- action and the Enquiries inbox, and gated them on this key. It now has a real
-- enforcement site, which is exactly the condition Phase A's own comment set
-- for granting it again ("the day the features genuinely exist and are
-- enforced"), and the condition in docs/specs/2026-10-21-plans.md §2.1.
--
-- A separate migration rather than an edit to Phase A: that migration is
-- already applied to this branch's test database and to the integration
-- database, so editing it would leave applied history diverging from the file.
--
-- Idempotent. plan_entitlements_plan_id_feature_key_key is a unique index on
-- (plan_id, feature_key), so the conflict target is exact and a re-run changes
-- nothing — the same ON CONFLICT form 20261004130000 uses for these rows.

INSERT INTO "plan_entitlements" ("id", "plan_id", "feature_key", "enabled", "limit_value") VALUES
  ('pe_grow_advanced_storefront', 'plan_grow', 'advanced_storefront', true, NULL),
  ('pe_pro_advanced_storefront',  'plan_pro',  'advanced_storefront', true, NULL)
ON CONFLICT ("plan_id", "feature_key") DO NOTHING;
