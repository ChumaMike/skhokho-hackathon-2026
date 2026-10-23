-- Delivery & Driver Operations MVP. Additive/backward-compatible:
-- fulfilment_method defaults to COLLECTION (every historical order genuinely
-- was collection-style — no delivery concept ever existed before this),
-- delivery_fee defaults 0. order_deliveries is a brand new table with zero
-- impact on any existing row until one is created.
CREATE TYPE "public"."OrderFulfilmentMethod" AS ENUM ('COLLECTION', 'DELIVERY');
CREATE TYPE "public"."DeliveryStatus" AS ENUM ('UNASSIGNED', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'FAILED');

ALTER TABLE "public"."orders" ADD COLUMN "fulfilment_method" "public"."OrderFulfilmentMethod" NOT NULL DEFAULT 'COLLECTION';
ALTER TABLE "public"."orders" ADD COLUMN "delivery_fee" DECIMAL(10,2) NOT NULL DEFAULT 0;

CREATE TABLE "public"."order_deliveries" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "order_id" TEXT NOT NULL,
    "driver_staff_id" TEXT,
    "status" "public"."DeliveryStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "delivery_address_snapshot" TEXT NOT NULL,
    "delivery_instructions" TEXT,
    "contact_phone" TEXT,
    "assigned_at" TIMESTAMP(3),
    "picked_up_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_deliveries_order_id_key" ON "public"."order_deliveries"("order_id");
CREATE INDEX "order_deliveries_business_id_idx" ON "public"."order_deliveries"("business_id");
CREATE INDEX "order_deliveries_business_id_status_idx" ON "public"."order_deliveries"("business_id", "status");
CREATE INDEX "order_deliveries_driver_staff_id_idx" ON "public"."order_deliveries"("driver_staff_id");

ALTER TABLE "public"."order_deliveries" ADD CONSTRAINT "order_deliveries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."order_deliveries" ADD CONSTRAINT "order_deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."order_deliveries" ADD CONSTRAINT "order_deliveries_driver_staff_id_fkey" FOREIGN KEY ("driver_staff_id") REFERENCES "public"."business_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
