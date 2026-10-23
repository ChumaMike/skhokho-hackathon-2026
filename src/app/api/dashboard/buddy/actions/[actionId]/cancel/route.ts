import { requireStaffActorWithFeature } from "@/lib/auth/entitlement-guards";
import { ok, handleApiError } from "@/lib/utils";
import { cancelBuddyAction } from "@/modules/assistant/buddy-actions";

export const runtime = "nodejs";

/** "Not now" — the prepared change is dropped. */
export async function POST(_req: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const { actor } = await requireStaffActorWithFeature("ai_business_buddy");
    const { actionId } = await params;
    await cancelBuddyAction(actor, actionId);
    return ok({});
  } catch (error) {
    return handleApiError(error);
  }
}
