-- Paid custom domains: ownership/DNS/SSL state on business_domains, and
-- domain_registrations for domains bought through a registrar integration
-- (the merchant is always the registrant). Additive only.

-- CreateEnum
CREATE TYPE "DomainVerificationMethod" AS ENUM ('DNS_TXT', 'REGISTRAR');

-- CreateEnum
CREATE TYPE "DomainOwnershipStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "DomainDnsStatus" AS ENUM ('UNKNOWN', 'MISCONFIGURED', 'CONFIGURED');

-- CreateEnum
CREATE TYPE "DomainSslStatus" AS ENUM ('PENDING', 'ISSUED', 'FAILED');

-- CreateEnum
CREATE TYPE "DomainRegistrationStatus" AS ENUM ('AWAITING_PAYMENT', 'REGISTERING', 'REGISTERED', 'RENEWAL_DUE', 'EXPIRED', 'TRANSFERRED_OUT', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "business_domains" ADD COLUMN     "apex_domain" TEXT,
ADD COLUMN     "dns_status" "DomainDnsStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "failed_checks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_checked_at" TIMESTAMP(3),
ADD COLUMN     "last_error" TEXT,
ADD COLUMN     "ownership_status" "DomainOwnershipStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "registration_id" TEXT,
ADD COLUMN     "ssl_status" "DomainSslStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "verification_method" "DomainVerificationMethod";

-- CreateTable
CREATE TABLE "domain_registrations" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "registrar_key" TEXT NOT NULL,
    "registrar_domain_id" TEXT,
    "status" "DomainRegistrationStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "registrant_name" TEXT NOT NULL,
    "registrant_email" TEXT NOT NULL,
    "years" INTEGER NOT NULL DEFAULT 1,
    "price_cents" INTEGER NOT NULL,
    "renewal_price_cents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "payment_reference" TEXT,
    "auto_renew" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "registered_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "domain_registrations_business_id_idx" ON "domain_registrations"("business_id");

-- CreateIndex
CREATE INDEX "domain_registrations_domain_idx" ON "domain_registrations"("domain");

-- CreateIndex
CREATE INDEX "domain_registrations_status_expires_at_idx" ON "domain_registrations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "business_domains_apex_domain_idx" ON "business_domains"("apex_domain");

-- CreateIndex
CREATE INDEX "business_domains_status_last_checked_at_idx" ON "business_domains"("status", "last_checked_at");

-- AddForeignKey
ALTER TABLE "business_domains" ADD CONSTRAINT "business_domains_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "domain_registrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_registrations" ADD CONSTRAINT "domain_registrations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One canonical (primary) address per business per surface.

CREATE UNIQUE INDEX "business_domains_one_primary" ON "business_domains"("business_id", "surface") WHERE "is_primary";



-- A domain can only be in one live purchase/registration at a time.

CREATE UNIQUE INDEX "domain_registrations_one_live" ON "domain_registrations"("domain") WHERE "status" IN ('AWAITING_PAYMENT', 'REGISTERING', 'REGISTERED', 'RENEWAL_DUE');
