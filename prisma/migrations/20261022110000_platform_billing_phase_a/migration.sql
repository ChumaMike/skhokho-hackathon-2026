-- ---------------------------------------------------------------------------
-- Platform billing, Phase A — a merchant paying Skhokho Laboratory.
--
-- Additive. Touches no merchant payment table: Order, BusinessPaymentAttempt
-- and BusinessPaymentConnection (a merchant's own customers paying THEM) are
-- a different flow, a different PayFast account and a different reference
-- namespace (skhp_ here, skh_ there). See
-- docs/specs/2026-10-21-plans.md and 2026-10-21-platform-billing-design.md.
--
-- Also lands the commercial decisions: GROW R599 / PRO R1299, and the removal
-- of five entitlement rows that were advertised but had no enforcement
-- anywhere in the codebase (so every FREE business already had them).
--
-- No card tokenisation, no automated charging. Phase B stays held.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "PlatformInvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'UNCOLLECTIBLE', 'VOID');

-- CreateEnum
CREATE TYPE "PlatformInvoiceLineKind" AS ENUM ('PLAN', 'ADDON', 'SETUP', 'PRORATION', 'CREDIT');

-- CreateEnum
CREATE TYPE "PlatformSettlementMethod" AS ENUM ('EFT', 'CASH', 'CARD', 'WRITE_OFF');

-- CreateEnum
CREATE TYPE "BusinessAddonStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ENDED');

-- CreateTable
CREATE TABLE "platform_invoices" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "number" TEXT,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "plan_code_snapshot" TEXT,
    "subtotal_cents" INTEGER NOT NULL,
    "vat_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "status" "PlatformInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issued_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "closed_reason" TEXT,
    "last_notice_stage" TEXT,
    "last_notice_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_invoice_lines" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "kind" "PlatformInvoiceLineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_cents" INTEGER NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "platform_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settlements" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "method" "PlatformSettlementMethod" NOT NULL,
    "payer_reference" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "recorded_by_admin_id" TEXT,
    "note" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_addons" (
    "id" TEXT NOT NULL,
    "business_id" UUID NOT NULL,
    "service_slug" TEXT NOT NULL,
    "setup_cents" INTEGER NOT NULL DEFAULT 0,
    "monthly_cents" INTEGER NOT NULL,
    "setup_invoiced" BOOLEAN NOT NULL DEFAULT false,
    "status" "BusinessAddonStatus" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_addons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_number_sequences" (
    "year" INTEGER NOT NULL,
    "last_number" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_number_sequences_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_number_key" ON "platform_invoices"("number");

-- CreateIndex
CREATE INDEX "platform_invoices_business_id_status_idx" ON "platform_invoices"("business_id", "status");

-- CreateIndex
CREATE INDEX "platform_invoices_status_due_at_idx" ON "platform_invoices"("status", "due_at");

-- CreateIndex
CREATE INDEX "platform_invoice_lines_invoice_id_idx" ON "platform_invoice_lines"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_settlements_reference_key" ON "platform_settlements"("reference");

-- CreateIndex
CREATE INDEX "platform_settlements_business_id_idx" ON "platform_settlements"("business_id");

-- CreateIndex
CREATE INDEX "platform_settlements_invoice_id_idx" ON "platform_settlements"("invoice_id");

-- CreateIndex
CREATE INDEX "business_addons_business_id_status_idx" ON "business_addons"("business_id", "status");

-- AddForeignKey
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_invoice_lines" ADD CONSTRAINT "platform_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "platform_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_settlements" ADD CONSTRAINT "platform_settlements_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "platform_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_settlements" ADD CONSTRAINT "platform_settlements_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_addons" ADD CONSTRAINT "business_addons_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Idempotency, at the database layer rather than in application logic.
-- A cron that fires twice, or two admins racing, cannot double-write.
-- Prisma cannot express partial unique indexes, so they live here.
-- ---------------------------------------------------------------------------

-- One live invoice per business per billing period. A re-run of invoice
-- generation hits this and changes nothing. Voided invoices are excluded so a
-- cancelled period can legitimately be re-invoiced.
CREATE UNIQUE INDEX "platform_invoices_one_live_per_period"
  ON "platform_invoices" ("business_id", "period_start")
  WHERE "status" <> 'VOID';

-- One live settlement per invoice: an invoice cannot be paid twice.
CREATE UNIQUE INDEX "platform_settlements_one_live_per_invoice"
  ON "platform_settlements" ("invoice_id")
  WHERE "voided_at" IS NULL;

-- One active instance of a managed service per business.
CREATE UNIQUE INDEX "business_addons_one_active_per_service"
  ON "business_addons" ("business_id", "service_slug")
  WHERE "status" = 'ACTIVE';

-- A settled invoice must carry a number, and a DRAFT must not. This is what
-- keeps the SKHL-INV-YYYY-NNNNNN sequence gap-free: numbers are allocated on
-- issue, never on draft creation.
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_number_when_issued"
  CHECK (("status" = 'DRAFT' AND "number" IS NULL) OR ("status" <> 'DRAFT' AND "number" IS NOT NULL));

-- Money is never negative here; a refund is a CREDIT line, not a negative
-- settlement.
ALTER TABLE "platform_settlements" ADD CONSTRAINT "platform_settlements_amount_positive"
  CHECK ("amount_cents" > 0);

ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_totals_non_negative"
  CHECK ("subtotal_cents" >= 0 AND "vat_cents" >= 0 AND "total_cents" >= 0);

-- The platform-billing reference namespace. Enforced in the database so a
-- merchant reference (skh_) can never be written into a platform settlement,
-- whatever application code does.
ALTER TABLE "platform_settlements" ADD CONSTRAINT "platform_settlements_reference_namespace"
  CHECK ("reference" LIKE 'skhp\_%');

-- ---------------------------------------------------------------------------
-- Commercial decisions (2026-10-21).
-- ---------------------------------------------------------------------------

-- Prices: GROW R599.00, PRO R1299.00. Integer cents.
UPDATE "plans" SET "price_cents" = 59900,  "updated_at" = CURRENT_TIMESTAMP WHERE "code" = 'GROW';
UPDATE "plans" SET "price_cents" = 129900, "updated_at" = CURRENT_TIMESTAMP WHERE "code" = 'PRO';

-- Withdraw five capabilities from every plan.
--
-- Each was granted to GROW and/or PRO and advertised on the public showcase
-- (toShowcasePlan derives its feature list straight from these rows), but has
-- ZERO enforcement sites in the application — `withinLimit` had no callers at
-- all, and these five booleans are read nowhere. Every FREE business already
-- had them, so they could not honestly be sold.
--
-- The keys stay in src/modules/billing/features.ts so they can be granted
-- again the day the features genuinely exist and are enforced. Deleting the
-- grant rows removes them from advertising only; no merchant loses anything
-- they were actually able to use.
DELETE FROM "plan_entitlements"
 WHERE "feature_key" IN (
   'advanced_storefront',
   'advanced_staff',
   'advanced_ai',
   'multi_location',
   'advanced_business_insights'
 );

-- Billing email defaults to the business owner's address. The owner can change
-- it later (a bookkeeper, a partner, a business that changes hands), which is
-- why billing is not permanently tied to the login address.
UPDATE "business_subscriptions" bs
   SET "billing_email" = au."email"
  FROM "businesses" b
  JOIN "app_users" au ON au."id" = b."auth_user_id"
 WHERE bs."business_id" = b."id"
   AND bs."billing_email" IS NULL;
