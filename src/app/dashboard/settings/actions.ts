"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff, requireStaffPermission, AuthError } from "@/lib/auth/guards";
import { updateBusiness } from "@/modules/tenant/tenant.service";
import { setDeliverySettings, setOrderingSettings, setBusinessModule, isSwitchableModule, ModuleError } from "@/modules/tenant/capabilities";
import { getBusinessEntitlements } from "@/modules/billing/subscription.service";
import { recordAudit, requestContext } from "@/modules/platform-admin/audit";
import { uploadCatalogImage } from "@/lib/blob";
import { setThemePreference, type ThemePreference } from "@/lib/theme";
import { trimmedOrUndefined } from "@/lib/utils";
import { geocodeAddress } from "@/lib/geocoding";
import { prisma } from "@/lib/prisma/client";
import { getAppUrl } from "@/lib/utils";
import { sendEmail, businessEmailVerifyEmail, isEmailConfigured } from "@/lib/email";
import {
  requestEmailChange,
  reissueEmailChange,
  cancelEmailChange,
  BusinessEmailError,
} from "@/modules/tenant/business-email";

/**
 * Appearance is a per-browser display preference, not a business setting —
 * any signed-in team member can set their own, regardless of whether they
 * hold canManageSettings (that permission is about the business's data,
 * not this cookie). Bound to a specific theme per button, same pattern as
 * verifyDomainAction.bind(null, domain.id) elsewhere in this codebase.
 */
export async function setTheme(theme: ThemePreference): Promise<void> {
  await requireStaff();
  await setThemePreference(theme);
  revalidatePath("/", "layout");
}

/** Business-profile self-service — updateBusiness has existed in
 * tenant.service.ts since before this session and was called from zero
 * routes until now. */
async function permittedRedirect() {
  try {
    const { payload } = await requireStaffPermission("canManageSettings");
    return payload;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    const message = err instanceof Error ? err.message : "Not allowed.";
    redirect(`/dashboard/settings?err=${encodeURIComponent(message)}`);
  }
}

export async function updateSettings(formData: FormData): Promise<void> {
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
    const business = await updateBusiness(tenantId, {
      name: trimmedOrUndefined(formData.get("name")),
      description: trimmedOrUndefined(formData.get("description")),
      phone: trimmedOrUndefined(formData.get("phone")),
      whatsapp: trimmedOrUndefined(formData.get("whatsapp")),
      address: trimmedOrUndefined(formData.get("address")),
      suburb: trimmedOrUndefined(formData.get("suburb")),
      city: trimmedOrUndefined(formData.get("city")),
      province: trimmedOrUndefined(formData.get("province")),
      postalCode: trimmedOrUndefined(formData.get("postalCode")),
      primaryColor: trimmedOrUndefined(formData.get("primaryColor")),
      accentColor: trimmedOrUndefined(formData.get("accentColor")),
      ...(logoUrl && { logoUrl }),
    });

    // Best-effort — pins the business on the map for "near me" discovery and
    // for PER_KM delivery pricing. Never blocks the settings save: a business
    // that never touches PER_KM pricing is entirely unaffected by this ever
    // failing, and even a PER_KM business can still save every other setting
    // while this quietly surfaces a warning instead.
    const addressLine = [business.address, business.suburb, business.city, business.province, "South Africa"]
      .filter((part) => part && part.trim())
      .join(", ");
    if (addressLine) {
      const geo = await geocodeAddress(addressLine);
      if (geo) {
        await prisma.business.update({
          where: { id: tenantId },
          data: { latitude: geo.lat, longitude: geo.lng },
        });
      } else if (!warning) {
        warning =
          "Saved, but we couldn't pinpoint your business on the map — per-km delivery pricing needs this. Check your street address.";
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save your changes.";
    redirect(`/dashboard/settings?err=${encodeURIComponent(message)}`);
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  redirect(
    warning
      ? `/dashboard/settings?saved=1&err=${encodeURIComponent(warning)}`
      : "/dashboard/settings?saved=1",
  );
}

/**
 * The only caller of setDeliverySettings (src/modules/tenant/capabilities.ts)
 * — that function has existed since the Delivery milestone, but nothing
 * before this form ever invoked it. Rand-to-cents conversion happens here,
 * matching how every other money field in this codebase is stored
 * (integer cents), never as a float.
 */
export async function updateDeliverySettings(formData: FormData): Promise<void> {
  const { tenantId } = await permittedRedirect();

  const enabled = formData.get("enabled") === "on";
  const pricingMode = formData.get("pricingMode") === "PER_KM" ? "PER_KM" : "FLAT";
  const feeRand = Number(formData.get("fee"));
  const feeCents = Number.isFinite(feeRand) && feeRand >= 0 ? Math.round(feeRand * 100) : 0;
  const perKmFeeRand = Number(formData.get("perKmFee"));
  const perKmFeeCents = Number.isFinite(perKmFeeRand) && perKmFeeRand >= 0 ? Math.round(perKmFeeRand * 100) : 0;
  const areaInfo = trimmedOrUndefined(formData.get("areaInfo"));

  try {
    await setDeliverySettings(tenantId, { enabled, pricingMode, feeCents, perKmFeeCents, areaInfo });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save delivery settings.";
    redirect(`/dashboard/settings?err=${encodeURIComponent(message)}`);
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  redirect("/dashboard/settings?saved=1");
}

export async function updateMinimumOrder(formData: FormData): Promise<void> {
  const { tenantId } = await permittedRedirect();

  const minRand = Number(formData.get("minOrder"));
  const minOrderCents = Number.isFinite(minRand) && minRand >= 0 ? Math.round(minRand * 100) : 0;

  try {
    await setOrderingSettings(tenantId, { minOrderCents });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not save your minimum order.";
    redirect(`/dashboard/settings?err=${encodeURIComponent(message)}`);
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/storefront/ordering");
  redirect("/dashboard/settings?saved=1");
}

// ---------------------------------------------------------------------------
// Business contact email — changed only through a link sent to the NEW address
// (src/modules/tenant/business-email.ts). Nothing customer-facing changes
// until that link is opened.
// ---------------------------------------------------------------------------

async function sendVerification(tenantId: string, pendingEmail: string, token: string): Promise<string | null> {
  if (!isEmailConfigured()) {
    return "Email isn't set up on this server yet, so we can't send the confirmation link. Ask support to confirm the address for you.";
  }
  const business = await prisma.business.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
  const verifyUrl = `${getAppUrl()}/api/platform/verify-business-email?token=${encodeURIComponent(token)}`;
  const { subject, html, text } = businessEmailVerifyEmail({ businessName: business.name, verifyUrl });
  const { sent } = await sendEmail({ to: pendingEmail, subject, html, text, kind: "business_email_verify" });
  return sent ? null : "We couldn't send the confirmation email just now. Try 'Send the link again' in a minute.";
}

export async function requestEmailChangeAction(formData: FormData): Promise<void> {
  const { tenantId } = await permittedRedirect();
  let pending: { pendingEmail: string; token: string };
  try {
    pending = await requestEmailChange(tenantId, String(formData.get("newEmail") ?? ""));
  } catch (e) {
    if (e instanceof BusinessEmailError) redirect(`/dashboard/settings?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
  const warning = await sendVerification(tenantId, pending.pendingEmail, pending.token);
  revalidatePath("/dashboard/settings");
  redirect(warning ? `/dashboard/settings?emailPending=1&err=${encodeURIComponent(warning)}` : "/dashboard/settings?emailPending=1");
}

export async function resendEmailChangeAction(): Promise<void> {
  const { tenantId } = await permittedRedirect();
  const reissued = await reissueEmailChange(tenantId);
  if (!reissued) redirect("/dashboard/settings?err=There+is+no+email+change+waiting+to+be+confirmed.");
  const warning = await sendVerification(tenantId, reissued.pendingEmail, reissued.token);
  revalidatePath("/dashboard/settings");
  redirect(warning ? `/dashboard/settings?emailPending=1&err=${encodeURIComponent(warning)}` : "/dashboard/settings?emailPending=1");
}

export async function cancelEmailChangeAction(): Promise<void> {
  const { tenantId } = await permittedRedirect();
  await cancelEmailChange(tenantId);
  revalidatePath("/dashboard/settings");
  redirect("/dashboard/settings?saved=1");
}

// ---------------------------------------------------------------------------
// Modules — a business switches on what its category did not grant by
// default (e.g. Bookings for a food vendor), subject to its plan. The
// decision itself is applyModuleToggle (capabilities.ts); this only
// authorises the person and loads the plan.
// ---------------------------------------------------------------------------

export async function setModuleAction(module: string, enabled: boolean): Promise<void> {
  const { tenantId, staffId } = await permittedRedirect();
  if (!isSwitchableModule(module)) redirect("/dashboard/settings?err=That+module+cannot+be+switched+here.");
  try {
    const entitlements = await getBusinessEntitlements(tenantId);
    await setBusinessModule(tenantId, module, enabled, entitlements);
    await recordAudit({
      category: "MERCHANT_ACTION",
      action: enabled ? "module_switched_on" : "module_switched_off",
      actor: { type: "staff", id: staffId },
      businessId: tenantId,
      resource: { type: "business", id: tenantId },
      metadata: { module },
      ...(await requestContext()),
    });
  } catch (e) {
    if (e instanceof ModuleError) redirect(`/dashboard/settings?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/dashboard", "layout");
  redirect("/dashboard/settings?saved=1");
}
