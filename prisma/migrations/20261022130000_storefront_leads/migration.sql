-- Tab 7: storefront workflows (quote request, enquiry, pickup request,
-- callback) land as leads in storefront_leads, worked from Dashboard >
-- Enquiries. Adds LEAD_SUBMITTED to the storefront learning event enum.
-- Additive only; no existing table or row changes.

-- CreateEnum
CREATE TYPE "StorefrontLeadKind" AS ENUM ('QUOTE_REQUEST', 'EVENT_ENQUIRY', 'PICKUP_REQUEST', 'CALLBACK_REQUEST');

-- CreateEnum
CREATE TYPE "StorefrontLeadStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'QUOTED', 'WON', 'CLOSED');

-- AlterEnum
ALTER TYPE "StorefrontEventType" ADD VALUE 'LEAD_SUBMITTED';

-- CreateTable
CREATE TABLE "storefront_leads" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "StorefrontLeadKind" NOT NULL,
    "status" "StorefrontLeadStatus" NOT NULL DEFAULT 'NEW',
    "membership_id" UUID,
    "customer_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "message" TEXT,
    "details" JSONB NOT NULL,
    "photos" TEXT[],
    "service_name" TEXT,
    "page_slug" TEXT NOT NULL DEFAULT '',
    "owner_notes" TEXT,
    "handled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storefront_leads_business_id_status_created_at_idx" ON "storefront_leads"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "storefront_leads_business_id_created_at_idx" ON "storefront_leads"("business_id", "created_at");

-- AddForeignKey
ALTER TABLE "storefront_leads" ADD CONSTRAINT "storefront_leads_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

