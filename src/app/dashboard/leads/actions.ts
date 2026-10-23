"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { StorefrontLeadStatus } from "@prisma/client";
import { requireAnyStaffPermission, AuthError } from "@/lib/auth/guards";
import { LEAD_STATUSES, LeadNotFoundError, setLeadNotes, setLeadStatus } from "@/modules/storefront-workflows/leads.service";

const LIST = "/dashboard/leads";

/** Anyone who may manage customers or bookings may work the inbox; the business is always the session's. */
async function permitted(back: string) {
  try {
    const { payload } = await requireAnyStaffPermission(["canManageCustomers", "canManageBookings"]);
    return payload;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    redirect(`${back}?err=${encodeURIComponent(err instanceof Error ? err.message : "Not allowed.")}`);
  }
}

export async function setLeadStatusAction(leadId: string, status: StorefrontLeadStatus): Promise<void> {
  const back = `${LIST}/${leadId}`;
  const payload = await permitted(back);
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) redirect(`${back}?err=${encodeURIComponent("Unknown status.")}`);
  let error: string | null = null;
  try {
    await setLeadStatus(payload.tenantId, leadId, status);
  } catch (e) {
    error = e instanceof LeadNotFoundError ? e.message : "Could not update that enquiry.";
  }
  if (error) redirect(`${back}?err=${encodeURIComponent(error)}`);
  revalidatePath(LIST);
  revalidatePath(back);
  redirect(`${back}?saved=1`);
}

export async function saveLeadNotesAction(leadId: string, formData: FormData): Promise<void> {
  const back = `${LIST}/${leadId}`;
  const payload = await permitted(back);
  const notes = formData.get("notes");
  let error: string | null = null;
  try {
    await setLeadNotes(payload.tenantId, leadId, typeof notes === "string" ? notes : "");
  } catch (e) {
    error = e instanceof LeadNotFoundError ? e.message : "Could not save your note.";
  }
  if (error) redirect(`${back}?err=${encodeURIComponent(error)}`);
  revalidatePath(back);
  redirect(`${back}?saved=1`);
}
