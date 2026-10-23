-- Phase 3 of the multi-tenant domain architecture plan: the business_domains
-- table for per-surface (storefront/bookings/admin) custom hostnames. No
-- routing change yet (Phase 4) — this is a pure schema landing.

-- CreateEnum
CREATE TYPE "public"."DomainSurface" AS ENUM ('STOREFRONT', 'BOOKINGS', 'ADMIN');

-- CreateEnum
CREATE TYPE "public"."DomainType" AS ENUM ('PLATFORM', 'CUSTOM');

-- CreateEnum
CREATE TYPE "public"."DomainStatus" AS ENUM ('PENDING', 'VERIFYING', 'ACTIVE', 'FAILED', 'REVOKED');

-- CreateTable
CREATE TABLE "public"."business_domains" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "surface" "public"."DomainSurface" NOT NULL,
    "domain_type" "public"."DomainType" NOT NULL DEFAULT 'CUSTOM',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."DomainStatus" NOT NULL DEFAULT 'PENDING',
    "verification_token" TEXT,
    "provider" TEXT DEFAULT 'vercel',
    "provider_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "business_domains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_domains_hostname_key" ON "public"."business_domains"("hostname" ASC);

-- CreateIndex
CREATE INDEX "business_domains_business_id_idx" ON "public"."business_domains"("business_id" ASC);

-- CreateIndex
CREATE INDEX "business_domains_business_id_surface_idx" ON "public"."business_domains"("business_id" ASC, "surface" ASC);

-- "One primary active hostname per business per surface" is a PARTIAL
-- constraint (only applies when is_primary = true AND status = 'ACTIVE') —
-- Prisma's @@unique can't express that, so it's hand-written here rather
-- than attempted in schema.prisma.
CREATE UNIQUE INDEX "business_domains_one_primary_per_surface"
  ON "public"."business_domains" ("business_id", "surface")
  WHERE ("is_primary" = true AND "status" = 'ACTIVE');

-- AddForeignKey
ALTER TABLE "public"."business_domains" ADD CONSTRAINT "business_domains_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
