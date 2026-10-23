"use server";

import { revalidatePath } from "next/cache";
import { requireStaff, AuthError } from "@/lib/auth/guards";
import { markAllNotificationsRead } from "@/modules/dashboard/notifications";

/** Any signed-in staff member (not owner-only) — isRead is a shared flag on the business's notifications, not per-staff-member state, same as any other team-visible dashboard data. */
export async function markAllNotificationsReadAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  let tenantId: string;
  try {
    const payload = await requireStaff();
    tenantId = payload.tenantId;
  } catch (err) {
    if (err instanceof AuthError) return { ok: false, error: "You don't have permission to do this." };
    return { ok: false, error: "Not allowed." };
  }

  try {
    await markAllNotificationsRead(tenantId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update notifications." };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}
