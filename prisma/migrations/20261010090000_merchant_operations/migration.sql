-- Merchant operations: delivery zones (area-based pricing), fee/zone snapshot on
-- order deliveries, Skhokholetha quote-parity fields, per-staff notification reads.
-- Additive only; existing configuration is untouched (settings JSON readers keep defaults).

-- CreateEnum
CREATE TYPE "DeliveryZoneMatchKind" AS ENUM ('CUSTOMER_PICK', 'SUBURB_LIST');

-- AlterTable
ALTER TABLE "network_deliveries" ADD COLUMN     "customer_fee_cents" INTEGER,
ADD COLUMN     "merchant_cost_cents" INTEGER;

-- AlterTable
ALTER TABLE "order_deliveries" ADD COLUMN     "delivery_fee_cents" INTEGER,
ADD COLUMN     "delivery_zone_id" TEXT,
ADD COLUMN     "delivery_zone_name" TEXT;

-- CreateTable
CREATE TABLE "business_notification_reads" (
    "notification_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_notification_reads_pkey" PRIMARY KEY ("notification_id","staff_id")
);

-- CreateTable
CREATE TABLE "delivery_zones" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "match_kind" "DeliveryZoneMatchKind" NOT NULL DEFAULT 'CUSTOMER_PICK',
    "suburbs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fee_cents" INTEGER NOT NULL,
    "min_order_cents" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_notification_reads_staff_id_idx" ON "business_notification_reads"("staff_id");

-- CreateIndex
CREATE INDEX "delivery_zones_business_id_active_priority_idx" ON "delivery_zones"("business_id", "active", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_zones_business_id_name_key" ON "delivery_zones"("business_id", "name");

-- AddForeignKey
ALTER TABLE "business_notification_reads" ADD CONSTRAINT "business_notification_reads_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "business_notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

