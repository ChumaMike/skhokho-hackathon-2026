-- SaaS plans, subscriptions & entitlements.
--
-- Additive only: new tables + nullable/defaulted columns, then a seed of the
-- three proposed plans and a backfill of existing subscriptions. The legacy
-- business_subscriptions columns (plan, has_*, max_*, is_active, end_date)
-- are left in place, unread, for a later release to drop.
--
-- Paid prices are NULL on purpose: pricing is a commercial decision not
-- yet made (FREE is 0 by definition). Packaging below mirrors today's behaviour wherever a feature exists
-- (loyalty and the AI buddy are live for every business, so FREE keeps
-- them); flipping either is a one-row UPDATE on plan_entitlements.

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'YEARLY');

-- AlterTable
ALTER TABLE "business_subscriptions" ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "current_period_end" TIMESTAMP(3),
ADD COLUMN     "grace_ends_at" TIMESTAMP(3),
ADD COLUMN     "plan_id" TEXT,
ADD COLUMN     "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "price_cents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "billing_interval" "BillingInterval",
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_entitlements" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "feature_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limit_value" INTEGER,

    CONSTRAINT "plan_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entitlement_overrides" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "feature_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "limit_value" INTEGER,
    "reason" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlement_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plan_entitlements_plan_id_feature_key_key" ON "plan_entitlements"("plan_id", "feature_key");

-- CreateIndex
CREATE UNIQUE INDEX "entitlement_overrides_business_id_feature_key_key" ON "entitlement_overrides"("business_id", "feature_key");

-- CreateIndex
CREATE INDEX "business_subscriptions_plan_id_idx" ON "business_subscriptions"("plan_id");

-- Exactly one default plan (Prisma can't express a partial unique index).
CREATE UNIQUE INDEX "plans_single_default_key" ON "plans"("is_default") WHERE "is_default";

-- AddForeignKey
ALTER TABLE "business_subscriptions" ADD CONSTRAINT "business_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Seed: proposed packaging (prices NULL — not yet priced). Idempotent.
-- ---------------------------------------------------------------------------

INSERT INTO "plans" ("id", "code", "name", "tagline", "price_cents", "billing_interval", "is_default", "is_public", "sort_order", "updated_at") VALUES
  ('plan_free', 'FREE', 'Free', 'Everything you need to start selling online.', 0, NULL, true, true, 10, CURRENT_TIMESTAMP),
  ('plan_grow', 'GROW', 'Grow', 'A richer shopfront, deeper insights and a bigger team.', NULL, 'MONTHLY', false, true, 20, CURRENT_TIMESTAMP),
  ('plan_pro', 'PRO', 'Pro', 'Your own .co.za address and the most advanced tools.', NULL, 'MONTHLY', false, true, 30, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "plan_entitlements" ("id", "plan_id", "feature_key", "enabled", "limit_value") VALUES
  -- FREE: a genuinely usable business. Storefront, subdomain, catalogue,
  -- orders, customers and AI-assisted storefront creation are core product
  -- for everyone and need no entitlement row.
  ('pe_free_basic_analytics', 'plan_free', 'basic_analytics', true, NULL),
  ('pe_free_loyalty', 'plan_free', 'loyalty', true, NULL),
  ('pe_free_ai_business_buddy', 'plan_free', 'ai_business_buddy', true, NULL),
  ('pe_free_max_staff', 'plan_free', 'max_staff', true, 2),
  ('pe_free_max_products', 'plan_free', 'max_products', true, 50),
  ('pe_free_max_services', 'plan_free', 'max_services', true, 10),
  -- GROW
  ('pe_grow_basic_analytics', 'plan_grow', 'basic_analytics', true, NULL),
  ('pe_grow_advanced_analytics', 'plan_grow', 'advanced_analytics', true, NULL),
  ('pe_grow_advanced_storefront', 'plan_grow', 'advanced_storefront', true, NULL),
  ('pe_grow_advanced_staff', 'plan_grow', 'advanced_staff', true, NULL),
  ('pe_grow_loyalty', 'plan_grow', 'loyalty', true, NULL),
  ('pe_grow_ai_business_buddy', 'plan_grow', 'ai_business_buddy', true, NULL),
  ('pe_grow_max_staff', 'plan_grow', 'max_staff', true, 5),
  ('pe_grow_max_products', 'plan_grow', 'max_products', true, 200),
  ('pe_grow_max_services', 'plan_grow', 'max_services', true, 25),
  -- PRO
  ('pe_pro_basic_analytics', 'plan_pro', 'basic_analytics', true, NULL),
  ('pe_pro_advanced_analytics', 'plan_pro', 'advanced_analytics', true, NULL),
  ('pe_pro_advanced_storefront', 'plan_pro', 'advanced_storefront', true, NULL),
  ('pe_pro_advanced_staff', 'plan_pro', 'advanced_staff', true, NULL),
  ('pe_pro_custom_domain', 'plan_pro', 'custom_domain', true, NULL),
  ('pe_pro_loyalty', 'plan_pro', 'loyalty', true, NULL),
  ('pe_pro_ai_business_buddy', 'plan_pro', 'ai_business_buddy', true, NULL),
  ('pe_pro_advanced_ai', 'plan_pro', 'advanced_ai', true, NULL),
  ('pe_pro_multi_location', 'plan_pro', 'multi_location', true, NULL),
  ('pe_pro_max_staff', 'plan_pro', 'max_staff', true, 20),
  ('pe_pro_max_products', 'plan_pro', 'max_products', true, 500),
  ('pe_pro_max_services', 'plan_pro', 'max_services', true, 100)
ON CONFLICT ("plan_id", "feature_key") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Backfill existing subscriptions onto the new plans.
-- STARTER → GROW, PROFESSIONAL/ENTERPRISE → PRO. No code path ever set a
-- non-FREE plan, so in practice only manually edited rows are affected.
-- ---------------------------------------------------------------------------

UPDATE "business_subscriptions" SET
  "plan_id" = CASE "plan"
    WHEN 'STARTER' THEN 'plan_grow'
    WHEN 'PROFESSIONAL' THEN 'plan_pro'
    WHEN 'ENTERPRISE' THEN 'plan_pro'
    ELSE 'plan_free'
  END,
  "status" = CASE WHEN "is_active" THEN 'ACTIVE'::"SubscriptionStatus" ELSE 'EXPIRED'::"SubscriptionStatus" END,
  "current_period_end" = "end_date"
WHERE "plan_id" IS NULL;
