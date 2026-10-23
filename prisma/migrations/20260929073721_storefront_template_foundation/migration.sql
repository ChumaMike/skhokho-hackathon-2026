-- AlterTable
ALTER TABLE "business_profiles" ADD COLUMN     "active_template_id" TEXT NOT NULL DEFAULT 'CLASSIC',
ADD COLUMN     "generated_template" JSONB,
ADD COLUMN     "generated_template_at" TIMESTAMP(3),
ADD COLUMN     "generated_template_source" "BriefSource",
ADD COLUMN     "promoted_template_id" TEXT;
