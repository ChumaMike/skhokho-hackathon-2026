-- Skhokholetha hardening (production-readiness follow-up). Additive only:
--   * driver legal acceptance log + current privacy acceptance on the profile
--   * the customer's own delivery key on order_deliveries (hash only)
--   * dispatch backoff column and indexes for the expiry/dispatch scans

-- CreateEnum
CREATE TYPE "DriverLegalKind" AS ENUM ('TERMS', 'PRIVACY');

-- AlterTable
ALTER TABLE "driver_profiles" ADD COLUMN     "privacy_accepted_at" TIMESTAMP(3),
ADD COLUMN     "privacy_version" TEXT;

-- AlterTable
ALTER TABLE "network_deliveries" ADD COLUMN     "dispatch_attempt_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "order_deliveries" ADD COLUMN     "customer_key_hash" TEXT,
ADD COLUMN     "customer_key_nonce" TEXT;

-- CreateTable
CREATE TABLE "driver_legal_acceptances" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "kind" "DriverLegalKind" NOT NULL,
    "version" TEXT NOT NULL,
    "document_url" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "driver_legal_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "driver_legal_acceptances_driver_id_accepted_at_idx" ON "driver_legal_acceptances"("driver_id", "accepted_at");

-- CreateIndex
CREATE UNIQUE INDEX "driver_legal_acceptances_driver_id_kind_version_key" ON "driver_legal_acceptances"("driver_id", "kind", "version");

-- CreateIndex
CREATE INDEX "delivery_offers_status_expires_at_idx" ON "delivery_offers"("status", "expires_at");

-- CreateIndex
CREATE INDEX "network_deliveries_status_dispatch_attempt_at_idx" ON "network_deliveries"("status", "dispatch_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_deliveries_customer_key_hash_key" ON "order_deliveries"("customer_key_hash");

-- AddForeignKey
ALTER TABLE "driver_legal_acceptances" ADD CONSTRAINT "driver_legal_acceptances_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Acceptances are evidence: never edited or deleted (driver_id is ON DELETE RESTRICT).
CREATE OR REPLACE FUNCTION driver_legal_acceptances_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'driver_legal_acceptances is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER driver_legal_acceptances_no_change
  BEFORE UPDATE OR DELETE ON "driver_legal_acceptances"
  FOR EACH ROW EXECUTE FUNCTION driver_legal_acceptances_append_only();
