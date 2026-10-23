"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import {
  confirmAppointment,
  completeAppointment,
  cancelAppointment,
} from "@/modules/appointments/appointment.service";

export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Returns a discriminated result rather than throwing on a permission
 * failure (403) — see the identical comment on catalog/actions.ts's
 * version of this helper for why a thrown 403 can't be caught by the
 * caller without also swallowing the redirect("/login") a 401 needs.
 *
 * Gated on `canManageBookings` (added Phase 5) rather than the
 * `canManageOrders` this used as a stand-in before that key existed —
 * completing/cancelling a booking is booking management, not order
 * management, and a role could reasonably grant one without the other.
 */
async function permittedSession(): Promise<
  { ok: true; tenantId: string } | { ok: false; error: string }
> {
  try {
    const { payload } = await requireStaffPermission("canManageBookings");
    return { ok: true, tenantId: payload.tenantId };
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    return { ok: false, error: err instanceof Error ? err.message : "Not allowed." };
  }
}

export async function confirmAppointmentAction(appointmentId: string): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    await confirmAppointment(session.tenantId, appointmentId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not confirm that booking." };
  }
  revalidatePath("/dashboard/appointments");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function markAppointmentComplete(appointmentId: string): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    await completeAppointment(session.tenantId, appointmentId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not complete that booking." };
  }
  revalidatePath("/dashboard/appointments");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function cancelAppointmentAction(appointmentId: string): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    await cancelAppointment(session.tenantId, appointmentId, "Cancelled by business");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not cancel that booking." };
  }
  revalidatePath("/dashboard/appointments");
  revalidatePath("/dashboard");
  return { ok: true };
}
