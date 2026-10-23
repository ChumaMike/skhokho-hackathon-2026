-- Tab 5: proof-of-delivery code for a business's OWN drivers (additive).
--
-- The same 6-digit HMAC-derived drop-off code Skhokholetha uses, keyed on the
-- OrderDelivery. Issued when a driver is assigned, shown only on the
-- customer's own delivery page, required from the driver to mark the delivery
-- done. Only the nonce is stored; a manager may complete without the code
-- with a recorded reason (delivery-code.ts).

CREATE TABLE "order_delivery_codes" (
    "order_delivery_id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "nonce" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "confirmed_at" TIMESTAMP(3),
    "override_reason" TEXT,
    "override_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_delivery_codes_pkey" PRIMARY KEY ("order_delivery_id")
);

CREATE INDEX "order_delivery_codes_business_id_idx" ON "order_delivery_codes"("business_id");

ALTER TABLE "order_delivery_codes" ADD CONSTRAINT "order_delivery_codes_order_delivery_id_fkey"
    FOREIGN KEY ("order_delivery_id") REFERENCES "order_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
