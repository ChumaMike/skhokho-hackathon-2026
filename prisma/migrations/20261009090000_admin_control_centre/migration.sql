-- Platform admin control centre: admin tiers + mandatory TOTP MFA, recovery codes,
-- the platform audit trail, background job runs, and audit fields on ledger
-- adjustments. Additive only.

-- CreateEnum
CREATE TYPE "PlatformAdminRole" AS ENUM ('SUPER_ADMIN', 'OPERATIONS', 'FINANCE', 'SUPPORT');

-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('ADMIN_ACTION', 'SECURITY', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- AlterTable
ALTER TABLE "driver_ledger_entries" ADD COLUMN     "created_by" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "reference" TEXT;

-- CreateTable
CREATE TABLE "platform_admins" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "PlatformAdminRole" NOT NULL DEFAULT 'SUPPORT',
    "mfa_secret_cipher" TEXT,
    "mfa_pending_cipher" TEXT,
    "mfa_enabled_at" TIMESTAMP(3),
    "mfa_last_step" INTEGER,
    "session_epoch" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_recovery_codes" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_audit_events" (
    "id" TEXT NOT NULL,
    "category" "AuditCategory" NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "business_id" UUID,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "ip_hash" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "ok" BOOLEAN,
    "duration_ms" INTEGER,
    "summary" JSONB,
    "error" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admins_user_id_key" ON "platform_admins"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_recovery_codes_code_hash_key" ON "admin_recovery_codes"("code_hash");

-- CreateIndex
CREATE INDEX "admin_recovery_codes_admin_id_idx" ON "admin_recovery_codes"("admin_id");

-- CreateIndex
CREATE INDEX "platform_audit_events_created_at_idx" ON "platform_audit_events"("created_at");

-- CreateIndex
CREATE INDEX "platform_audit_events_category_created_at_idx" ON "platform_audit_events"("category", "created_at");

-- CreateIndex
CREATE INDEX "platform_audit_events_action_created_at_idx" ON "platform_audit_events"("action", "created_at");

-- CreateIndex
CREATE INDEX "platform_audit_events_actor_id_created_at_idx" ON "platform_audit_events"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "platform_audit_events_business_id_created_at_idx" ON "platform_audit_events"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "platform_audit_events_resource_type_resource_id_idx" ON "platform_audit_events"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "job_runs_job_started_at_idx" ON "job_runs"("job", "started_at");

-- CreateIndex
CREATE INDEX "job_runs_started_at_idx" ON "job_runs"("started_at");

-- AddForeignKey
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_recovery_codes" ADD CONSTRAINT "admin_recovery_codes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "platform_admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The audit trail is evidence: never edited or deleted.
CREATE OR REPLACE FUNCTION platform_audit_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'platform_audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER platform_audit_events_no_change
  BEFORE UPDATE OR DELETE ON "platform_audit_events"
  FOR EACH ROW EXECUTE FUNCTION platform_audit_events_append_only();
