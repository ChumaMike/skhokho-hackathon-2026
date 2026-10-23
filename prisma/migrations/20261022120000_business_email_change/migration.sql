-- Tab 5: editable business contact email with re-verification (additive).
--
-- A change to Business.email no longer takes effect on save. The new address
-- is parked here with a hashed, expiring token, and only opening the link
-- sent to that address writes Business.email (business-email.ts). One row per
-- business, created on the first request; Business itself is untouched.

CREATE TABLE "business_email_changes" (
    "business_id" UUID NOT NULL,
    "verified_email" TEXT,
    "verified_at" TIMESTAMP(3),
    "pending_email" TEXT,
    "token_hash" TEXT,
    "expires_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_email_changes_pkey" PRIMARY KEY ("business_id")
);

CREATE UNIQUE INDEX "business_email_changes_token_hash_key" ON "business_email_changes"("token_hash");

ALTER TABLE "business_email_changes" ADD CONSTRAINT "business_email_changes_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
