import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { requireStaffActorWithFeature } from "@/lib/auth/entitlement-guards";
import { ok, fail, handleApiError } from "@/lib/utils";
import { BuddyActionError, applyBuddyAction } from "@/modules/assistant/buddy-actions";

export const runtime = "nodejs";

/**
 * EXECUTE, after the person confirmed the preview. The body must say so
 * explicitly; permission and target are checked again inside applyBuddyAction.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const { actor } = await requireStaffActorWithFeature("ai_business_buddy");
    const body = await req.json().catch(() => null);
    if (body?.confirm !== true) return fail("Confirm the change first.", 400);
    const { actionId } = await params;
    const result = await applyBuddyAction(actor, actionId);
    revalidatePath("/dashboard", "layout");
    return ok({ result });
  } catch (error) {
    if (error instanceof BuddyActionError) return fail(error.message, 422);
    return handleApiError(error);
  }
}
