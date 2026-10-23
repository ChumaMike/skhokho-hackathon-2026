import { requireStaffActorWithFeature } from "@/lib/auth/entitlement-guards";
import { ok, handleApiError } from "@/lib/utils";
import { gatherBuddySnapshot } from "@/modules/assistant/buddy-snapshot";
import { buildBriefing } from "@/modules/assistant/briefing";
import { notifyReadinessWarnings } from "@/modules/assistant/readiness.service";

export const runtime = "nodejs";

/** Today's briefing for the signed-in person — only what their role may see. */
export async function GET() {
  try {
    const { actor } = await requireStaffActorWithFeature("ai_business_buddy");
    const snapshot = await gatherBuddySnapshot(actor);
    // Setup gaps also go to the notifications list (at most weekly) — only
    // when this person can fix them, i.e. readiness was in their snapshot.
    if (snapshot.readiness) await notifyReadinessWarnings(actor.tenantId, snapshot.readiness);
    const briefing = buildBriefing(snapshot, actor);
    return ok({ briefing });
  } catch (error) {
    return handleApiError(error);
  }
}
