"use server";

import { revalidatePath } from "next/cache";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import { publishBusiness, PublishValidationError } from "@/modules/tenant/tenant.service";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Publish gate reuses canManageSettings — going live is a whole-business
 * settings decision, not a distinct permission worth a new StaffPermissions
 * key + backfill script for one action.
 */
export async function publishBusinessAction(): Promise<ActionResult> {
  let tenantId: string;
  try {
    const { payload } = await requireStaffPermission("canManageSettings");
    tenantId = payload.tenantId;
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, error: "You don't have permission to publish this business." };
    return { ok: false, error: "Something went wrong. Try again." };
  }

  try {
    await publishBusiness(tenantId);
  } catch (err) {
    if (err instanceof PublishValidationError) {
      return { ok: false, error: `Not ready to publish yet — ${err.missing.join(", ").toLowerCase()}.` };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Could not publish. Try again." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/discover");
  return { ok: true };
}
