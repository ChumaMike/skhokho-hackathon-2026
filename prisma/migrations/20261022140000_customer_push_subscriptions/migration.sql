-- Tab 7 (feature/notify-webpush): browsers that opted in to order updates
-- (Web Push), one row per browser per membership. A membership is the
-- customer's pairwise identity at ONE business, so a shop can only ever
-- reach a customer about its own orders. Additive only; no existing table
-- or row changes.

-- CreateTable
CREATE TABLE "customer_push_subscriptions" (
    "id" TEXT NOT NULL,
    "membership_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "device_label" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_sent_at" TIMESTAMP(3),

    CONSTRAINT "customer_push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_push_subscriptions_endpoint_idx" ON "customer_push_subscriptions"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "customer_push_subscriptions_membership_id_endpoint_key" ON "customer_push_subscriptions"("membership_id", "endpoint");

-- AddForeignKey
ALTER TABLE "customer_push_subscriptions" ADD CONSTRAINT "customer_push_subscriptions_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
