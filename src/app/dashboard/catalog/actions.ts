"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import {
  createProduct,
  createService,
  updateProduct,
  updateService,
  deleteProduct,
  deleteService,
  setProductActive,
  setServiceActive,
  setProductFeatured,
  setServiceFeatured,
  setProductSoldOutToday,
  moveProduct,
} from "@/modules/catalog/catalog.service";
import { syncProductOptionGroups } from "@/modules/catalog/menu-options.service";
import { uploadCatalogImage } from "@/lib/blob";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** For form-POST actions (add/edit) that already redirect to ?err= on any failure. */
async function permittedRedirect() {
  try {
    const { payload } = await requireStaffPermission("canManageServices");
    return payload;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    const message = err instanceof Error ? err.message : "Not allowed.";
    redirect(`/dashboard/catalog?err=${encodeURIComponent(message)}`);
  }
}

/**
 * For ActionButton-driven actions that return ActionResult instead of
 * redirecting. Returns a discriminated result rather than throwing on a
 * permission failure (403) — a thrown AuthError would have to be caught by
 * the caller to build an ActionResult, but that same try/catch would also
 * swallow the `redirect("/login")` call below on a 401, since Next's
 * redirect works by throwing. Only 401 calls redirect() here (from inside
 * this function's own catch, so it's never inside a caller's try/catch);
 * every other outcome is a plain return the caller checks with `.ok`.
 */
async function permittedSession(): Promise<
  { ok: true; tenantId: string; staffId: string; isOwner: boolean } | { ok: false; error: string }
> {
  try {
    const { payload } = await requireStaffPermission("canManageServices");
    return { ok: true, tenantId: payload.tenantId, staffId: payload.staffId, isOwner: payload.isOwner };
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    return { ok: false, error: err instanceof Error ? err.message : "Not allowed." };
  }
}

/**
 * Reads the optional `image` file field and uploads it, if present. Never
 * throws — a failed image upload surfaces as a `warning` alongside the
 * rest of the form's normal save, rather than blocking a name/price edit
 * just because a photo didn't take.
 */
async function resolveImageUrl(
  formData: FormData,
  businessId: string,
): Promise<{ url?: string; warning?: string }> {
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0) return {};
  try {
    return { url: await uploadCatalogImage(file, businessId) };
  } catch (e) {
    return { warning: e instanceof Error ? e.message : "Could not upload that image." };
  }
}

function withWarning(url: string, warning: string | undefined): string {
  return warning ? `${url}&err=${encodeURIComponent(warning)}` : url;
}

/** Empty string ("Uncategorised" option) resolves to `undefined` (omit — createProduct leaves it uncategorised); a real id is passed through for createProduct's own tenant check. */
function categoryIdField(formData: FormData): string | undefined {
  const raw = formData.get("categoryId");
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export async function addProduct(formData: FormData): Promise<void> {
  const { tenantId } = await permittedRedirect();
  const name = String(formData.get("name") ?? "").trim();
  const price = Number(formData.get("price"));
  const description = String(formData.get("description") ?? "").trim() || undefined;
  const categoryId = categoryIdField(formData);
  const { url: imageUrl, warning } = await resolveImageUrl(formData, tenantId);

  try {
    await createProduct(tenantId, { name, price, description, imageUrl, categoryId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not add that product.";
    redirect(`/dashboard/catalog?err=${encodeURIComponent(message)}`);
  }

  revalidatePath("/dashboard/catalog");
  redirect(withWarning("/dashboard/catalog?added=product", warning));
}

export async function addService(formData: FormData): Promise<void> {
  const { tenantId } = await permittedRedirect();
  const name = String(formData.get("name") ?? "").trim();
  const price = Number(formData.get("price"));
  const durationRaw = formData.get("duration");
  const duration = durationRaw ? Number(durationRaw) : undefined;
  const maxBookingsRaw = formData.get("maxBookings");
  const maxBookings = maxBookingsRaw ? Number(maxBookingsRaw) : undefined;
  const description = String(formData.get("description") ?? "").trim() || undefined;
  const { url: imageUrl, warning } = await resolveImageUrl(formData, tenantId);

  try {
    await createService(tenantId, { name, price, duration, description, imageUrl, maxBookings });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not add that service.";
    redirect(`/dashboard/catalog?err=${encodeURIComponent(message)}`);
  }

  revalidatePath("/dashboard/catalog");
  redirect(withWarning("/dashboard/catalog?added=service", warning));
}

export async function editProduct(productId: string, formData: FormData): Promise<void> {
  const { tenantId } = await permittedRedirect();
  const name = String(formData.get("name") ?? "").trim();
  const price = Number(formData.get("price"));
  const description = String(formData.get("description") ?? "").trim() || undefined;
  const categoryId = formData.has("categoryId") ? (categoryIdField(formData) ?? null) : undefined;
  const { url: imageUrl, warning } = await resolveImageUrl(formData, tenantId);

  try {
    await updateProduct(tenantId, productId, { name, price, description, categoryId, ...(imageUrl && { imageUrl }) });
    // Only present (even as an empty selection) for a Food-experience
    // business — see ProductFields' "menuOptionsEnabled" hidden marker.
    // Retail/Salon submissions never carry this field, so their products'
    // assignments (always empty anyway) are never touched (§20).
    if (formData.get("menuOptionsEnabled") === "1") {
      const optionGroupIds = formData.getAll("optionGroupIds").filter((v): v is string => typeof v === "string");
      await syncProductOptionGroups(tenantId, productId, optionGroupIds);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not update that product.";
    redirect(`/dashboard/catalog?err=${encodeURIComponent(message)}`);
  }

  revalidatePath("/dashboard/catalog");
  redirect(withWarning("/dashboard/catalog?updated=product", warning));
}

export async function editService(serviceId: string, formData: FormData): Promise<void> {
  const { tenantId } = await permittedRedirect();
  const name = String(formData.get("name") ?? "").trim();
  const price = Number(formData.get("price"));
  const durationRaw = formData.get("duration");
  const duration = durationRaw ? Number(durationRaw) : undefined;
  const maxBookingsRaw = formData.get("maxBookings");
  const maxBookings = maxBookingsRaw ? Number(maxBookingsRaw) : undefined;
  const description = String(formData.get("description") ?? "").trim() || undefined;
  const { url: imageUrl, warning } = await resolveImageUrl(formData, tenantId);

  try {
    await updateService(tenantId, serviceId, {
      name,
      price,
      duration,
      maxBookings,
      description,
      ...(imageUrl && { imageUrl }),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not update that service.";
    redirect(`/dashboard/catalog?err=${encodeURIComponent(message)}`);
  }

  revalidatePath("/dashboard/catalog");
  redirect(withWarning("/dashboard/catalog?updated=service", warning));
}

export async function toggleProduct(productId: string, isActive: boolean): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    await setProductActive(session.tenantId, productId, isActive);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update that product." };
  }
  revalidatePath("/dashboard/catalog");
  return { ok: true };
}

export async function toggleService(serviceId: string, isActive: boolean): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    await setServiceActive(session.tenantId, serviceId, isActive);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update that service." };
  }
  revalidatePath("/dashboard/catalog");
  return { ok: true };
}

/** Feature (or stop featuring) an item on the storefront — the same call the Business Buddy's "Apply" makes. */
export async function featureItem(kind: "PRODUCT" | "SERVICE", itemId: string, isFeatured: boolean): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    if (kind === "PRODUCT") await setProductFeatured(session.tenantId, itemId, isFeatured);
    else await setServiceFeatured(session.tenantId, itemId, isFeatured);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update that item." };
  }
  revalidatePath("/dashboard/catalog");
  return { ok: true };
}

export async function removeProduct(productId: string): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    await deleteProduct(session.tenantId, productId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not delete that product." };
  }
  revalidatePath("/dashboard/catalog");
  return { ok: true };
}

export async function removeService(serviceId: string): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    await deleteService(session.tenantId, serviceId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not delete that service." };
  }
  revalidatePath("/dashboard/catalog");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tab 5 — merchant controls the storefront renders: sold out today (clears
// itself overnight; distinct from Hide) and the owner's own sort order.
// ---------------------------------------------------------------------------

export async function setSoldOutToday(productId: string, soldOut: boolean): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    await setProductSoldOutToday(session.tenantId, productId, soldOut);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update that item." };
  }
  revalidatePath("/dashboard/catalog");
  return { ok: true };
}

export async function moveProductAction(productId: string, direction: "up" | "down"): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    await moveProduct(session.tenantId, productId, direction === "up" ? "up" : "down");
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not move that item." };
  }
  revalidatePath("/dashboard/catalog");
  return { ok: true };
}
