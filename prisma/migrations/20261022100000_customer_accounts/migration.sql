-- Customer accounts: phone-first sign-in by one-time code.
--
-- One table, keyed by the identifier the customer typed (E.164 phone or a
-- lower-cased email) — never by a customers row, because the same phone is a
-- separate customers row at every business and sign-in must not pick one or
-- link them (POPIA s57; see docs/specs/2026-07-14-customer-platform-design.md).
-- Only a SHA-256 of the code is stored; rows expire in minutes and the daily
-- cron purges them. Additive only.

-- CreateTable
CREATE TABLE "customer_login_codes" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_login_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_login_codes_channel_identifier_created_at_idx" ON "customer_login_codes"("channel", "identifier", "created_at");

-- CreateIndex
CREATE INDEX "customer_login_codes_expires_at_idx" ON "customer_login_codes"("expires_at");
