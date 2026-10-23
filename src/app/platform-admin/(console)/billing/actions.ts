"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guards";
import { recordAudit } from "@/modules/platform-admin/audit";
import {
  draftInvoiceForPeriod,
  issueInvoice,
  recordSettlement,
  voidInvoice,
  markUncollectible,
  periodFrom,
  NothingToInvoiceError,
  SettlementRefusedError,
} from "@/modules/billing/invoice.service";
import { InvoiceIssuingBlockedError } from "@/modules/billing/vat";
import { setEntitlementOverride, changeBusinessPlan } from "@/modules/billing/subscription.service";
import { startGrowTrial } from "@/modules/billing/lifecycle.service";
import { prisma } from "@/lib/prisma/client";

const PAGE = "/platform-admin/billing";

/**
 * Platform billing commands — merchants paying Skhokho Laboratory.
 *
 * Every one is gated on `billing.manage`, which only FINANCE and SUPER_ADMIN
 * hold. OPERATIONS deliberately does not: moving a merchant onto a paid plan,
 * comping one or writing an invoice off are financial acts.
 *
 * Every command carries a reason and is audited with the acting admin's id.
 * Nothing here touches a merchant's own customer payments.
 */
async function manager(): Promise<{ adminId: string }> {
  try {
    const admin = await requireAdmin("billing.manage");
    return { adminId: admin.adminId };
  } catch {
    redirect(`${PAGE}?err=${encodeURIComponent("You don't have permission to change billing.")}`);
  }
}

function back(message: string, isError = false): never {
  redirect(`${PAGE}?${isError ? "err" : "ok"}=${encodeURIComponent(message)}`);
}

const Id = z.string().min(1).max(64);
const Reason = z.string().trim().min(5).max(500);

/** Creates this period's draft invoice for a business, from its plan and active services. */
export async function createDraftInvoiceAction(formData: FormData): Promise<void> {
  const { adminId } = await manager();
  const businessId = Id.safeParse(formData.get("businessId"));
  if (!businessId.success) back("Pick a business first.", true);

  const subscription = await prisma.businessSubscription.findUnique({
    where: { businessId: businessId.data },
    select: { currentPeriodEnd: true },
  });
  // A business with no period yet is invoiced from today; one mid-period is
  // invoiced for the period that starts when the current one ends.
  const start = subscription?.currentPeriodEnd ?? new Date();
  const { periodStart, periodEnd } = periodFrom(start);

  try {
    const result = await draftInvoiceForPeriod(businessId.data, periodStart, periodEnd);
    await recordAudit({
      category: "ADMIN_ACTION",
      action: "platform_invoice_drafted",
      actor: { type: "platform_admin", id: adminId },
      businessId: businessId.data,
      resource: { type: "platform_invoice", id: result.id },
      metadata: { created: result.created, periodStart: periodStart.toISOString() },
    });
    revalidatePath(PAGE);
    back(result.created ? "Draft invoice created." : "An invoice already covers that period.");
  } catch (e) {
    if (e instanceof NothingToInvoiceError) back(e.message, true);
    throw e;
  }
}

/** DRAFT → OPEN. Allocates the SKHL-INV number and starts the 7-day clock. */
export async function issueInvoiceAction(formData: FormData): Promise<void> {
  const { adminId } = await manager();
  const invoiceId = Id.safeParse(formData.get("invoiceId"));
  if (!invoiceId.success) back("Which invoice?", true);

  try {
    const { number } = await issueInvoice(invoiceId.data, { adminId });
    revalidatePath(PAGE);
    back(`Invoice ${number} issued.`);
  } catch (e) {
    if (e instanceof InvoiceIssuingBlockedError) back(e.message, true);
    throw e;
  }
}

const Settlement = z.object({
  invoiceId: Id,
  amountCents: z.coerce.number().int().positive(),
  method: z.enum(["EFT", "CASH", "WRITE_OFF"]),
  payerReference: z.string().trim().max(140).optional(),
  receivedAt: z.coerce.date(),
  note: z.string().trim().max(500).optional(),
});

/**
 * Records money that actually arrived, which activates the plan.
 *
 * EFT is the normal path and a permanent first-class method — not a stop-gap
 * until cards work. CARD is deliberately absent from the accepted methods:
 * nothing in Phase A can take one, so offering it here would be a lie.
 */
export async function recordSettlementAction(formData: FormData): Promise<void> {
  const { adminId } = await manager();
  const parsed = Settlement.safeParse({
    invoiceId: formData.get("invoiceId"),
    amountCents: formData.get("amountCents"),
    method: formData.get("method"),
    payerReference: formData.get("payerReference") ?? undefined,
    receivedAt: formData.get("receivedAt") || new Date().toISOString(),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) back("Check the amount, method and date.", true);

  try {
    const { reference, planCode } = await recordSettlement(parsed.data.invoiceId, {
      amountCents: parsed.data.amountCents,
      method: parsed.data.method,
      receivedAt: parsed.data.receivedAt,
      payerReference: parsed.data.payerReference ?? null,
      note: parsed.data.note ?? null,
      adminId,
    });
    revalidatePath(PAGE);
    back(`Payment recorded (${reference})${planCode ? ` — ${planCode} is active.` : "."}`);
  } catch (e) {
    if (e instanceof SettlementRefusedError) back(e.message, true);
    throw e;
  }
}

export async function voidInvoiceAction(formData: FormData): Promise<void> {
  const { adminId } = await manager();
  const invoiceId = Id.safeParse(formData.get("invoiceId"));
  const reason = Reason.safeParse(formData.get("reason"));
  if (!invoiceId.success) back("Which invoice?", true);
  if (!reason.success) back("A reason is required (at least 5 characters).", true);

  try {
    await voidInvoice(invoiceId.data, reason.data, adminId);
  } catch (e) {
    back(e instanceof Error ? e.message : "Could not cancel that invoice.", true);
  }
  revalidatePath(PAGE);
  back("Invoice cancelled.");
}

export async function writeOffInvoiceAction(formData: FormData): Promise<void> {
  const { adminId } = await manager();
  const invoiceId = Id.safeParse(formData.get("invoiceId"));
  const reason = Reason.safeParse(formData.get("reason"));
  if (!invoiceId.success) back("Which invoice?", true);
  if (!reason.success) back("A reason is required (at least 5 characters).", true);

  await markUncollectible(invoiceId.data, reason.data, adminId);
  revalidatePath(PAGE);
  back("Invoice written off.");
}

const Comp = z.object({
  businessId: Id,
  planCode: z.enum(["FREE", "GROW", "PRO"]),
  months: z.coerce.number().int().min(1).max(24),
  reason: Reason,
});

/**
 * Comps or extends a plan without payment — a pilot, a goodwill fix, a
 * delayed invoice.
 *
 * Moves the subscription's plan and dates only. It never writes
 * plan_entitlements, so what the comp grants is exactly what that plan grants
 * to everyone else, and it expires on its own at currentPeriodEnd.
 */
export async function compPlanAction(formData: FormData): Promise<void> {
  const { adminId } = await manager();
  const parsed = Comp.safeParse({
    businessId: formData.get("businessId"),
    planCode: formData.get("planCode"),
    months: formData.get("months"),
    reason: formData.get("reason"),
  });
  if (!parsed.success) back("Check the plan, the number of months and the reason.", true);

  const { businessId, planCode, months, reason } = parsed.data;
  const existing = await prisma.businessSubscription.findUnique({
    where: { businessId },
    select: { currentPeriodEnd: true },
  });
  const from = existing?.currentPeriodEnd && existing.currentPeriodEnd > new Date() ? existing.currentPeriodEnd : new Date();
  const until = new Date(from);
  until.setUTCMonth(until.getUTCMonth() + months);

  await changeBusinessPlan(businessId, planCode, { status: "ACTIVE", currentPeriodEnd: until });
  await recordAudit({
    category: "ADMIN_ACTION",
    action: "platform_plan_comped",
    actor: { type: "platform_admin", id: adminId },
    businessId,
    resource: { type: "business_subscription", id: businessId },
    reason,
    metadata: { planCode, months, until: until.toISOString(), paid: false },
  });
  revalidatePath(PAGE);
  back(`${planCode} active until ${until.toISOString().slice(0, 10)}.`);
}

const Override = z.object({
  businessId: Id,
  featureKey: z.string().trim().min(1).max(80),
  enabled: z.enum(["true", "false"]),
  limitValue: z.string().trim().optional(),
  reason: Reason,
});

/** A per-business exception to its plan. Always carries a reason. */
export async function setOverrideAction(formData: FormData): Promise<void> {
  const { adminId } = await manager();
  const parsed = Override.safeParse({
    businessId: formData.get("businessId"),
    featureKey: formData.get("featureKey"),
    enabled: formData.get("enabled"),
    limitValue: formData.get("limitValue") ?? undefined,
    reason: formData.get("reason"),
  });
  if (!parsed.success) back("Check the feature, the value and the reason.", true);

  const limit = parsed.data.limitValue ? Number(parsed.data.limitValue) : null;
  if (limit !== null && (!Number.isInteger(limit) || limit < 0)) back("A limit must be a whole number.", true);

  try {
    await setEntitlementOverride(parsed.data.businessId, parsed.data.featureKey, {
      enabled: parsed.data.enabled === "true",
      limitValue: limit,
      reason: parsed.data.reason,
    });
  } catch (e) {
    back(e instanceof Error ? e.message : "Could not set that override.", true);
  }

  await recordAudit({
    category: "ADMIN_ACTION",
    action: "platform_entitlement_override_set",
    actor: { type: "platform_admin", id: adminId },
    businessId: parsed.data.businessId,
    resource: { type: "entitlement_override", id: parsed.data.featureKey },
    reason: parsed.data.reason,
    metadata: { featureKey: parsed.data.featureKey, enabled: parsed.data.enabled, limitValue: limit },
  });
  revalidatePath(PAGE);
  back("Override saved.");
}

/** Starts the 14-day GROW trial by hand, for a business that predates it. */
export async function startTrialAction(formData: FormData): Promise<void> {
  const { adminId } = await manager();
  const businessId = Id.safeParse(formData.get("businessId"));
  if (!businessId.success) back("Pick a business first.", true);

  const outcome = await startGrowTrial(businessId.data);
  if (!outcome.started) {
    back(
      outcome.reason === "no_trial_plan"
        ? "The GROW plan is missing — the plans seed has not run."
        : "That business already has a subscription.",
      true,
    );
  }
  await recordAudit({
    category: "ADMIN_ACTION",
    action: "platform_trial_started_manually",
    actor: { type: "platform_admin", id: adminId },
    businessId: businessId.data,
    resource: { type: "business_subscription", id: businessId.data },
    metadata: { endsAt: outcome.endsAt.toISOString() },
  });
  revalidatePath(PAGE);
  back("Trial started.");
}
