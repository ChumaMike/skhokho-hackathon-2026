"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import { parseHoursForm, setOperatingHours } from "@/modules/tenant/operating-hours";
import { setOrderingPause } from "@/modules/tenant/capabilities";

const PAGE = "/dashboard/settings/hours";

function revalidateTrading() {
  for (const p of [PAGE, "/dashboard", "/dashboard/orders", "/dashboard/settings"]) revalidatePath(p);
}

/** Weekly hours: a settings change (canManageSettings). */
export async function updateOperatingHours(fd: FormData): Promise<void> {
  let tenantId: string;
  try {
    ({ payload: { tenantId } } = await requireStaffPermission("canManageSettings"));
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    redirect(`${PAGE}?err=${encodeURIComponent(err instanceof Error ? err.message : "Not allowed.")}`);
  }
  try {
    await setOperatingHours(tenantId, parseHoursForm(fd));
  } catch (e) {
    redirect(`${PAGE}?err=${encodeURIComponent(e instanceof Error ? e.message : "Could not save your hours.")}`);
  }
  revalidateTrading();
  redirect(`${PAGE}?saved=1`);
}

const PAUSE_MINUTES: Record<string, number> = { "30": 30, "60": 60, "120": 120, "240": 240, "rest": 24 * 60 };

/**
 * "Pause orders now" is an operational, during-the-shift action — anyone who
 * runs the order queue (canManageOrders) may pause and resume. The weekly
 * hours above stay a settings change.
 */
export async function pauseOrdersAction(returnTo: string, fd: FormData): Promise<void> {
  let tenantId: string;
  try {
    ({ payload: { tenantId } } = await requireStaffPermission("canManageOrders"));
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    redirect(`${safeReturn(returnTo)}?err=${encodeURIComponent(err instanceof Error ? err.message : "Not allowed.")}`);
  }
  const choice = String(fd.get("duration") ?? "");
  const minutes = PAUSE_MINUTES[choice];
  try {
    if (choice === "resume") await setOrderingPause(tenantId, null);
    else if (minutes) await setOrderingPause(tenantId, new Date(Date.now() + minutes * 60_000));
    else throw new Error("Choose how long to pause for.");
  } catch (e) {
    redirect(`${safeReturn(returnTo)}?err=${encodeURIComponent(e instanceof Error ? e.message : "Could not update the pause.")}`);
  }
  revalidateTrading();
  redirect(`${safeReturn(returnTo)}?saved=1`);
}

/** Only our own dashboard paths — a return target is never an open redirect. */
function safeReturn(p: string): string {
  return /^\/dashboard(\/[a-z0-9/-]*)?$/.test(p) ? p : PAGE;
}
