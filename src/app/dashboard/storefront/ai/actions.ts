"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import {
  generateDraft,
  editDraft,
  publishRevision,
  discardDraft,
  GenerationLimitError,
  InvalidEditError,
  RevisionNotFoundError,
} from "@/modules/storefront-spec/revision.service";
import { SpecNotPublishableError } from "@/modules/storefront-spec/validate";
import { HOME_SECTIONS, type HomeSectionId } from "@/modules/storefront-spec/spec";

/**
 * Every action: the person needs canManageSettings (the same gate as the
 * design wizard), and the business is ALWAYS the one in their signed
 * session — no businessId is ever read from the form.
 */
async function permitted(back: string) {
  try {
    const { payload } = await requireStaffPermission("canManageSettings");
    return payload;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    redirect(`${back}?err=${encodeURIComponent(err instanceof Error ? err.message : "Not allowed.")}`);
  }
}

function friendly(e: unknown, fallback: string): string {
  if (e instanceof GenerationLimitError || e instanceof InvalidEditError || e instanceof RevisionNotFoundError || e instanceof SpecNotPublishableError) {
    return e.message;
  }
  console.error("[storefront-ai]", e);
  return fallback;
}

const LIST = "/dashboard/storefront/ai";

export async function generateDraftAction(formData: FormData): Promise<void> {
  const payload = await permitted(LIST);
  const mode = formData.get("mode") === "ASSIST" ? "ASSIST" : "GENERATE";
  let id: string;
  try {
    id = (await generateDraft(payload.tenantId, payload.staffId, mode)).id;
  } catch (e) {
    redirect(`${LIST}?err=${encodeURIComponent(friendly(e, "We couldn't create a storefront draft. Please try again."))}`);
  }
  revalidatePath(LIST);
  redirect(`${LIST}/${id}`);
}

function text(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : undefined;
}

/** Empty optional fields mean "remove this", which the spec stores as null. */
function optionalText(formData: FormData, key: string): string | null | undefined {
  const value = text(formData, key);
  return value === undefined ? undefined : value === "" ? null : value;
}

export async function saveDraftAction(revisionId: string, formData: FormData): Promise<void> {
  const back = `${LIST}/${revisionId}`;
  const payload = await permitted(back);

  // Section order comes from per-section position numbers; visibility from
  // checkboxes; layout from a per-section select ("" = the template's default).
  const sections = [...HOME_SECTIONS]
    .map((id) => ({
      id,
      position: Number(formData.get(`order_${id}`) ?? 0),
      visible: formData.get(`visible_${id}`) === "on",
      layout: text(formData, `layout_${id}`) || undefined,
    }))
    .sort((a, b) => a.position - b.position)
    .map(({ id, visible, layout }) => ({ id: id as HomeSectionId, visible, ...(layout ? { layout } : {}) }));

  const highlights = (text(formData, "highlights") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // "How it works" steps: one per line as "Title: what happens".
  const process = (text(formData, "process") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title, ...rest] = line.split(":");
      return { title: title.trim(), body: rest.join(":").trim() || title.trim() };
    });

  try {
    await editDraft(payload.tenantId, revisionId, {
      heroHeadline: text(formData, "heroHeadline"),
      heroSubline: optionalText(formData, "heroSubline"),
      aboutBody: optionalText(formData, "aboutBody"),
      highlights,
      process,
      ctaAction: text(formData, "ctaAction"),
      ctaLabel: text(formData, "ctaLabel"),
      presetId: text(formData, "presetId"),
      primaryColor: text(formData, "primaryColor"),
      accentColor: text(formData, "accentColor"),
      sections,
      seoTitle: text(formData, "seoTitle"),
      seoDescription: text(formData, "seoDescription"),
      templateId: text(formData, "templateId"),
    });
  } catch (e) {
    redirect(`${back}?err=${encodeURIComponent(friendly(e, "We couldn't save those changes."))}`);
  }
  revalidatePath(back);
  redirect(`${back}?saved=1`);
}

export async function publishDraftAction(revisionId: string): Promise<void> {
  const back = `${LIST}/${revisionId}`;
  const payload = await permitted(back);
  try {
    await publishRevision(payload.tenantId, revisionId, payload.staffId);
  } catch (e) {
    redirect(`${back}?err=${encodeURIComponent(friendly(e, "We couldn't publish this storefront."))}`);
  }
  revalidatePath(LIST);
  revalidatePath(back);
  revalidatePath("/dashboard/storefront");
  redirect(`${back}?published=1`);
}

export async function discardDraftAction(revisionId: string): Promise<void> {
  const payload = await permitted(LIST);
  try {
    await discardDraft(payload.tenantId, revisionId);
  } catch (e) {
    redirect(`${LIST}?err=${encodeURIComponent(friendly(e, "We couldn't discard that draft."))}`);
  }
  revalidatePath(LIST);
  redirect(LIST);
}
