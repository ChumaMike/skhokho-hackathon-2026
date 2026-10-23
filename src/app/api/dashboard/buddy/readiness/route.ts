import { requireStaffActorWithFeature } from "@/lib/auth/entitlement-guards";
import { actorCan } from "@/lib/auth/guards";
import { ok, handleApiError } from "@/lib/utils";
import { getBusinessReadiness, notifyReadinessWarnings } from "@/modules/assistant/readiness.service";

export const runtime = "nodejs";

/**
 * The setup checklist — for people who can act on it (canManageSettings,
 * the gate on the pages it links to). Others get an empty list.
 */
export async function GET() {
  try {
    const { actor } = await requireStaffActorWithFeature("ai_business_buddy");
    if (!actorCan(actor, "canManageSettings")) return ok({ items: [] });
    const items = await getBusinessReadiness(actor.tenantId);
    await notifyReadinessWarnings(actor.tenantId, items);
    return ok({ items });
  } catch (error) {
    return handleApiError(error);
  }
}
