"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import { setLegalInformation } from "@/modules/tenant/legal-information";
import { trimmedOrUndefined } from "@/lib/utils";

const PAGE = "/dashboard/settings/legal";

/**
 * Legal identity for the storefront's ECTA block — a settings change
 * (canManageSettings), same guard and redirect shape as the other settings
 * sub-pages. Saved under settings.legal; the storefront footer and merchant
 * readiness read it on the next request.
 */
export async function updateLegalInformation(fd: FormData): Promise<void> {
  let tenantId: string;
  try {
    ({ payload: { tenantId } } = await requireStaffPermission("canManageSettings"));
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    redirect(`${PAGE}?err=${encodeURIComponent(err instanceof Error ? err.message : "Not allowed.")}`);
  }
  try {
    await setLegalInformation(tenantId, {
      legalName: trimmedOrUndefined(fd.get("legalName")) ?? null,
      registrationNumber: trimmedOrUndefined(fd.get("registrationNumber")) ?? null,
      returnsText: trimmedOrUndefined(fd.get("returnsText")) ?? null,
      complaintsContact: trimmedOrUndefined(fd.get("complaintsContact")) ?? null,
    });
  } catch (e) {
    redirect(`${PAGE}?err=${encodeURIComponent(e instanceof Error ? e.message : "Could not save your legal details.")}`);
  }
  for (const p of [PAGE, "/dashboard/settings", "/dashboard"]) revalidatePath(p);
  redirect(`${PAGE}?saved=1`);
}
