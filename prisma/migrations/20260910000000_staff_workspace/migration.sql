-- Workforce architecture, milestone 1: presentation-only workspace routing,
-- decoupled from BusinessRole.permissions (the only authorization
-- mechanism, unchanged). StaffRole stays frozen (no new values); a job-based
-- preset that has no StaffRole equivalent (Kitchen/Driver/Stock) is
-- identified via BusinessRole.job_preset instead, a plain string rather
-- than a Postgres enum so a future preset never needs a schema migration
-- for the type itself, only a new seeded row.
CREATE TYPE "public"."StaffWorkspace" AS ENUM ('OWNER', 'MANAGER', 'COUNTER', 'KITCHEN', 'DELIVERY', 'SERVICE_PROVIDER', 'STOCK', 'GENERAL');

ALTER TABLE "public"."business_staff" ADD COLUMN "job_title" TEXT;
ALTER TABLE "public"."business_staff" ADD COLUMN "primary_workspace" "public"."StaffWorkspace";

ALTER TABLE "public"."business_roles" ADD COLUMN "job_preset" TEXT;
CREATE UNIQUE INDEX "business_roles_business_id_job_preset_key" ON "public"."business_roles"("business_id", "job_preset");
