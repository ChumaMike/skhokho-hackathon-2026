"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import { gatherStorefrontFacts } from "@/modules/storefront-spec/facts";
import { currentSite } from "@/modules/storefront-spec/planner";
import {
  discardDraft,
  editDraftSite,
  ensureWorkingDraft,
  getOpenDraft,
  publishRevision,
  InvalidEditError,
  RevisionNotFoundError,
} from "@/modules/storefront-spec/revision.service";
import { SpecNotPublishableError } from "@/modules/storefront-spec/validate";
import { PAGE_SECTION_TYPES, type PageSectionType, type SitePage } from "@/modules/storefront-spec/pages";
import {
  PageEditError,
  PageHeaderEditSchema,
  addCustomPage,
  addSection,
  movePage,
  removePage,
  sectionFromInput,
  setPageSections,
  updatePageHeader,
  type SectionInput,
} from "@/modules/storefront-spec/pages-edit";

const LIST = "/dashboard/storefront/pages";

/**
 * Every action: the person needs canManageSettings (the same gate as the
 * design wizard), and the business is ALWAYS the one in their signed
 * session. Page edits go into the working draft (revision.service.ts) and
 * reach customers only when that draft is published.
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
  if (e instanceof PageEditError || e instanceof InvalidEditError || e instanceof RevisionNotFoundError || e instanceof SpecNotPublishableError) return e.message;
  console.error("[storefront-pages]", e);
  return fallback;
}

/** Applies one change to the working draft's page list; redirects back with the outcome. */
async function mutatePages(back: string, mutate: (pages: SitePage[]) => SitePage[], after: string = back): Promise<never> {
  const payload = await permitted(back);
  let error: string | null = null;
  try {
    const draft = await ensureWorkingDraft(payload.tenantId, payload.staffId);
    const pages = draft.spec.site?.pages ?? currentSite(await gatherStorefrontFacts(payload.tenantId)).pages;
    await editDraftSite(payload.tenantId, draft.id, { pages: mutate(pages) });
  } catch (e) {
    error = friendly(e, "That change could not be saved. Please try again.");
  }
  if (error) redirect(`${back}?err=${encodeURIComponent(error)}`);
  revalidatePath(LIST);
  revalidatePath(after);
  redirect(`${after}?saved=1`);
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function movePageAction(pageId: string, direction: "up" | "down"): Promise<void> {
  await mutatePages(LIST, (pages) => movePage(pages, pageId, direction));
}

export async function togglePageAction(pageId: string, field: "visible" | "inNav" | "inFooter"): Promise<void> {
  await mutatePages(LIST, (pages) => {
    const page = pages.find((p) => p.id === pageId);
    if (!page) throw new PageEditError("That page no longer exists.");
    return updatePageHeader(pages, pageId, { title: page.title, slug: page.slug, visible: page.visible, inNav: page.inNav, inFooter: page.inFooter, [field]: !page[field] });
  });
}

export async function addPageAction(formData: FormData): Promise<void> {
  const title = text(formData, "title").trim();
  const slug = text(formData, "slug").trim();
  await mutatePages(LIST, (pages) => addCustomPage(pages, title, slug || undefined));
}

export async function deletePageAction(pageId: string): Promise<void> {
  await mutatePages(`${LIST}/${pageId}`, (pages) => removePage(pages, pageId), LIST);
}

export async function savePageAction(pageId: string, formData: FormData): Promise<void> {
  const back = `${LIST}/${pageId}`;
  const header = PageHeaderEditSchema.safeParse({
    title: text(formData, "title"),
    slug: text(formData, "slug").trim() || undefined,
    visible: formData.get("visible") === "on",
    inNav: formData.get("inNav") === "on",
    inFooter: formData.get("inFooter") === "on",
    seoTitle: text(formData, "seoTitle"),
    seoDescription: text(formData, "seoDescription"),
  });
  if (!header.success) {
    redirect(`${back}?err=${encodeURIComponent(header.error.issues[0]?.message ?? "Check the page name and address.")}`);
  }

  // Sections: each posted with its index, a position for ordering, a remove
  // checkbox and its own text fields; rebuilt from scratch and validated.
  const count = Number(text(formData, "sectionCount")) || 0;
  const posted: { position: number; input: SectionInput }[] = [];
  for (let i = 0; i < count; i++) {
    if (formData.get(`section_${i}_remove`) === "on") continue;
    const type = text(formData, `section_${i}_type`) as PageSectionType;
    if (!(PAGE_SECTION_TYPES as readonly string[]).includes(type)) continue;
    posted.push({
      position: Number(text(formData, `section_${i}_position`)) || i + 1,
      input: {
        type,
        heading: text(formData, `section_${i}_heading`),
        body: text(formData, `section_${i}_body`),
        faq: text(formData, `section_${i}_faq`),
        workflow: text(formData, `section_${i}_workflow`),
        layout: text(formData, `section_${i}_layout`),
      },
    });
  }
  posted.sort((a, b) => a.position - b.position);

  await mutatePages(back, (pages) => {
    let next = updatePageHeader(pages, pageId, header.data);
    const page = next.find((p) => p.id === pageId)!;
    if (page.kind !== "HOME") next = setPageSections(next, pageId, posted.map((p) => sectionFromInput(p.input)));
    return next;
  });
}

export async function addSectionAction(pageId: string, formData: FormData): Promise<void> {
  const back = `${LIST}/${pageId}`;
  const type = text(formData, "type") as PageSectionType;
  await mutatePages(back, (pages) =>
    addSection(pages, pageId, { type, heading: text(formData, "heading"), body: text(formData, "body"), faq: text(formData, "faq"), workflow: text(formData, "workflow") }),
  );
}

/** Throws the working draft away (kept as history); the live storefront is untouched. */
export async function discardPagesDraftAction(): Promise<void> {
  const payload = await permitted(LIST);
  let error: string | null = null;
  try {
    const draft = await getOpenDraft(payload.tenantId);
    if (!draft) throw new RevisionNotFoundError();
    await discardDraft(payload.tenantId, draft.id);
  } catch (e) {
    error = friendly(e, "The draft could not be discarded. Please try again.");
  }
  if (error) redirect(`${LIST}?err=${encodeURIComponent(error)}`);
  revalidatePath(LIST);
  redirect(`${LIST}?discarded=1`);
}

/** Publishes the working draft — pages and everything else in it — after re-validation. */
export async function publishPagesAction(): Promise<void> {
  const payload = await permitted(LIST);
  let error: string | null = null;
  try {
    const draft = await getOpenDraft(payload.tenantId);
    if (!draft) throw new RevisionNotFoundError();
    await publishRevision(payload.tenantId, draft.id, payload.staffId);
  } catch (e) {
    error = friendly(e, "Your pages could not be published. Please try again.");
  }
  if (error) redirect(`${LIST}?err=${encodeURIComponent(error)}`);
  revalidatePath(LIST);
  revalidatePath("/dashboard/storefront");
  redirect(`${LIST}?published=1`);
}
