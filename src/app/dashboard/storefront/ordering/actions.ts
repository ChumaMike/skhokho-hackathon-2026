"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import { setDeliverySettings, setOrderingSettings } from "@/modules/tenant/capabilities";
import { trimmedOrUndefined } from "@/lib/utils";

/**
 * Same write path as dashboard/settings/actions.ts's updateDeliverySettings
 * — setDeliverySettings (capabilities.ts) is the one place delivery is ever
 * turned on/off and priced, reused here rather than reimplemented. A thin,
 * differently-redirected controller, same pattern as
 * business-information/actions.ts.
 */
async function permittedRedirect() {
  try {
    const { payload } = await requireStaffPermission("canManageSettings");
    return payload;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    const message = err instanceof Error ? err.message : "Not allowed.";
    redirect(`/dashboard/storefront/ordering?err=${encodeURIComponent(message)}`);
  }
}

export async function updateOrderingDelivery(formData: FormData): Promise<void> {
  const { tenantId } = await permittedRedirect();

  const enabled = formData.get("enabled") === "on";
  const feeRand = Number(formData.get("fee"));
  const feeCents = Number.isFinite(feeRand) && feeRand >= 0 ? Math.round(feeRand * 100) : 0;
  const areaInfo = trimmedOrUndefined(formData.get("areaInfo"));

  try {
    await setDeliverySettings(tenantId, { enabled, feeCents, areaInfo });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save delivery settings.";
    redirect(`/dashboard/storefront/ordering?err=${encodeURIComponent(message)}`);
  }

  revalidatePath("/dashboard/storefront/ordering");
  revalidatePath("/dashboard/storefront");
  revalidatePath("/dashboard");
  redirect("/dashboard/storefront/ordering?saved=1");
}

/** Same write path as dashboard/settings/actions.ts's updateMinimumOrder — setOrderingSettings reused here, not reimplemented. */
export async function updateOrderingMinimum(formData: FormData): Promise<void> {
  const { tenantId } = await permittedRedirect();

  const minRand = Number(formData.get("minOrder"));
  const minOrderCents = Number.isFinite(minRand) && minRand >= 0 ? Math.round(minRand * 100) : 0;

  try {
    await setOrderingSettings(tenantId, { minOrderCents });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save your minimum order.";
    redirect(`/dashboard/storefront/ordering?err=${encodeURIComponent(message)}`);
  }

  revalidatePath("/dashboard/storefront/ordering");
  revalidatePath("/dashboard/settings");
  redirect("/dashboard/storefront/ordering?saved=1");
}

/** Tab 5 — typical preparation time (whole minutes, 0–240). Customer accounts reads it as the ETA on confirmations. */
export async function updateOrderingPrepTime(formData: FormData): Promise<void> {
  const { tenantId } = await permittedRedirect();
  const raw = String(formData.get("prepMinutes") ?? "").trim();
  const prepMinutes = raw === "" ? 0 : Number(raw);
  try {
    await setOrderingSettings(tenantId, { prepMinutes });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save your preparation time.";
    redirect(`/dashboard/storefront/ordering?err=${encodeURIComponent(message)}`);
  }
  revalidatePath("/dashboard/storefront/ordering");
  redirect("/dashboard/storefront/ordering?saved=1");
}
