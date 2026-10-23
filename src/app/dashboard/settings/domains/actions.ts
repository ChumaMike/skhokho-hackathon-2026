"use server";

import { randomBytes } from "node:crypto";
import { ZodError } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import { addDomain, checkDomain, removeDomain, setPrimaryDomain, DomainNotFoundError, DomainUnavailableError } from "@/modules/domains/domain.service";
import {
  cancelPurchase,
  completePurchase,
  getTransferCode,
  setAutoRenew,
  startPurchase,
  RegistrationError,
} from "@/modules/domains/domain-registration.service";
import { getRegistrar } from "@/modules/domains/registrar";
import { prisma } from "@/lib/prisma/client";
import { getBusinessEntitlements } from "@/modules/billing/subscription.service";
import { assertFeature } from "@/lib/auth/entitlement-guards";

export type ActionResult = { ok: true } | { ok: false; error: string };

const PAGE = "/dashboard/settings/domains";

/**
 * Every action: the PERSON needs canManageDomains; adding or buying also
 * needs the BUSINESS's plan to include custom_domain. Removing a domain,
 * renewal settings and the transfer code never depend on the plan — a
 * merchant must never be trapped. The business is always the session's.
 */
async function permittedRedirect() {
  try {
    const { payload } = await requireStaffPermission("canManageDomains");
    return payload;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    redirect(`${PAGE}?err=${encodeURIComponent(err instanceof Error ? err.message : "Not allowed.")}`);
  }
}

async function permittedSession(): Promise<{ ok: true; tenantId: string; isOwner: boolean } | { ok: false; error: string }> {
  try {
    const { payload } = await requireStaffPermission("canManageDomains");
    return { ok: true, tenantId: payload.tenantId, isOwner: payload.isOwner };
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    return { ok: false, error: err instanceof Error ? err.message : "Not allowed." };
  }
}

/**
 * Only our own, merchant-worded errors are ever shown. Anything else
 * (database, network, provider internals) is logged and replaced with the
 * fallback — raw internal error text must never reach the dashboard.
 */
function friendlyMessage(e: unknown, fallback: string): string {
  if (e instanceof ZodError) return e.issues[0]?.message ?? fallback;
  if (
    e instanceof DomainUnavailableError ||
    e instanceof DomainNotFoundError ||
    e instanceof RegistrationError ||
    e instanceof AuthError // includes EntitlementError ("not in your plan")
  ) {
    return e.message;
  }
  console.error("[domains]", e);
  return fallback;
}

export async function connectDomainAction(formData: FormData): Promise<void> {
  const { tenantId } = await permittedRedirect();
  try {
    assertFeature(await getBusinessEntitlements(tenantId), "custom_domain");
    await addDomain(tenantId, {
      hostname: String(formData.get("hostname") ?? "").trim(),
      includePartner: formData.get("includePartner") === "on",
    });
  } catch (e) {
    redirect(`${PAGE}?err=${encodeURIComponent(friendlyMessage(e, "Could not connect that domain."))}`);
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}?connected=1`);
}

export async function checkDomainAction(domainId: string): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    const domain = await checkDomain(session.tenantId, domainId);
    revalidatePath(PAGE);
    if (domain.status !== "ACTIVE") return { ok: false, error: domain.lastError ?? "Not live yet — check again in a few minutes." };
  } catch (e) {
    return { ok: false, error: friendlyMessage(e, "Could not check that domain.") };
  }
  return { ok: true };
}

export async function makePrimaryAction(domainId: string): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    await setPrimaryDomain(session.tenantId, domainId);
  } catch (e) {
    return { ok: false, error: friendlyMessage(e, "Could not make that your main address.") };
  }
  revalidatePath(PAGE);
  return { ok: true };
}

export async function removeDomainAction(domainId: string): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    await removeDomain(session.tenantId, domainId);
  } catch (e) {
    return { ok: false, error: friendlyMessage(e, "Could not remove that domain.") };
  }
  revalidatePath(PAGE);
  return { ok: true };
}

export async function startPurchaseAction(formData: FormData): Promise<void> {
  const { tenantId } = await permittedRedirect();
  try {
    assertFeature(await getBusinessEntitlements(tenantId), "custom_domain");
    await startPurchase(tenantId, {
      domain: String(formData.get("domain") ?? ""),
      years: Number(formData.get("years") ?? 1),
      registrant: { name: String(formData.get("registrantName") ?? ""), email: String(formData.get("registrantEmail") ?? "") },
    });
  } catch (e) {
    redirect(`${PAGE}?err=${encodeURIComponent(friendlyMessage(e, "Could not start that purchase."))}`);
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}?quoted=1`);
}

export async function cancelPurchaseAction(registrationId: string): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    await cancelPurchase(session.tenantId, registrationId);
  } catch (e) {
    return { ok: false, error: friendlyMessage(e, "Could not cancel that purchase.") };
  }
  revalidatePath(PAGE);
  return { ok: true };
}

/**
 * Sandbox only (never production): stands in for platform billing confirming
 * payment, so the full buy → register → connect flow can be exercised on
 * staging with the sandbox registrar. Real purchases complete only when
 * platform billing calls completePurchase.
 */
export async function simulatePaymentAction(registrationId: string): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  if (process.env.NODE_ENV === "production" || getRegistrar().key !== "sandbox") {
    return { ok: false, error: "Payments can't be simulated here." };
  }
  const own = await prisma.domainRegistration.findFirst({ where: { id: registrationId, businessId: session.tenantId }, select: { id: true } });
  if (!own) return { ok: false, error: "That purchase could not be found." };
  await completePurchase(registrationId, `sandbox_${randomBytes(6).toString("hex")}`);
  revalidatePath(PAGE);
  return { ok: true };
}

export async function setAutoRenewAction(registrationId: string, autoRenew: boolean): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    await setAutoRenew(session.tenantId, registrationId, autoRenew);
  } catch (e) {
    return { ok: false, error: friendlyMessage(e, "Could not change auto-renew.") };
  }
  revalidatePath(PAGE);
  return { ok: true };
}

/**
 * The domain's transfer code — the key to moving it to another registrar.
 * The business OWNER only (the registrant), returned once, never stored or
 * put in a URL.
 */
export async function getTransferCodeAction(registrationId: string): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const session = await permittedSession();
  if (!session.ok) return session;
  if (!session.isOwner) return { ok: false, error: "Only the business owner can get the transfer code." };
  try {
    return { ok: true, code: await getTransferCode(session.tenantId, registrationId) };
  } catch (e) {
    return { ok: false, error: friendlyMessage(e, "Could not get the transfer code.") };
  }
}
