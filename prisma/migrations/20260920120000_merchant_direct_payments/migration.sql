-- Merchant-direct payments: each business receives its own customer payments.
--
-- Purely additive. Two tables, five enums, four indexes, one CHECK. No existing
-- column is altered or dropped and no data is backfilled, so every order,
-- payment status and setting that exists today is untouched. Rolling back is a
-- clean drop of the new objects.
--
-- Note `Order.payment_ref` is NOT added here — the column already exists and
-- has simply never been written to. The application starts writing it.

CREATE TYPE "public"."PaymentProvider" AS ENUM ('PAYFAST');
CREATE TYPE "public"."PaymentEnvironment" AS ENUM ('SANDBOX', 'LIVE');
CREATE TYPE "public"."PaymentConnectionStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'INVALID', 'DISABLED', 'SUPERSEDED');
CREATE TYPE "public"."PaymentAttemptStatus" AS ENUM ('CREATED', 'SUBMITTED', 'COMPLETE', 'FAILED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "public"."PaymentAttemptPurpose" AS ENUM ('CUSTOMER_ORDER', 'LIVE_VERIFICATION');

CREATE TABLE "public"."business_payment_connections" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "provider" "public"."PaymentProvider" NOT NULL,
    "environment" "public"."PaymentEnvironment" NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "merchant_key_cipher" TEXT NOT NULL,
    "passphrase_cipher" TEXT,
    "key_version" INTEGER NOT NULL,
    "status" "public"."PaymentConnectionStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "verified_at" TIMESTAMP(3),
    "verified_by_attempt_id" TEXT,
    "last_error" TEXT,
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_payment_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."business_payment_attempts" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "order_id" TEXT,
    "business_id" UUID NOT NULL,
    "connection_id" TEXT NOT NULL,
    "purpose" "public"."PaymentAttemptPurpose" NOT NULL DEFAULT 'CUSTOMER_ORDER',
    "provider" "public"."PaymentProvider" NOT NULL,
    "environment" "public"."PaymentEnvironment" NOT NULL,
    "merchant_id_snapshot" TEXT NOT NULL,
    "expected_amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "status" "public"."PaymentAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "provider_payment_id" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "business_payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "business_payment_connections_business_id_provider_environme_idx"
    ON "public"."business_payment_connections"("business_id", "provider", "environment");
CREATE INDEX "business_payment_connections_status_idx"
    ON "public"."business_payment_connections"("status");

CREATE UNIQUE INDEX "business_payment_attempts_reference_key"
    ON "public"."business_payment_attempts"("reference");
CREATE INDEX "business_payment_attempts_order_id_idx"
    ON "public"."business_payment_attempts"("order_id");
CREATE INDEX "business_payment_attempts_business_id_idx"
    ON "public"."business_payment_attempts"("business_id");
CREATE INDEX "business_payment_attempts_connection_id_idx"
    ON "public"."business_payment_attempts"("connection_id");
CREATE INDEX "business_payment_attempts_status_idx"
    ON "public"."business_payment_attempts"("status");

-- A replayed notification must be a no-op, not a second settlement. Postgres
-- treats NULLs as distinct, so unsubmitted attempts (provider_payment_id NULL)
-- do not collide with each other.
CREATE UNIQUE INDEX "business_payment_attempts_provider_provider_payment_id_key"
    ON "public"."business_payment_attempts"("provider", "provider_payment_id");

-- --- Foreign keys: Restrict everywhere, never Cascade ------------------------
-- Payment history is a reconciliation and dispute record. Deleting a business
-- or an order must not be able to destroy evidence that money moved, nor break
-- the validation of a notification still in flight.
ALTER TABLE "public"."business_payment_connections"
    ADD CONSTRAINT "business_payment_connections_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."business_payment_attempts"
    ADD CONSTRAINT "business_payment_attempts_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."business_payment_attempts"
    ADD CONSTRAINT "business_payment_attempts_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."business_payment_attempts"
    ADD CONSTRAINT "business_payment_attempts_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "public"."business_payment_connections"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- --- Constraints Prisma's schema language cannot express ---------------------

-- Signature verification without a passphrase is not a meaningful check on a
-- live merchant account, so a LIVE connection cannot exist without one. Enforced
-- in the database, not only in the service, because this one protects real money.
ALTER TABLE "public"."business_payment_connections"
    ADD CONSTRAINT "business_payment_connections_live_requires_passphrase"
    CHECK ("environment" <> 'LIVE' OR "passphrase_cipher" IS NOT NULL);

-- At most one live (non-retired) connection per business, provider and
-- environment. Rotation retires the old row before inserting the new one, so
-- "which account is this business using" always has exactly one answer.
CREATE UNIQUE INDEX "business_payment_connections_one_active"
    ON "public"."business_payment_connections"("business_id", "provider", "environment")
    WHERE "retired_at" IS NULL;

-- One provider account cannot be the active destination for two different
-- businesses. Without this, pasting another merchant's ID (by mistake or
-- otherwise) would quietly point someone else's customer payments at it.
CREATE UNIQUE INDEX "business_payment_connections_one_business_per_merchant"
    ON "public"."business_payment_connections"("provider", "environment", "merchant_id")
    WHERE "retired_at" IS NULL;

-- An order may be attempted many times, but only one attempt may settle.
-- The last line of defence behind the application's conditional update.
CREATE UNIQUE INDEX "business_payment_attempts_one_complete_per_order"
    ON "public"."business_payment_attempts"("order_id")
    WHERE "status" = 'COMPLETE';
