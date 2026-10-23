import { requireOwnerSession, getStaffWorkspaceContext, type StaffWorkspaceContext } from "../session";
import { requireStaffPermission, resolveStaffActor, type StaffActor } from "@/lib/auth/guards";
import { getBusinessEntitlements, listPublicPlans } from "@/modules/billing/subscription.service";
import { hasFeature, type Entitlements } from "@/modules/billing/entitlements";

export interface ContentGate {
  workspaceContext: StaffWorkspaceContext;
  actor: StaffActor;
  entitlements: Entitlements;
  /** The PERSON may use the studio (canManageContent, owners always). */
  permitted: boolean;
  /** The BUSINESS's plan includes the studio. */
  entitled: boolean;
  canGenerate: boolean;
  canCampaign: boolean;
  canCalendar: boolean;
  /** The lowest public plan that includes the studio — for the upgrade panel. Never a price unless one is set. */
  upgrade: { planName: string; priceLabel: string | null } | null;
}

/**
 * Presentation gate for every Content & Marketing page: who may see what.
 * Nothing here authorizes a write — every server action re-checks the
 * person's permission and the plan through the content services.
 */
export async function contentGate(): Promise<ContentGate> {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const actor = await resolveStaffActor(session);
  let permitted = true;
  try {
    await requireStaffPermission("canManageContent");
  } catch {
    permitted = false;
  }
  const entitlements = await getBusinessEntitlements(session.tenantId);
  const entitled = hasFeature(entitlements, "content_studio");
  let upgrade: ContentGate["upgrade"] = null;
  if (!entitled) {
    const plans = await listPublicPlans();
    const plan = plans.find((p) => p.entitlements.some((e) => e.featureKey === "content_studio" && e.enabled));
    if (plan) upgrade = { planName: plan.name, priceLabel: plan.priceCents !== null ? `R ${(plan.priceCents / 100).toFixed(2)} / ${plan.interval === "YEARLY" ? "year" : "month"}` : null };
  }
  return {
    workspaceContext,
    actor,
    entitlements,
    permitted,
    entitled,
    canGenerate: hasFeature(entitlements, "content_generation"),
    canCampaign: hasFeature(entitlements, "content_campaigns"),
    canCalendar: hasFeature(entitlements, "content_calendar"),
    upgrade,
  };
}
