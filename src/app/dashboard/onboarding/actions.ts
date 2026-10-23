"use server";

import { revalidatePath } from "next/cache";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import {
  AnswersSchema,
  saveProgress,
  skipInterview,
  completeInterview,
  regenerateBrief,
  type ProfileView,
} from "@/modules/onboarding/onboarding.service";

type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

/**
 * The interview describes the whole business, so it's gated on
 * canManageSettings — the same permission that governs publishing and every
 * other business-wide decision. A cashier shouldn't be able to rewrite what
 * the company says it is, and this reuses an existing permission rather than
 * adding a key that would need a backfill for one dialog.
 */
async function requireInterviewAccess(): Promise<string> {
  const { payload } = await requireStaffPermission("canManageSettings");
  return payload.tenantId;
}

function failure(err: unknown, fallback: string): { ok: false; error: string } {
  if (err instanceof AuthError) {
    return { ok: false, error: "You don't have permission to change your business profile." };
  }
  console.error("[onboarding] action failed:", err);
  return { ok: false, error: fallback };
}

/** Autosaves answers as the owner moves between steps. */
export async function saveInterviewProgress(
  rawAnswers: unknown,
  currentStep: number,
): Promise<ActionResult> {
  try {
    const tenantId = await requireInterviewAccess();
    const parsed = AnswersSchema.safeParse(rawAnswers);
    if (!parsed.success) return { ok: false, error: "Those answers didn't look right. Try again." };

    await saveProgress(tenantId, parsed.data, currentStep);
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't save just now — your answers are still on screen.");
  }
}

export async function skipInterviewAction(
  rawAnswers: unknown,
  currentStep: number,
): Promise<ActionResult> {
  try {
    const tenantId = await requireInterviewAccess();
    const parsed = AnswersSchema.safeParse(rawAnswers);
    await skipInterview(tenantId, parsed.success ? parsed.data : {}, currentStep);
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (err) {
    return failure(err, "Couldn't do that just now. Try again.");
  }
}

/**
 * Finishes the interview and generates the storefront brief. Returns the
 * brief so the dialog can show the owner what we understood before they close
 * it — the point at which a wrong answer is cheapest to fix.
 */
export async function completeInterviewAction(
  rawAnswers: unknown,
): Promise<ActionResult<ProfileView>> {
  try {
    const tenantId = await requireInterviewAccess();
    const parsed = AnswersSchema.safeParse(rawAnswers);
    if (!parsed.success) return { ok: false, error: "Those answers didn't look right. Try again." };

    const profile = await completeInterview(tenantId, parsed.data);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/storefront");
    return { ok: true, data: profile };
  } catch (err) {
    return failure(err, "Couldn't finish up just now. Your answers are saved — try again.");
  }
}

export async function regenerateBriefAction(): Promise<ActionResult<ProfileView>> {
  try {
    const tenantId = await requireInterviewAccess();
    const profile = await regenerateBrief(tenantId);
    revalidatePath("/dashboard");
    revalidatePath("/dashboard/storefront");
    return { ok: true, data: profile };
  } catch (err) {
    return failure(err, "Couldn't rewrite that just now. Try again.");
  }
}
