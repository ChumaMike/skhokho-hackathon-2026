import { NextRequest } from "next/server";
import { requireStaffActorWithFeature } from "@/lib/auth/entitlement-guards";
import { ok, fail, handleApiError } from "@/lib/utils";
import { validateBuddyQuestion } from "@/modules/assistant/buddy-chat";
import { getBuddyHistory, sendBuddyMessage } from "@/modules/assistant/buddy-chat.service";
import { checkRateLimits, rateLimitedResponse } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** The signed-in person's own running chat with their buddy. */
export async function GET() {
  try {
    const { actor } = await requireStaffActorWithFeature("ai_business_buddy");
    const messages = await getBuddyHistory(actor);
    return ok({ messages });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { actor } = await requireStaffActorWithFeature("ai_business_buddy");
    const body = await req.json().catch(() => null);
    const checked = validateBuddyQuestion(body?.question);
    if (!checked.ok) return fail(checked.error);
    const allowance = await checkRateLimits([["buddyChatStaff", `${actor.tenantId}:${actor.staffId}`]]);
    if (!allowance.allowed) return rateLimitedResponse(allowance, { ok: false, error: "You've asked your buddy a lot today — please try again tomorrow." });

    const message = await sendBuddyMessage(actor, checked.question);
    return ok({ message });
  } catch (error) {
    return handleApiError(error);
  }
}
