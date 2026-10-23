-- Skhokholetha: the Skhokho delivery network (docs/skhokholetha.md).

-- CreateEnum
CREATE TYPE "DriverVerificationStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "DriverAvailability" AS ENUM ('OFFLINE', 'ONLINE', 'BUSY', 'PAUSED');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('BICYCLE', 'SCOOTER', 'MOTORCYCLE', 'CAR', 'BAKKIE');

-- CreateEnum
CREATE TYPE "DriverDocumentKind" AS ENUM ('ID_DOCUMENT', 'DRIVERS_LICENCE', 'VEHICLE_REGISTRATION');

-- CreateEnum
CREATE TYPE "DriverDocumentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NetworkDeliveryStatus" AS ENUM ('CREATED', 'SEARCHING', 'OFFERED', 'ASSIGNED', 'DRIVER_TO_PICKUP', 'ARRIVED_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_DROPOFF', 'DELIVERED', 'CANCELLED', 'FAILED', 'RETURNING', 'RETURNED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "DeliveryOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "DriverLedgerType" AS ENUM ('DELIVERY_EARNING', 'ADJUSTMENT', 'PAYOUT');

-- CreateEnum
CREATE TYPE "DriverLedgerStatus" AS ENUM ('PENDING', 'AVAILABLE', 'PAID', 'REVERSED');

-- CreateEnum
CREATE TYPE "DriverPayoutStatus" AS ENUM ('REQUESTED', 'PAID', 'FAILED');

-- AlterEnum
ALTER TYPE "AppRole" ADD VALUE 'DRIVER';

-- CreateTable
CREATE TABLE "driver_profiles" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "phone" TEXT,
    "verification_status" "DriverVerificationStatus" NOT NULL DEFAULT 'DRAFT',
    "availability" "DriverAvailability" NOT NULL DEFAULT 'OFFLINE',
    "service_radius_km" INTEGER NOT NULL DEFAULT 10,
    "location_consent_at" TIMESTAMP(3),
    "last_lat" DOUBLE PRECISION,
    "last_lng" DOUBLE PRECISION,
    "last_location_at" TIMESTAMP(3),
    "payout_bank_name" TEXT,
    "payout_account_holder" TEXT,
    "payout_branch_code" TEXT,
    "payout_account_cipher" TEXT,
    "payout_account_last4" TEXT,
    "email_verify_token_hash" TEXT,
    "email_verify_expires_at" TIMESTAMP(3),
    "agreement_version" TEXT,
    "agreement_accepted_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "review_note" TEXT,
    "suspended_at" TIMESTAMP(3),
    "suspension_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_vehicles" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL,
    "registration" TEXT,
    "make_model" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_documents" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "kind" "DriverDocumentKind" NOT NULL,
    "status" "DriverDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "expires_on" DATE,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "review_note" TEXT,

    CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_deliveries" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "order_delivery_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "status" "NetworkDeliveryStatus" NOT NULL DEFAULT 'CREATED',
    "driver_id" TEXT,
    "request_key" TEXT NOT NULL,
    "requested_by_staff_id" TEXT,
    "pickup_lat" DOUBLE PRECISION NOT NULL,
    "pickup_lng" DOUBLE PRECISION NOT NULL,
    "dropoff_lat" DOUBLE PRECISION NOT NULL,
    "dropoff_lng" DOUBLE PRECISION NOT NULL,
    "distance_meters" INTEGER NOT NULL,
    "quote_fee_cents" INTEGER NOT NULL,
    "platform_fee_cents" INTEGER NOT NULL,
    "driver_earning_cents" INTEGER NOT NULL,
    "pricing_snapshot" JSONB NOT NULL,
    "pickup_code_nonce" TEXT NOT NULL,
    "pickup_code_failures" INTEGER NOT NULL DEFAULT 0,
    "dropoff_code_nonce" TEXT NOT NULL,
    "dropoff_code_failures" INTEGER NOT NULL DEFAULT 0,
    "tracking_nonce" TEXT NOT NULL,
    "tracking_token_hash" TEXT NOT NULL,
    "tracking_expires_at" TIMESTAMP(3),
    "driver_lat" DOUBLE PRECISION,
    "driver_lng" DOUBLE PRECISION,
    "driver_location_at" TIMESTAMP(3),
    "searching_at" TIMESTAMP(3),
    "assigned_at" TIMESTAMP(3),
    "arrived_pickup_at" TIMESTAMP(3),
    "picked_up_at" TIMESTAMP(3),
    "arrived_dropoff_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "end_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "network_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_offers" (
    "id" TEXT NOT NULL,
    "network_delivery_id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "status" "DeliveryOfferStatus" NOT NULL DEFAULT 'PENDING',
    "distance_meters" INTEGER NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),

    CONSTRAINT "delivery_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_events" (
    "id" TEXT NOT NULL,
    "network_delivery_id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "from_status" "NetworkDeliveryStatus",
    "to_status" "NetworkDeliveryStatus",
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_ledger_entries" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "network_delivery_id" TEXT,
    "type" "DriverLedgerType" NOT NULL,
    "status" "DriverLedgerStatus" NOT NULL DEFAULT 'PENDING',
    "amount_cents" INTEGER NOT NULL,
    "source_key" TEXT NOT NULL,
    "payout_id" TEXT,
    "available_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_payouts" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "DriverPayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "reference" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "driver_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_user_id_key" ON "driver_profiles"("user_id");

-- CreateIndex
CREATE INDEX "driver_profiles_verification_status_idx" ON "driver_profiles"("verification_status");

-- CreateIndex
CREATE INDEX "driver_profiles_availability_idx" ON "driver_profiles"("availability");

-- CreateIndex
CREATE INDEX "driver_vehicles_driver_id_idx" ON "driver_vehicles"("driver_id");

-- CreateIndex
CREATE INDEX "driver_documents_driver_id_kind_idx" ON "driver_documents"("driver_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "network_deliveries_tracking_token_hash_key" ON "network_deliveries"("tracking_token_hash");

-- CreateIndex
CREATE INDEX "network_deliveries_order_delivery_id_idx" ON "network_deliveries"("order_delivery_id");

-- CreateIndex
CREATE INDEX "network_deliveries_status_idx" ON "network_deliveries"("status");

-- CreateIndex
CREATE INDEX "network_deliveries_business_id_status_idx" ON "network_deliveries"("business_id", "status");

-- CreateIndex
CREATE INDEX "network_deliveries_driver_id_status_idx" ON "network_deliveries"("driver_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "network_deliveries_business_id_request_key_key" ON "network_deliveries"("business_id", "request_key");

-- CreateIndex
CREATE INDEX "delivery_offers_driver_id_status_idx" ON "delivery_offers"("driver_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_offers_network_delivery_id_driver_id_key" ON "delivery_offers"("network_delivery_id", "driver_id");

-- CreateIndex
CREATE INDEX "delivery_events_network_delivery_id_created_at_idx" ON "delivery_events"("network_delivery_id", "created_at");

-- CreateIndex
CREATE INDEX "delivery_events_business_id_created_at_idx" ON "delivery_events"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "driver_ledger_entries_source_key_key" ON "driver_ledger_entries"("source_key");

-- CreateIndex
CREATE INDEX "driver_ledger_entries_driver_id_created_at_idx" ON "driver_ledger_entries"("driver_id", "created_at");

-- CreateIndex
CREATE INDEX "driver_ledger_entries_driver_id_status_idx" ON "driver_ledger_entries"("driver_id", "status");

-- CreateIndex
CREATE INDEX "driver_payouts_driver_id_created_at_idx" ON "driver_payouts"("driver_id", "created_at");

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_vehicles" ADD CONSTRAINT "driver_vehicles_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_deliveries" ADD CONSTRAINT "network_deliveries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_deliveries" ADD CONSTRAINT "network_deliveries_order_delivery_id_fkey" FOREIGN KEY ("order_delivery_id") REFERENCES "order_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_deliveries" ADD CONSTRAINT "network_deliveries_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_offers" ADD CONSTRAINT "delivery_offers_network_delivery_id_fkey" FOREIGN KEY ("network_delivery_id") REFERENCES "network_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_offers" ADD CONSTRAINT "delivery_offers_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_network_delivery_id_fkey" FOREIGN KEY ("network_delivery_id") REFERENCES "network_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_ledger_entries" ADD CONSTRAINT "driver_ledger_entries_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_ledger_entries" ADD CONSTRAINT "driver_ledger_entries_network_delivery_id_fkey" FOREIGN KEY ("network_delivery_id") REFERENCES "network_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_ledger_entries" ADD CONSTRAINT "driver_ledger_entries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "driver_payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_payouts" ADD CONSTRAINT "driver_payouts_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Invariants Prisma can't express (hand-written).
-- ---------------------------------------------------------------------------

-- A driver can hold at most ONE active delivery. Together with the
-- conditional claim in acceptOffer, no double assignment is possible.
CREATE UNIQUE INDEX "network_deliveries_one_active_per_driver"
  ON "network_deliveries" ("driver_id")
  WHERE "status" IN ('ASSIGNED', 'DRIVER_TO_PICKUP', 'ARRIVED_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED_DROPOFF', 'RETURNING');

-- At most one unfinished network delivery per delivery request (a cancelled
-- or finished one doesn't block asking again).
CREATE UNIQUE INDEX "network_deliveries_one_open_per_request"
  ON "network_deliveries" ("order_delivery_id")
  WHERE "status" NOT IN ('DELIVERED', 'CANCELLED', 'RETURNED');

-- At most one active vehicle per driver.
CREATE UNIQUE INDEX "driver_vehicles_one_active_per_driver"
  ON "driver_vehicles" ("driver_id") WHERE "is_active";

-- Money is whole, non-negative cents and the split always adds up.
ALTER TABLE "network_deliveries" ADD CONSTRAINT "network_deliveries_money_valid"
  CHECK ("quote_fee_cents" >= 0 AND "platform_fee_cents" >= 0 AND "driver_earning_cents" >= 0
         AND "driver_earning_cents" + "platform_fee_cents" = "quote_fee_cents");

-- Delivery events are an append-only audit trail.
CREATE OR REPLACE FUNCTION delivery_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'delivery_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER delivery_events_no_update
  BEFORE UPDATE ON "delivery_events"
  FOR EACH ROW EXECUTE FUNCTION delivery_events_append_only();
