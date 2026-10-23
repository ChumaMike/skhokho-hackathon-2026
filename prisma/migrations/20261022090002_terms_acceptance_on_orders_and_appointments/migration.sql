-- Record which version of the platform Terms of Service a customer accepted
-- at storefront checkout / booking, and when (src/lib/legal/documents.ts).
-- Nullable: POS orders and console-created appointments carry no acceptance.
-- No backfill — rows created before this migration were accepted against the
-- placeholder /terms page, which had no version to record.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "terms_version" TEXT,
ADD COLUMN     "terms_accepted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "terms_version" TEXT,
ADD COLUMN     "terms_accepted_at" TIMESTAMP(3);
