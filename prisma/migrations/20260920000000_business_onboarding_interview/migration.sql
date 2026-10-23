-- Business onboarding interview + storefront brief.
--
-- Purely additive: one new table and two new enums, nothing on `businesses`
-- changes. Every existing business simply has no profile row, which the
-- dashboard reads as "interview not started yet" — so this deploys without a
-- backfill and without touching a single existing row.
CREATE TYPE "public"."InterviewStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'SKIPPED');
CREATE TYPE "public"."BriefSource" AS ENUM ('RULES', 'MODEL');

CREATE TABLE "public"."business_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "status" "public"."InterviewStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "brief" TEXT,
    "brief_source" "public"."BriefSource",
    "brief_generated_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "skipped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("id")
);

-- One profile per business: the interview describes the business itself, so a
-- second row would be two competing answers to "what is this shop".
CREATE UNIQUE INDEX "business_profiles_business_id_key" ON "public"."business_profiles"("business_id");
CREATE INDEX "business_profiles_status_idx" ON "public"."business_profiles"("status");

ALTER TABLE "public"."business_profiles"
    ADD CONSTRAINT "business_profiles_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
