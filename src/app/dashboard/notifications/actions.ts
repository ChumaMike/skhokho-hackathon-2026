"use server";

import { revalidatePath } from "next/cache";
import { requireStaff, AuthError } from "@/lib/auth/guards";
import { markAllNotificationsReadFor, markNotificationReadFor } from "@/modules/dashboard/notifications";

type Result = { ok: true } | { ok: false; error: string };

async function who(): Promise<{ tenantId: string; staffId: string } | null> {
  try {
    const payload = await requireStaff();
    return { tenantId: payload.tenantId, staffId: payload.staffId };
  } catch (err) {
    return err instanceof AuthError ? null : null;
  }
}

/** Marks everything read for THIS person only — teammates keep their own unread state. */
export async function markAllReadAction(): Promise<Result> {
  const me = await who();
  if (!me) return { ok: false, error: "You don't have permission to do this." };
  await markAllNotificationsReadFor(me.tenantId, me.staffId);
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/notifications");
  return { ok: true };
}

export async function markReadAction(notificationId: string): Promise<Result> {
  const me = await who();
  if (!me) return { ok: false, error: "You don't have permission to do this." };
  await markNotificationReadFor(me.tenantId, me.staffId, String(notificationId).slice(0, 64));
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/notifications");
  return { ok: true };
}
