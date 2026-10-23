-- Content & Marketing foundation + AI usage accounting (additive).
--
-- New tables: ai_usage_events (every external model call, never the prompt
-- or answer), content_campaigns, content_drafts. New audit category
-- MERCHANT_ACTION for a merchant's own meaningful actions.
--
-- Packaging (data, not code): the content studio, AI writing and campaigns
-- are granted to GROW and PRO; the calendar and business insights to PRO.
-- Every plan gets a monthly AI generation allowance so the existing
-- Ask Skhokho assistant keeps working under the external-AI switch:
-- FREE 20, GROW 150, PRO 500. Prices are untouched (still NULL for paid
-- plans). Changing any of this later is an UPDATE on plan_entitlements or
-- a per-business entitlement_overrides row — no code change.

-- CreateEnum
CREATE TYPE "AiActorType" AS ENUM ('STAFF', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AiUsageOutcome" AS ENUM ('OK', 'FAILED', 'TIMEOUT', 'REJECTED_OUTPUT', 'BLOCKED_DISABLED', 'BLOCKED_ENTITLEMENT', 'BLOCKED_ALLOWANCE', 'BLOCKED_RATE_LIMIT');

-- CreateEnum
CREATE TYPE "ContentDraftType" AS ENUM ('SOCIAL_POST', 'CAPTION', 'STATUS', 'PROMO', 'PRODUCT_DESCRIPTION', 'PRODUCT_TITLE', 'GENERAL');

-- CreateEnum
CREATE TYPE "ContentChannel" AS ENUM ('GENERAL', 'INSTAGRAM', 'FACEBOOK', 'WHATSAPP_STATUS', 'TIKTOK_CAPTION');

-- CreateEnum
CREATE TYPE "ContentDraftStatus" AS ENUM ('DRAFT', 'READY', 'PUBLISHED_MANUALLY', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContentSourceType" AS ENUM ('BUSINESS', 'PRODUCT', 'CATEGORY', 'OFFER', 'CUSTOM', 'INSIGHT');

-- CreateEnum
CREATE TYPE "ContentCampaignStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- AlterEnum
ALTER TYPE "AuditCategory" ADD VALUE 'MERCHANT_ACTION';

-- CreateTable
CREATE TABLE "ai_usage_events" (
    "id" TEXT NOT NULL,
    "business_id" UUID,
    "actor_type" "AiActorType" NOT NULL,
    "actor_id" TEXT,
    "feature" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "metered" BOOLEAN NOT NULL DEFAULT true,
    "provider" TEXT NOT NULL DEFAULT 'anthropic',
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost_usd_micros" INTEGER,
    "outcome" "AiUsageOutcome" NOT NULL,
    "duration_ms" INTEGER,
    "error_class" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_campaigns" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "product_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "notes" TEXT,
    "status" "ContentCampaignStatus" NOT NULL DEFAULT 'PLANNED',
    "created_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_drafts" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "created_by_staff_id" TEXT,
    "type" "ContentDraftType" NOT NULL,
    "channel" "ContentChannel" NOT NULL DEFAULT 'GENERAL',
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "ContentDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "source_type" "ContentSourceType" NOT NULL DEFAULT 'CUSTOM',
    "source_id" TEXT,
    "campaign_id" TEXT,
    "planned_for" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "ai_usage_event_id" TEXT,
    "request_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_events_idempotency_key_key" ON "ai_usage_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "ai_usage_events_business_id_created_at_idx" ON "ai_usage_events"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_usage_events_created_at_idx" ON "ai_usage_events"("created_at");

-- CreateIndex
CREATE INDEX "ai_usage_events_outcome_created_at_idx" ON "ai_usage_events"("outcome", "created_at");

-- CreateIndex
CREATE INDEX "content_campaigns_business_id_status_idx" ON "content_campaigns"("business_id", "status");

-- CreateIndex
CREATE INDEX "content_campaigns_business_id_created_at_idx" ON "content_campaigns"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "content_drafts_request_key_key" ON "content_drafts"("request_key");

-- CreateIndex
CREATE INDEX "content_drafts_business_id_status_created_at_idx" ON "content_drafts"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "content_drafts_business_id_planned_for_idx" ON "content_drafts"("business_id", "planned_for");

-- CreateIndex
CREATE INDEX "content_drafts_campaign_id_idx" ON "content_drafts"("campaign_id");

-- AddForeignKey
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_campaigns" ADD CONSTRAINT "content_campaigns_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "content_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Plan entitlements for the content studio and AI allowances.
-- ---------------------------------------------------------------------------
INSERT INTO "plan_entitlements" ("id", "plan_id", "feature_key", "enabled", "limit_value") VALUES
  ('pe_free_ai_generations_monthly', 'plan_free', 'ai_generations_monthly', true, 20),
  ('pe_grow_content_studio', 'plan_grow', 'content_studio', true, NULL),
  ('pe_grow_content_generation', 'plan_grow', 'content_generation', true, NULL),
  ('pe_grow_content_campaigns', 'plan_grow', 'content_campaigns', true, NULL),
  ('pe_grow_ai_generations_monthly', 'plan_grow', 'ai_generations_monthly', true, 150),
  ('pe_grow_content_campaigns_monthly', 'plan_grow', 'content_campaigns_monthly', true, 10),
  ('pe_pro_content_studio', 'plan_pro', 'content_studio', true, NULL),
  ('pe_pro_content_generation', 'plan_pro', 'content_generation', true, NULL),
  ('pe_pro_content_campaigns', 'plan_pro', 'content_campaigns', true, NULL),
  ('pe_pro_content_calendar', 'plan_pro', 'content_calendar', true, NULL),
  ('pe_pro_advanced_business_insights', 'plan_pro', 'advanced_business_insights', true, NULL),
  ('pe_pro_ai_generations_monthly', 'plan_pro', 'ai_generations_monthly', true, 500),
  ('pe_pro_content_campaigns_monthly', 'plan_pro', 'content_campaigns_monthly', true, 50)
ON CONFLICT ("plan_id", "feature_key") DO NOTHING;
