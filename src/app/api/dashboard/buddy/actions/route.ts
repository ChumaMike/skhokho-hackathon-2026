import { NextRequest } from "next/server";
import { requireStaffActorWithFeature } from "@/lib/auth/entitlement-guards";
import { ok, fail, handleApiError } from "@/lib/utils";
import { BuddyActionError, prepareBuddyAction } from "@/modules/assistant/buddy-actions";

export const runtime = "nodejs";

/** PREPARE: checks permission and target, returns a preview. Changes nothing. */
export async function POST(req: NextRequest) {
  try {
    const { actor } = await requireStaffActorWithFeature("ai_business_buddy");
    const body = await req.json().catch(() => null);
    const prepared = await prepareBuddyAction(actor, body);
    return ok({ action: prepared });
  } catch (error) {
    if (error instanceof BuddyActionError) return fail(error.message, 422);
    return handleApiError(error);
  }
}
