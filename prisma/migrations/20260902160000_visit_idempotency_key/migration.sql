-- Adds an optional, caller-supplied idempotency key to `visits` so a
-- retried log_visit/redeem_reward call can return the existing row's
-- result instead of inserting a second one. NULL is fine and stays
-- non-unique (Postgres treats every NULL as distinct in a unique index),
-- so this doesn't force every visit to carry a key.
--
-- Hand-written, not `prisma migrate dev` output: that command refuses to
-- generate a migration against this dev database without an interactive
-- shadow-database reset prompt (it treats the live database not yet
-- having a column that was only just added to schema.prisma as "drift"
-- requiring a reset, the same trap hit during the Phase 0d baseline
-- repair) - not applicable here since there's nothing to reset, just a
-- forward-only column and index to add.

-- AlterTable
ALTER TABLE "public"."visits" ADD COLUMN "idempotency_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "visits_business_id_idempotency_key_key" ON "public"."visits"("business_id" ASC, "idempotency_key" ASC);
