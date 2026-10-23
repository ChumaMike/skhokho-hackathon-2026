-- AlterTable
-- Idempotent on purpose (2026-10-21): production already carries these five
-- columns from a partially recorded run on 2026-10-04, and its migration
-- table holds a failed row for this migration. `IF NOT EXISTS` lets
-- `prisma migrate resolve --rolled-back` + `prisma migrate deploy` re-run
-- this migration safely on that database (rehearsed on a Neon branch first;
-- see docs/backup-restore.md). Same result on a fresh database.
ALTER TABLE "order_deliveries" ADD COLUMN IF NOT EXISTS "delivery_lat" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "delivery_lng" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "driver_lat" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "driver_lng" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "driver_location_updated_at" TIMESTAMP(3);
