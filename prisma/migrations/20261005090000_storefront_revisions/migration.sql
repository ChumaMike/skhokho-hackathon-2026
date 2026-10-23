-- Storefront Intelligence Engine: versioned storefront specifications.
-- Additive only. AI output lands as a DRAFT revision; nothing reaches the
-- live storefront until a merchant publishes it.

-- CreateEnum
CREATE TYPE "StorefrontRevisionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StorefrontRevisionSource" AS ENUM ('AI_GENERATED', 'AI_ASSISTED', 'RULES');

-- CreateTable
CREATE TABLE "storefront_revisions" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "StorefrontRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "StorefrontRevisionSource" NOT NULL,
    "spec" JSONB NOT NULL,
    "validation" JSONB NOT NULL,
    "ai_note" TEXT,
    "created_by_staff_id" TEXT,
    "published_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),

    CONSTRAINT "storefront_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storefront_revisions_business_id_status_idx" ON "storefront_revisions"("business_id", "status");

-- CreateIndex
CREATE INDEX "storefront_revisions_business_id_created_at_idx" ON "storefront_revisions"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_revisions_business_id_version_key" ON "storefront_revisions"("business_id", "version");

-- At most one PUBLISHED revision per business (Prisma can't express a partial unique index).
CREATE UNIQUE INDEX "storefront_revisions_one_published" ON "storefront_revisions"("business_id") WHERE "status" = 'PUBLISHED';

-- AddForeignKey
ALTER TABLE "storefront_revisions" ADD CONSTRAINT "storefront_revisions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
