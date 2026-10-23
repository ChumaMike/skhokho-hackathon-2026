"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma/client";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import { recordAudit } from "@/modules/platform-admin/audit";
import { setSubscriptionStatus } from "@/modules/billing/subscription.service";

export type ActionResult = { ok: true } | { ok: false; error: string };

const PAGE = "/dashboard/settings/plan";

/**
 * Every action here is gated on canManageBilling — the same gate as
 * Settings > Payments, and for the same reason: no staff preset grants it, so
 * in practice only the business owner reaches these. What a business pays
 * Skhokho Laboratory is not a cashier's concern.
 *
 * Phase A takes no card and sells nothing self-service. An upgrade is a
 * REQUEST that Skhokho Labs picks up; a cancellation is real and immediate
 * (it stops renewal, not access already paid for).
 */
async function permitted(): Promise<{ tenantId: string; staffId: string }> {
  try {
    const { payload } = await requireStaffPermission("canManageBilling");
    // payload.staffId, not staff.id: `staff` is null for an owner, whose token
    // carries their AppUser.id here (see the comment in requireStaffPermission).
    return { tenantId: payload.tenantId, staffId: payload.staffId };
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    const message = err instanceof Error ? err.message : "Not allowed.";
    redirect(`${PAGE}?err=${encodeURIComponent(message)}`);
  }
}

const PlanCode = z.enum(["FREE", "GROW", "PRO"]);

/**
 * Records a plan-change request.
 *
 * Deliberately not a purchase: Phase A cannot take money, and the managed
 * services are sold by conversation anyway. The request lands as an audit
 * event the Control Centre lists, so a real person follows it up — rather
 * than a button that pretends to charge and silently does nothing.
 */
export async function requestPlanChangeAction(formData: FormData): Promise<void> {
  const { tenantId, staffId } = await permitted();
  const parsed = PlanCode.safeParse(formData.get("planCode"));
  if (!parsed.success) redirect(`${PAGE}?err=${encodeURIComponent("Pick a plan first.")}`);

  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const plan = await prisma.plan.findUnique({
    where: { code: parsed.data },
    select: { name: true, priceCents: true },
  });

  await recordAudit({
    category: "MERCHANT_ACTION",
    action: "platform_plan_change_requested",
    actor: { type: "staff", id: staffId },
    businessId: tenantId,
    resource: { type: "plan", id: parsed.data },
    reason: note || null,
    metadata: { requestedPlan: parsed.data, priceCents: plan?.priceCents ?? null },
  });

  await prisma.businessNotification
    .create({
      data: {
        businessId: tenantId,
        type: "platform_billing",
        title: "Plan change requested",
        message: `We've got your request to move to ${plan?.name ?? parsed.data}. We'll be in touch to set it up.`,
        data: { requestedPlan: parsed.data },
      },
    })
    .catch(() => undefined);

  revalidatePath(PAGE);
  redirect(`${PAGE}?ok=${encodeURIComponent("Thanks — we've got your request and we'll be in touch.")}`);
}

/**
 * Cancels renewal. Real and immediate in effect, but access already paid for
 * is kept: the resolver's CANCELLED_PENDING state runs the plan to
 * currentPeriodEnd and only then falls back to FREE. Nothing is deleted.
 */
export async function cancelSubscriptionAction(): Promise<ActionResult> {
  const { tenantId, staffId } = await permitted();
  const subscription = await prisma.businessSubscription.findUnique({
    where: { businessId: tenantId },
    select: { status: true, currentPeriodEnd: true },
  });
  if (!subscription || subscription.status === "CANCELLED" || subscription.status === "EXPIRED") {
    return { ok: false, error: "There is no active plan to cancel." };
  }

  await setSubscriptionStatus(tenantId, "CANCELLED");
  await recordAudit({
    category: "MERCHANT_ACTION",
    action: "platform_subscription_cancelled",
    actor: { type: "staff", id: staffId },
    businessId: tenantId,
    resource: { type: "business_subscription", id: tenantId },
    metadata: { accessUntil: subscription.currentPeriodEnd?.toISOString() ?? null, dataDeleted: false },
  });

  revalidatePath(PAGE);
  return { ok: true };
}

const BillingEmail = z.string().trim().email().max(200);

/**
 * Changes where invoices and reminders go.
 *
 * Billing is deliberately not tied to the owner's login address: a bookkeeper
 * handles it in plenty of businesses, and a business can change hands.
 */
export async function updateBillingEmailAction(formData: FormData): Promise<void> {
  const { tenantId, staffId } = await permitted();
  const parsed = BillingEmail.safeParse(formData.get("billingEmail"));
  if (!parsed.success) {
    redirect(`${PAGE}?err=${encodeURIComponent("That doesn't look like an email address.")}`);
  }

  const updated = await prisma.businessSubscription.updateMany({
    where: { businessId: tenantId },
    data: { billingEmail: parsed.data },
  });
  if (updated.count === 0) {
    redirect(`${PAGE}?err=${encodeURIComponent("There's no billing account to update yet.")}`);
  }

  await recordAudit({
    category: "MERCHANT_ACTION",
    action: "platform_billing_email_changed",
    actor: { type: "staff", id: staffId },
    businessId: tenantId,
    resource: { type: "business_subscription", id: tenantId },
    // The address itself is the point of the change, but it is personal data:
    // recorded as changed, not quoted.
    metadata: { changed: true },
  });

  revalidatePath(PAGE);
  redirect(`${PAGE}?ok=${encodeURIComponent("Billing email updated.")}`);
}
