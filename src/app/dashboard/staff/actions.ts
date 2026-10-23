"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner, AuthError } from "@/lib/auth/guards";
import { getAppUrl } from "@/lib/utils";
import { sendEmail, staffInviteEmail } from "@/lib/email";
import { inviteStaff, setStaffActive, reinviteStaff, reactivateStaff, updateStaffPreset } from "@/modules/staff/staff.service";
import type { StaffPresetId } from "@/modules/staff/staff-presets";
import { prisma } from "@/lib/prisma/client";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function ownerSession() {
  try {
    return await requireOwner();
  } catch (err) {
    if (err instanceof AuthError) redirect("/login");
    throw err;
  }
}

async function origin(): Promise<string> {
  const h = await headers();
  return getAppUrl(`${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`);
}

export async function invite(formData: FormData): Promise<void> {
  const { tenantId } = await ownerSession();
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const preset = String(formData.get("preset") ?? "GENERAL");
  const jobTitle = String(formData.get("jobTitle") ?? "").trim();

  let outcome: { sent: boolean; firstName: string; setPasswordUrl: string };
  try {
    const { staff, token } = await inviteStaff(tenantId, {
      firstName,
      lastName,
      email,
      preset: preset as never,
      jobTitle: jobTitle || undefined,
    });

    const business = await prisma.business.findUnique({ where: { id: tenantId }, select: { name: true } });
    const setPasswordUrl = `${await origin()}/staff/set-password?token=${token}`;
    const { subject, html, text } = staffInviteEmail({
      businessName: business?.name ?? "your team",
      setPasswordUrl,
    });
    const { sent } = await sendEmail({ to: staff.email, subject, html, text, kind: "staff_invite" });
    outcome = { sent, firstName: staff.firstName, setPasswordUrl };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not send that invite.";
    redirect(`/dashboard/staff?err=${encodeURIComponent(message)}`);
  }

  revalidatePath("/dashboard/staff");

  if (!outcome.sent) {
    // The invite (and its token) is real either way — inviteStaff already
    // committed it. Only the email failed, so say that honestly instead of
    // claiming "sent", and hand over the same link email would have — the
    // merchant's only other way to actually get this person in.
    redirect(
      `/dashboard/staff?err=${encodeURIComponent(
        `Invite created, but we couldn't email it. Share this link with ${outcome.firstName} directly: ${outcome.setPasswordUrl}`,
      )}`,
    );
  }

  redirect("/dashboard/staff?invited=1");
}

export async function resend(staffId: string): Promise<ActionResult> {
  const { tenantId } = await ownerSession();
  try {
    const { staff, token } = await reinviteStaff(tenantId, staffId);
    const business = await prisma.business.findUnique({ where: { id: tenantId }, select: { name: true } });
    const setPasswordUrl = `${await origin()}/staff/set-password?token=${token}`;
    const { subject, html, text } = staffInviteEmail({
      businessName: business?.name ?? "your team",
      setPasswordUrl,
    });
    const { sent } = await sendEmail({ to: staff.email, subject, html, text, kind: "staff_invite" });
    revalidatePath("/dashboard/staff");
    if (!sent) {
      return {
        ok: false,
        error: `Invite renewed, but we couldn't email it. Share this link with ${staff.firstName} directly: ${setPasswordUrl}`,
      };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not resend that invite." };
  }
  return { ok: true };
}

export async function changeStaffRole(formData: FormData): Promise<void> {
  const { tenantId } = await ownerSession();
  const staffId = String(formData.get("staffId") ?? "");
  const preset = String(formData.get("preset") ?? "");
  const jobTitle = String(formData.get("jobTitle") ?? "");

  try {
    await updateStaffPreset(tenantId, staffId, preset as StaffPresetId, jobTitle || undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not update that team member's role.";
    redirect(`/dashboard/staff?err=${encodeURIComponent(message)}`);
  }
  revalidatePath("/dashboard/staff");
  redirect("/dashboard/staff?roleChanged=1");
}

export async function toggleStaffActive(staffId: string, isActive: boolean): Promise<ActionResult> {
  const { tenantId } = await ownerSession();
  try {
    if (!isActive) {
      await setStaffActive(tenantId, staffId, false);
    } else {
      // Coming back always means a new password, via a fresh invite.
      const { staff, token } = await reactivateStaff(tenantId, staffId);
      const business = await prisma.business.findUnique({ where: { id: tenantId }, select: { name: true } });
      const setPasswordUrl = `${await origin()}/staff/set-password?token=${token}`;
      const { subject, html, text } = staffInviteEmail({ businessName: business?.name ?? "your team", setPasswordUrl });
      const { sent } = await sendEmail({ to: staff.email, subject, html, text, kind: "staff_invite" });
      revalidatePath("/dashboard/staff");
      if (!sent) {
        return {
          ok: false,
          error: `${staff.firstName} is active again, but we couldn't email their new invite. Share this link with them directly: ${setPasswordUrl}`,
        };
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update that team member." };
  }
  revalidatePath("/dashboard/staff");
  return { ok: true };
}
