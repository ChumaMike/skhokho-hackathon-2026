-- Repairs the gap between the frozen 20260809000000_baseline migration and
-- the schema it actually needed to track. The `Review` model, two
-- `AppUser` reset-token columns, and the pgcrypto/uuid-ossp extensions
-- (declared in schema.prisma's `extensions = [...]` block but never
-- captured in a migration) were all pushed to the dev database via
-- `prisma db push` after the baseline was frozen, without a migration ever
-- being generated for them. This migration exists so `prisma migrate
-- deploy` against a genuinely fresh database reaches the same schema the
-- live dev database already has. Hand-written (not `prisma migrate dev`
-- output) because generating it against the live dev database would have
-- required an interactive shadow-database reset prompt this dev database
-- never needed reset for — the SQL below matches the real live drift 1:1,
-- confirmed by `prisma migrate dev --create-only`'s own drift-detection
-- summary before it was aborted rather than allowing a reset.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- AlterTable
ALTER TABLE "public"."app_users" ADD COLUMN "reset_token" TEXT,
ADD COLUMN "reset_token_expiry" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "public"."reviews" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "order_id" TEXT,
    "appointment_id" TEXT,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reviews_order_id_key" ON "public"."reviews"("order_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "reviews_appointment_id_key" ON "public"."reviews"("appointment_id" ASC);

-- CreateIndex
CREATE INDEX "reviews_business_id_is_published_created_at_idx" ON "public"."reviews"("business_id" ASC, "is_published" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "reviews_membership_id_idx" ON "public"."reviews"("membership_id" ASC);

-- AddForeignKey
ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."reviews" ADD CONSTRAINT "reviews_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
