"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import { setStorefrontConfig, getAvailablePrimaryActions, type PrimaryCustomerAction } from "@/modules/tenant/storefront-theme";
import { getBusinessCapabilities, setBusinessCapabilities, type BusinessCapability } from "@/modules/tenant/capabilities";
import { activeWorkflowsFor } from "@/modules/storefront-workflows/access";
import { WORKFLOW_CAPABILITIES, type WorkflowCapability } from "@/modules/storefront-workflows/workflows";
import { prisma } from "@/lib/prisma/client";

const PAGE = "/dashboard/storefront/actions";

async function permittedRedirect() {
  try {
    const { payload } = await requireStaffPermission("canManageSettings");
    return payload;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    const message = err instanceof Error ? err.message : "Not allowed.";
    redirect(`${PAGE}?err=${encodeURIComponent(message)}`);
  }
}

/**
 * Never itself an authorization check — this only sets which action is
 * emphasised on the storefront, never gates any server-side capability.
 * Re-validates against getAvailablePrimaryActions server-side (never
 * trusts that the disabled state on the button was actually respected by
 * the client), the same capability-aware allow-list the storefront and
 * the recommendation engine both already consult.
 */
export async function setPrimaryActionAction(action: PrimaryCustomerAction): Promise<void> {
  const { tenantId } = await permittedRedirect();
  const business = await prisma.business.findUniqueOrThrow({ where: { id: tenantId } });
  const capabilities = getBusinessCapabilities(business);
  const workflows = await activeWorkflowsFor(tenantId, capabilities);
  const available = getAvailablePrimaryActions(capabilities, business, workflows);

  if (!available.includes(action)) {
    redirect(`${PAGE}?err=${encodeURIComponent("That action isn't available for your business yet.")}`);
  }

  await setStorefrontConfig(tenantId, { theme: { primaryAction: action } });
  revalidatePath("/dashboard/storefront");
  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=1`);
}

/**
 * Switches one request workflow (quote, enquiry, pickup, callback) on or
 * off for this business. Writes the business's full capability list, so a
 * business that was still on its category defaults keeps everything it
 * had. The plan check is separate: switching a workflow on does not make
 * it appear until the plan includes it (the page says so).
 */
export async function setWorkflowCapabilityAction(capability: WorkflowCapability, enabled: boolean): Promise<void> {
  const { tenantId } = await permittedRedirect();
  if (!(WORKFLOW_CAPABILITIES as readonly string[]).includes(capability)) redirect(`${PAGE}?err=${encodeURIComponent("Unknown request type.")}`);
  const business = await prisma.business.findUniqueOrThrow({ where: { id: tenantId }, select: { category: true, settings: true } });
  const current = getBusinessCapabilities(business);
  // DELIVERY is derived from delivery settings, never stored in the list (capabilities.ts).
  const next = new Set<BusinessCapability>([...current].filter((c) => c !== "DELIVERY"));
  if (enabled) next.add(capability);
  else next.delete(capability);
  await setBusinessCapabilities(tenantId, [...next]);
  revalidatePath("/dashboard/storefront");
  revalidatePath("/dashboard/storefront/pages");
  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=1`);
}
