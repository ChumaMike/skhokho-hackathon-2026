-- Tab 5: "mark refund resolved" for REFUND_DUE payment attempts (additive).
--
-- The merchant (Settings › Payments) or a FINANCE admin records that the
-- customer was refunded in PayFast, with a reason and the PayFast refund
-- reference. A separate table rather than a new PaymentAttemptStatus value,
-- so older builds can still read every attempt after a rollback and the
-- attempt row itself stays immutable. "Still owed" = status REFUND_DUE with
-- no row here.

CREATE TABLE "payment_refund_resolutions" (
    "attempt_id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "resolved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by_type" TEXT NOT NULL,
    "resolved_by_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "provider_refund_ref" TEXT,

    CONSTRAINT "payment_refund_resolutions_pkey" PRIMARY KEY ("attempt_id")
);

CREATE INDEX "payment_refund_resolutions_business_id_resolved_at_idx" ON "payment_refund_resolutions"("business_id", "resolved_at");

ALTER TABLE "payment_refund_resolutions" ADD CONSTRAINT "payment_refund_resolutions_attempt_id_fkey"
    FOREIGN KEY ("attempt_id") REFERENCES "business_payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
