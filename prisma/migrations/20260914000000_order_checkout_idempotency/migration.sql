-- Adds an optional, caller-supplied idempotency key to `orders` so a
-- retried storefront basket/checkout submission (double-tap, refresh,
-- slow-network retry, browser back/forward) that reuses the same key
-- returns the existing Order instead of creating a second one for one
-- intended purchase.
--
-- Same pattern as visits.idempotency_key (see
-- 20260902160000_visit_idempotency_key): NULL stays non-unique in a
-- Postgres unique index, so every existing/POS-created order — which
-- never sets this — is completely unaffected.
--
-- Hand-written, not `prisma migrate dev` output — same shadow-database
-- reset trap documented in 20260902160000_visit_idempotency_key.

-- AlterTable
ALTER TABLE "public"."orders" ADD COLUMN "checkout_idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_business_id_checkout_idempotency_key_key" ON "public"."orders"("business_id" ASC, "checkout_idempotency_key" ASC);
