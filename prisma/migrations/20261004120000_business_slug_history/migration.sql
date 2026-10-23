-- Slug history: slugs a business has given up, kept so old links redirect
-- to the new address and so no other business can claim them. Additive
-- only: no existing table or row is touched.

-- CreateTable
CREATE TABLE "business_slug_history" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "retired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_slug_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_slug_history_slug_key" ON "business_slug_history"("slug");

-- CreateIndex
CREATE INDEX "business_slug_history_business_id_idx" ON "business_slug_history"("business_id");

-- AddForeignKey
ALTER TABLE "business_slug_history" ADD CONSTRAINT "business_slug_history_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
