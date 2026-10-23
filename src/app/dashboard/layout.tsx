import type { ReactNode } from "react";
import AssistantDock from "@/components/assistant/AssistantDock";
import { requireStaff } from "@/lib/auth/guards";
import { getBusinessEntitlements } from "@/modules/billing/subscription.service";
import { hasFeature } from "@/modules/billing/entitlements";
import LiveOrdersPulse from "@/components/dashboard/LiveOrdersPulse";
import { getStaffWorkspaceContext } from "./session";

/**
 * Every owner and staff screen gets the buddy — when the business's plan
 * includes it. Pages keep their own shells, so this only adds the floating
 * dock alongside them.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <OrdersPulse />
      {children}
      <BuddyDock />
    </>
  );
}

/**
 * Presentation only: /api/dashboard/pulse enforces the permission itself.
 * Shown to anyone who runs the order queue or the kitchen; the link goes to
 * the screen that person actually works from.
 */
async function OrdersPulse() {
  try {
    const session = await requireStaff();
    const ctx = await getStaffWorkspaceContext(session);
    if (!ctx.capabilities.has("ORDERS")) return null;
    const canManage = ctx.isOwner || ctx.permissions.canManageOrders;
    const canPrepare = ctx.permissions.canPrepareOrders;
    if (!canManage && !canPrepare) return null;
    return <LiveOrdersPulse ordersHref={canManage ? "/dashboard/orders?status=PENDING" : "/dashboard/kitchen"} />;
  } catch {
    return null;
  }
}

/**
 * Presentation only: the /api/dashboard/assistant|buddy routes enforce the
 * ai_business_buddy entitlement themselves. Signed-out screens (and any
 * lookup failure) simply render no dock.
 */
async function BuddyDock() {
  try {
    const session = await requireStaff();
    const entitlements = await getBusinessEntitlements(session.tenantId);
    return hasFeature(entitlements, "ai_business_buddy") ? <AssistantDock /> : null;
  } catch {
    return null;
  }
}
