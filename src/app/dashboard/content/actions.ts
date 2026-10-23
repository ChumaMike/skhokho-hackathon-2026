"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthError, requireStaffActor } from "@/lib/auth/guards";
import { AiCallError } from "@/lib/ai/anthropic";
import { generateContentDraft, runProductTool, type ProductTool } from "@/modules/content/generation";
import { createManualDraft, setDraftStatus, updateDraft } from "@/modules/content/drafts";
import { createCampaign, generateCampaignSet, setCampaignStatus, updateCampaign } from "@/modules/content/campaigns";
import { brandProfileFromForm, setBrandProfile } from "@/modules/content/brand-profile";
import { ContentError } from "@/modules/content/context";
import { applyBuddyAction, BuddyActionError, cancelBuddyAction, prepareBuddyAction } from "@/modules/assistant/buddy-actions";
import type { ContentCampaignStatus, ContentDraftStatus } from "@prisma/client";

/** Every error a merchant should read verbatim; anything else is "something went wrong". */
function friendly(e: unknown): string {
  if (e instanceof AuthError && e.status === 401) redirect("/login");
  if (e instanceof ContentError || e instanceof AiCallError || e instanceof BuddyActionError || e instanceof AuthError) return e.message;
  if (e instanceof Error && e.name === "ZodError") return "Please check the form — something is missing or too long.";
  console.error("[content] action failed", e instanceof Error ? e.name : e);
  return "Something went wrong — nothing was changed.";
}

async function actor() {
  try {
    return await requireStaffActor();
  } catch (e) {
    if (e instanceof AuthError && e.status === 401) redirect("/login");
    throw e;
  }
}

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
const opt = (fd: FormData, k: string) => str(fd, k) || undefined;
const back = (path: string, q: Record<string, string | undefined>) => {
  const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString();
  redirect(qs ? `${path}?${qs}` : path);
};

export async function generateAction(fd: FormData) {
  const a = await actor();
  const sourceType = str(fd, "sourceType");
  const source =
    sourceType === "PRODUCT"
      ? { type: "PRODUCT", productId: str(fd, "productId") }
      : sourceType === "CATEGORY"
        ? { type: "CATEGORY", categoryId: str(fd, "categoryId") }
        : sourceType === "OFFER"
          ? { type: "OFFER", text: str(fd, "text") }
          : sourceType === "CUSTOM"
            ? { type: "CUSTOM", text: str(fd, "text") }
            : sourceType === "INSIGHT"
              ? { type: "INSIGHT" }
              : { type: "BUSINESS" };
  let draftId: string;
  try {
    const draft = await generateContentDraft(a, {
      type: str(fd, "type"),
      channel: str(fd, "channel") || "GENERAL",
      source,
      goal: opt(fd, "goal"),
      tone: opt(fd, "tone"),
      instructions: opt(fd, "instructions"),
      campaignId: opt(fd, "campaignId"),
      requestKey: opt(fd, "requestKey"),
    });
    draftId = draft.id;
  } catch (e) {
    return back("/dashboard/content/create", { err: friendly(e), sourceType, productId: opt(fd, "productId"), type: opt(fd, "type") });
  }
  revalidatePath("/dashboard/content");
  redirect(`/dashboard/content/drafts/${draftId}?ok=${encodeURIComponent("Draft written — read it, edit it, then mark it ready.")}`);
}

export async function productToolAction(fd: FormData) {
  const a = await actor();
  const tool = str(fd, "tool") as ProductTool;
  const productId = str(fd, "productId");
  let draftId: string;
  try {
    const draft = await runProductTool(a, productId, tool, { requestKey: opt(fd, "requestKey"), instructions: opt(fd, "instructions") });
    draftId = draft.id;
  } catch (e) {
    return back("/dashboard/content/create", { err: friendly(e), sourceType: "PRODUCT", productId });
  }
  revalidatePath("/dashboard/content");
  redirect(`/dashboard/content/drafts/${draftId}`);
}

export async function createManualDraftAction(fd: FormData) {
  const a = await actor();
  let draftId: string;
  try {
    const draft = await createManualDraft(a, {
      type: str(fd, "type"),
      channel: str(fd, "channel") || "GENERAL",
      title: str(fd, "title"),
      content: str(fd, "content"),
      campaignId: opt(fd, "campaignId") ?? null,
      plannedFor: opt(fd, "plannedFor") ?? null,
    });
    draftId = draft.id;
  } catch (e) {
    return back("/dashboard/content/create", { err: friendly(e), manual: "1" });
  }
  revalidatePath("/dashboard/content");
  redirect(`/dashboard/content/drafts/${draftId}`);
}

export async function updateDraftAction(draftId: string, fd: FormData) {
  const a = await actor();
  try {
    await updateDraft(a, draftId, {
      title: str(fd, "title"),
      content: str(fd, "content"),
      channel: str(fd, "channel") || "GENERAL",
      campaignId: opt(fd, "campaignId") ?? null,
      plannedFor: opt(fd, "plannedFor") ?? null,
    });
  } catch (e) {
    return back(`/dashboard/content/drafts/${draftId}`, { err: friendly(e) });
  }
  revalidatePath("/dashboard/content");
  back(`/dashboard/content/drafts/${draftId}`, { ok: "Saved." });
}

export async function setDraftStatusAction(draftId: string, status: ContentDraftStatus) {
  const a = await actor();
  try {
    await setDraftStatus(a, draftId, status);
  } catch (e) {
    return back(`/dashboard/content/drafts/${draftId}`, { err: friendly(e) });
  }
  revalidatePath("/dashboard/content");
  back(`/dashboard/content/drafts/${draftId}`, { ok: status === "PUBLISHED_MANUALLY" ? "Marked as posted." : status === "READY" ? "Marked ready to post." : status === "ARCHIVED" ? "Archived." : "Back to draft." });
}

/** Step 1 of applying a product text: preview only. */
export async function prepareApplyProductTextAction(draftId: string) {
  const a = await actor();
  let actionId: string;
  try {
    actionId = (await prepareBuddyAction(a, { kind: "APPLY_PRODUCT_TEXT", params: { draftId } })).id;
  } catch (e) {
    return back(`/dashboard/content/drafts/${draftId}`, { err: friendly(e) });
  }
  back(`/dashboard/content/drafts/${draftId}`, { apply: actionId });
}

/** Step 3: the person confirmed the preview. */
export async function confirmApplyProductTextAction(draftId: string, actionId: string) {
  const a = await actor();
  try {
    await applyBuddyAction(a, actionId);
  } catch (e) {
    return back(`/dashboard/content/drafts/${draftId}`, { err: friendly(e) });
  }
  revalidatePath("/dashboard/catalog");
  revalidatePath("/dashboard/content");
  back(`/dashboard/content/drafts/${draftId}`, { ok: "Applied to your product." });
}

export async function cancelApplyProductTextAction(draftId: string, actionId: string) {
  const a = await actor();
  await cancelBuddyAction(a, actionId);
  back(`/dashboard/content/drafts/${draftId}`, {});
}

export async function createCampaignAction(fd: FormData) {
  const a = await actor();
  let id: string;
  try {
    const c = await createCampaign(a, {
      name: str(fd, "name"),
      goal: opt(fd, "goal") ?? null,
      productIds: fd.getAll("productIds").filter((v): v is string => typeof v === "string" && v.length > 0),
      categoryIds: fd.getAll("categoryIds").filter((v): v is string => typeof v === "string" && v.length > 0),
      startsAt: opt(fd, "startsAt") ?? null,
      endsAt: opt(fd, "endsAt") ?? null,
      notes: opt(fd, "notes") ?? null,
    });
    id = c.id;
  } catch (e) {
    return back("/dashboard/content/campaigns", { err: friendly(e) });
  }
  revalidatePath("/dashboard/content");
  redirect(`/dashboard/content/campaigns/${id}`);
}

export async function updateCampaignAction(campaignId: string, fd: FormData) {
  const a = await actor();
  try {
    await updateCampaign(a, campaignId, {
      name: str(fd, "name"),
      goal: opt(fd, "goal") ?? null,
      productIds: fd.getAll("productIds").filter((v): v is string => typeof v === "string" && v.length > 0),
      categoryIds: fd.getAll("categoryIds").filter((v): v is string => typeof v === "string" && v.length > 0),
      startsAt: opt(fd, "startsAt") ?? null,
      endsAt: opt(fd, "endsAt") ?? null,
      notes: opt(fd, "notes") ?? null,
    });
  } catch (e) {
    return back(`/dashboard/content/campaigns/${campaignId}`, { err: friendly(e) });
  }
  revalidatePath("/dashboard/content");
  back(`/dashboard/content/campaigns/${campaignId}`, { ok: "Saved." });
}

export async function setCampaignStatusAction(campaignId: string, status: ContentCampaignStatus) {
  const a = await actor();
  try {
    await setCampaignStatus(a, campaignId, status);
  } catch (e) {
    return back(`/dashboard/content/campaigns/${campaignId}`, { err: friendly(e) });
  }
  revalidatePath("/dashboard/content");
  back(`/dashboard/content/campaigns/${campaignId}`, { ok: `Campaign ${status.toLowerCase()}.` });
}

export async function generateCampaignSetAction(campaignId: string, fd: FormData) {
  const a = await actor();
  let msg: string;
  try {
    const r = await generateCampaignSet(a, campaignId, { requestKey: opt(fd, "requestKey") });
    msg = r.created.length ? `Wrote ${r.created.length} version(s).${r.stopped ? ` Stopped early: ${r.stopped}` : ""}` : (r.stopped ?? "Nothing was written.");
  } catch (e) {
    return back(`/dashboard/content/campaigns/${campaignId}`, { err: friendly(e) });
  }
  revalidatePath("/dashboard/content");
  back(`/dashboard/content/campaigns/${campaignId}`, { ok: msg });
}

export async function saveBrandAction(fd: FormData) {
  const a = await actor();
  try {
    // Person + plan: the same gate as every other content write.
    const { requireContentStudio } = await import("@/modules/content/drafts");
    await requireContentStudio(a);
    await setBrandProfile(a.tenantId, brandProfileFromForm(fd));
  } catch (e) {
    return back("/dashboard/content/brand", { err: friendly(e) });
  }
  revalidatePath("/dashboard/content");
  back("/dashboard/content/brand", { ok: "Brand profile saved — every new draft will use it." });
}
