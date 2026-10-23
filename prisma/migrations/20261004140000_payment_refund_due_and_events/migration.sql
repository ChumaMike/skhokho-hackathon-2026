-- Merchant-direct payments: money that can't be applied, and a verified
-- notification trail. Additive only.
--
-- REFUND_DUE: the provider confirmed a real payment for an attempt that could
-- not be applied to its order (already paid by another attempt, order
-- cancelled, amount differs). Previously such payments were closed as FAILED
-- or ignored outright — misreporting money that had genuinely moved.
--
-- business_payment_events: one row per VERIFIED notification (signature and
-- provider postback passed). Append-only by convention; no buyer PII.

-- CreateEnum
CREATE TYPE "PaymentEventOutcome" AS ENUM ('SETTLED', 'DUPLICATE_NOTIFICATION', 'CLOSED', 'REFUND_DUE', 'CONNECTION_VERIFIED', 'IGNORED');

-- AlterEnum
ALTER TYPE "PaymentAttemptStatus" ADD VALUE 'REFUND_DUE';

-- CreateTable
CREATE TABLE "business_payment_events" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "attempt_id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "environment" "PaymentEnvironment" NOT NULL,
    "provider_payment_id" TEXT NOT NULL,
    "provider_status" TEXT NOT NULL,
    "amount_gross" DECIMAL(10,2),
    "outcome" "PaymentEventOutcome" NOT NULL,
    "detail" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_payment_events_business_id_received_at_idx" ON "business_payment_events"("business_id", "received_at");

-- CreateIndex
CREATE INDEX "business_payment_events_outcome_idx" ON "business_payment_events"("outcome");

-- CreateIndex
CREATE UNIQUE INDEX "business_payment_events_attempt_id_provider_payment_id_prov_key" ON "business_payment_events"("attempt_id", "provider_payment_id", "provider_status");

-- AddForeignKey
ALTER TABLE "business_payment_events" ADD CONSTRAINT "business_payment_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_payment_events" ADD CONSTRAINT "business_payment_events_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "business_payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
