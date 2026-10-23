-- Stable identifier for BusinessRole presets (Owner/Manager/Staff/Cashier/
-- Technician), so the staff-invite role picker can resolve to the correct
-- role instead of always falling back to the isDefault row regardless of
-- the selection. Nullable and additive — no existing row's permissions or
-- role assignment changes. Backfilling presetRole onto pre-existing
-- businesses' rows, and creating the new Manager/Cashier/Technician rows
-- they don't yet have, is a separate, deliberate step
-- (prisma/scripts/backfill-role-presets.ts), not run automatically here.
ALTER TABLE "public"."business_roles" ADD COLUMN "preset_role" "public"."StaffRole";

CREATE UNIQUE INDEX "business_roles_business_id_preset_role_key" ON "public"."business_roles"("business_id", "preset_role");
