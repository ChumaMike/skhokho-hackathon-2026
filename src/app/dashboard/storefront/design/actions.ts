"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma/client";
import { setStorefrontConfig, getStorefrontConfig, type StorefrontProfile, type StorefrontThemeConfig } from "@/modules/tenant/storefront-theme";
import { setStorefrontContent, type StorefrontHeroContent, type StorefrontAboutContent, type StorefrontContent } from "@/modules/tenant/storefront-content";
import { updateBusiness, setActiveTemplateId, acceptGeneratedTemplate } from "@/modules/tenant/tenant.service";
import { isValidTemplateId, validateGeneratedPages, type StorefrontPageId } from "@/modules/tenant/storefront-templates";
import { generatePagesWithFallback } from "@/modules/onboarding/template-generation-provider";
import { generateContentWithFallback } from "@/modules/onboarding/storefront-content-provider";
import { uploadCatalogImage } from "@/lib/blob";

/**
 * Small, bounded catalogue snapshot (count + a few names) shared by both
 * generateStorefrontTemplate and generateStorefrontContent below — not the
 * full rows listProductsForOwner/listServicesForOwner return, since this
 * only needs to steer a prompt, not render anything. Returns undefined for
 * a business with no catalogue yet; both *WithFallback providers already
 * degrade cleanly when catalogueSummary is absent.
 */
async function buildCatalogueSummary(
  tenantId: string,
): Promise<{ productCount: number; serviceCount: number; sampleNames: string[] } | undefined> {
  const SAMPLE_SIZE = 5;
  const [productCount, serviceCount, sampleProducts, sampleServices] = await Promise.all([
    prisma.product.count({ where: { businessId: tenantId } }),
    prisma.service.count({ where: { businessId: tenantId } }),
    prisma.product.findMany({ where: { businessId: tenantId }, select: { name: true }, take: SAMPLE_SIZE, orderBy: { createdAt: "desc" } }),
    prisma.service.findMany({ where: { businessId: tenantId }, select: { name: true }, take: SAMPLE_SIZE, orderBy: { createdAt: "desc" } }),
  ]);
  const sampleNames = [...sampleProducts, ...sampleServices].slice(0, SAMPLE_SIZE).map((row) => row.name);
  return productCount > 0 || serviceCount > 0 ? { productCount, serviceCount, sampleNames } : undefined;
}

/** Same pattern every dashboard actions.ts file already inlines locally — no shared cross-route auth helper exists in this codebase, and inventing one is out of scope here. */
async function permittedRedirect() {
  try {
    const { payload } = await requireStaffPermission("canManageSettings");
    return payload;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    const message = err instanceof Error ? err.message : "Not allowed.";
    redirect(`/dashboard/storefront/design?err=${encodeURIComponent(message)}`);
  }
}

export async function saveStorefrontDraft(input: {
  profile?: Partial<StorefrontProfile>;
  theme?: Partial<StorefrontThemeConfig>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let tenantId: string;
  try {
    const payload = await permittedRedirect();
    tenantId = payload.tenantId;
  } catch {
    return { ok: false, error: "You don't have permission to save this." };
  }

  try {
    await setStorefrontConfig(tenantId, input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save your storefront design." };
  }

  revalidatePath("/dashboard/storefront");
  revalidatePath("/dashboard/storefront/design");
  revalidatePath("/dashboard/storefront/preview");
  return { ok: true };
}

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/**
 * The Brand step lets an owner tweak their existing primary/accent colours
 * while previewing the result — but colours are real Business columns
 * (updateBusiness/UpdateBusinessSchema), not storefront settings, so this
 * writes through the same path Settings' Branding section already uses,
 * not a second colour-storage mechanism.
 */
export async function saveStorefrontColors(input: {
  primaryColor: string;
  accentColor: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let tenantId: string;
  try {
    const payload = await permittedRedirect();
    tenantId = payload.tenantId;
  } catch {
    return { ok: false, error: "You don't have permission to save this." };
  }

  if (!HEX_COLOR.test(input.primaryColor) || !HEX_COLOR.test(input.accentColor)) {
    return { ok: false, error: "Colours must be a valid hex value." };
  }

  try {
    await updateBusiness(tenantId, { primaryColor: input.primaryColor, accentColor: input.accentColor });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save your colours." };
  }

  revalidatePath("/dashboard/storefront");
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

/**
 * The template-picker step's save — separate from saveStorefrontDraft
 * because activeTemplateId lives on BusinessProfile (setActiveTemplateId),
 * not in Business.settings.storefront like profile/theme.
 */
export async function saveStorefrontTemplate(templateId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let tenantId: string;
  try {
    const payload = await permittedRedirect();
    tenantId = payload.tenantId;
  } catch {
    return { ok: false, error: "You don't have permission to save this." };
  }

  if (!isValidTemplateId(templateId)) {
    return { ok: false, error: "That's not a valid template." };
  }

  try {
    await setActiveTemplateId(tenantId, templateId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save your storefront template." };
  }

  revalidatePath("/dashboard/storefront");
  revalidatePath("/dashboard/storefront/design");
  revalidatePath("/dashboard/storefront/preview");
  return { ok: true };
}

/**
 * "None of these fit me" (A4) — generates a page set without saving it, so
 * the owner reviews before committing. Reads category/brief server-side
 * rather than trusting anything the client could pass, same reasoning as
 * every other tenantId-scoped write in this file.
 */
export async function generateStorefrontTemplate(): Promise<
  { ok: true; pages: StorefrontPageId[]; source: "rules" | "model" } | { ok: false; error: string }
> {
  let tenantId: string;
  let staffId: string | null = null;
  try {
    const payload = await permittedRedirect();
    tenantId = payload.tenantId;
    staffId = payload.staffId;
  } catch {
    return { ok: false, error: "You don't have permission to do this." };
  }

  const business = await prisma.business.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, category: true } });
  const profile = await prisma.businessProfile.findUnique({ where: { businessId: tenantId }, select: { brief: true } });
  const catalogueSummary = await buildCatalogueSummary(tenantId);

  const result = await generatePagesWithFallback({
    businessName: business.name,
    category: business.category,
    brief: profile?.brief,
    catalogueSummary,
  });
  return { ok: true, pages: result.pages, source: result.source };
}

/**
 * The content-step's "write this for me" — generates StorefrontContent
 * without saving it, same generate-then-review-then-accept shape as
 * generateStorefrontTemplate above, reusing the same catalogue snapshot so
 * a generated page set and generated content are always grounded in the
 * same real data.
 */
export async function generateStorefrontContentDraft(): Promise<
  { ok: true; content: StorefrontContent; source: "rules" | "model" } | { ok: false; error: string }
> {
  let tenantId: string;
  let staffId: string | null = null;
  try {
    const payload = await permittedRedirect();
    tenantId = payload.tenantId;
    staffId = payload.staffId;
  } catch {
    return { ok: false, error: "You don't have permission to do this." };
  }

  const business = await prisma.business.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true, category: true, settings: true } });
  const profile = await prisma.businessProfile.findUnique({ where: { businessId: tenantId }, select: { brief: true } });
  const catalogueSummary = await buildCatalogueSummary(tenantId);
  // voiceTone/differentiator — captured by the wizard, previously never read
  // anywhere (confirmed dead since before this session). Real owner-given
  // context now grounds the model's writing instead of sitting unused.
  const { voiceTone, differentiator } = getStorefrontConfig(business).profile;

  const result = await generateContentWithFallback({
    businessName: business.name,
    category: business.category,
    brief: profile?.brief,
    catalogueSummary,
    voiceTone,
    differentiator,
  });
  return { ok: true, content: result.content, source: result.source };
}

/**
 * Accepts a generated page set — separate from generateStorefrontTemplate
 * so the model/rules call and the actual save are two steps the owner can
 * see between (generate, review, accept), never one opaque action. Re-
 * validates the pages server-side rather than trusting whatever the client
 * echoes back from the generate step.
 */
export async function acceptGeneratedStorefrontTemplate(
  pages: unknown,
  source: "rules" | "model",
): Promise<{ ok: true } | { ok: false; error: string }> {
  let tenantId: string;
  try {
    const payload = await permittedRedirect();
    tenantId = payload.tenantId;
  } catch {
    return { ok: false, error: "You don't have permission to save this." };
  }

  const validated = validateGeneratedPages({ pages });
  if (!validated) {
    return { ok: false, error: "That generated page set isn't valid anymore — try generating again." };
  }

  try {
    await acceptGeneratedTemplate(tenantId, validated, source.toUpperCase() as "RULES" | "MODEL");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save your generated template." };
  }

  revalidatePath("/dashboard/storefront");
  revalidatePath("/dashboard/storefront/design");
  revalidatePath("/dashboard/storefront/preview");
  return { ok: true };
}

/**
 * The content step's save — separate from saveStorefrontDraft because
 * StorefrontContent lives in its own `settings.storefrontContent` key
 * (storefront-content.ts), not `settings.storefront`. setStorefrontContent
 * itself re-sanitizes/length-caps on write, so this is the last line of
 * defence against garbage reaching storage, same discipline every other
 * action in this file already follows.
 */
export async function saveStorefrontContent(input: {
  hero?: Partial<StorefrontHeroContent>;
  about?: Partial<StorefrontAboutContent>;
  highlights?: { items?: string[] };
}): Promise<{ ok: true } | { ok: false; error: string }> {
  let tenantId: string;
  try {
    const payload = await permittedRedirect();
    tenantId = payload.tenantId;
  } catch {
    return { ok: false, error: "You don't have permission to save this." };
  }

  try {
    await setStorefrontContent(tenantId, input);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save your storefront content." };
  }

  revalidatePath("/dashboard/storefront");
  revalidatePath("/dashboard/storefront/design");
  revalidatePath("/dashboard/storefront/preview");
  return { ok: true };
}

export async function skipStorefrontInterview(): Promise<void> {
  const { tenantId } = await permittedRedirect();
  await setStorefrontConfig(tenantId, { profile: { interviewSkipped: true } });
  revalidatePath("/dashboard/storefront");
  redirect("/dashboard/storefront");
}

export async function uploadStorefrontCover(formData: FormData): Promise<{ url?: string; error?: string }> {
  let tenantId: string;
  try {
    const payload = await permittedRedirect();
    tenantId = payload.tenantId;
  } catch {
    return { error: "You don't have permission to upload a cover photo." };
  }

  const file = formData.get("cover");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image to upload." };
  }

  try {
    const url = await uploadCatalogImage(file, tenantId, "business");
    // Not passed through settings — bannerUrl is its own validated Business
    // column, same trust boundary as logoUrl. updateBusiness only touches
    // fields actually present in this call, so settings.storefront/
    // capabilities/delivery are untouched.
    await updateBusiness(tenantId, { bannerUrl: url });
    revalidatePath("/dashboard/storefront/design");
    return { url };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not upload that photo.";
    return { error: message };
  }
}
