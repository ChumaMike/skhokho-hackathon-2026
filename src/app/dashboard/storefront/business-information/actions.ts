"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import { updateBusiness } from "@/modules/tenant/tenant.service";
import { uploadCatalogImage } from "@/lib/blob";
import { trimmedOrUndefined } from "@/lib/utils";

/**
 * Same write path as dashboard/settings/actions.ts's updateSettings —
 * updateBusiness (tenant.service.ts) stays the one source of truth for
 * business identity fields, never duplicated. This is a thin,
 * differently-redirected controller so the Storefront Console's Business
 * information page (§8) gives feedback in place rather than bouncing the
 * merchant back to Settings. Deliberately excludes primaryColor/accentColor
 * — those are Design's job (Storefront Theme Engine), and this milestone's
 * §7 explicitly forbids a second place to edit theme controls.
 */
async function permittedRedirect() {
  try {
    const { payload } = await requireStaffPermission("canManageSettings");
    return payload;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    const message = err instanceof Error ? err.message : "Not allowed.";
    redirect(`/dashboard/storefront/business-information?err=${encodeURIComponent(message)}`);
  }
}

export async function updateBusinessInformation(formData: FormData): Promise<void> {
  const { tenantId } = await permittedRedirect();

  let logoUrl: string | undefined;
  let warning: string | undefined;
  const logoFile = formData.get("logo");
  if (logoFile instanceof File && logoFile.size > 0) {
    try {
      logoUrl = await uploadCatalogImage(logoFile, tenantId, "business");
    } catch (e) {
      warning = e instanceof Error ? e.message : "Could not upload that logo.";
    }
  }

  try {
    await updateBusiness(tenantId, {
      name: trimmedOrUndefined(formData.get("name")),
      description: trimmedOrUndefined(formData.get("description")),
      phone: trimmedOrUndefined(formData.get("phone")),
      whatsapp: trimmedOrUndefined(formData.get("whatsapp")),
      address: trimmedOrUndefined(formData.get("address")),
      suburb: trimmedOrUndefined(formData.get("suburb")),
      city: trimmedOrUndefined(formData.get("city")),
      province: trimmedOrUndefined(formData.get("province")),
      postalCode: trimmedOrUndefined(formData.get("postalCode")),
      ...(logoUrl && { logoUrl }),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save your changes.";
    redirect(`/dashboard/storefront/business-information?err=${encodeURIComponent(message)}`);
  }

  revalidatePath("/dashboard/storefront/business-information");
  revalidatePath("/dashboard/storefront");
  revalidatePath("/dashboard");
  redirect(
    warning
      ? `/dashboard/storefront/business-information?saved=1&err=${encodeURIComponent(warning)}`
      : "/dashboard/storefront/business-information?saved=1",
  );
}
