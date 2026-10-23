-- Storefront learning: daily behaviour counters (no personal data), AI-original
-- specs on revisions, and pattern candidates awaiting platform review.
-- Additive only.

-- CreateEnum
CREATE TYPE "StorefrontEventType" AS ENUM ('PAGE_VIEW', 'PRODUCT_VIEW', 'CTA_CLICK', 'ADD_TO_BASKET', 'CHECKOUT_START', 'ORDER_PLACED', 'BOOKING_SUBMITTED', 'ENQUIRY_CLICK');

-- CreateEnum
CREATE TYPE "StorefrontPatternStatus" AS ENUM ('CANDIDATE', 'APPROVED', 'REJECTED', 'RETIRED');

-- CreateTable
CREATE TABLE "storefront_daily_stats" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "revision_id" TEXT NOT NULL DEFAULT '',
    "template_id" TEXT NOT NULL DEFAULT '',
    "event" "StorefrontEventType" NOT NULL,
    "page" TEXT NOT NULL DEFAULT '',
    "section" TEXT NOT NULL DEFAULT '',
    "item_id" TEXT NOT NULL DEFAULT '',
    "device" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "storefront_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_pattern_candidates" (
    "id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "template_id" TEXT NOT NULL DEFAULT '',
    "pattern" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" "StorefrontPatternStatus" NOT NULL DEFAULT 'CANDIDATE',
    "review_note" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_pattern_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storefront_daily_stats_business_id_day_idx" ON "storefront_daily_stats"("business_id", "day");

-- CreateIndex
CREATE INDEX "storefront_daily_stats_day_idx" ON "storefront_daily_stats"("day");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_daily_stats_business_id_day_revision_id_template_key" ON "storefront_daily_stats"("business_id", "day", "revision_id", "template_id", "event", "page", "section", "item_id", "device");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_pattern_candidates_signature_key" ON "storefront_pattern_candidates"("signature");

-- CreateIndex
CREATE INDEX "storefront_pattern_candidates_vertical_status_idx" ON "storefront_pattern_candidates"("vertical", "status");

-- AddForeignKey
ALTER TABLE "storefront_daily_stats" ADD CONSTRAINT "storefront_daily_stats_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "storefront_revisions" ADD COLUMN "original_spec" JSONB;
