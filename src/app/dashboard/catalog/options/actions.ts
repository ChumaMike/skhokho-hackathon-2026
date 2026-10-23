"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import {
  createOptionGroup,
  updateOptionGroup,
  setOptionGroupActive,
  deleteOptionGroup,
  createOption,
  updateOption,
  setOptionActive,
  deleteOption,
} from "@/modules/catalog/menu-options.service";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Same permission boundary catalog/actions.ts already uses for Product/Service mutations — Menu options are just another editable part of the same catalogue (§21: presentation gating, not a new capability). */
async function permittedRedirect() {
  try {
    const { payload } = await requireStaffPermission("canManageServices");
    return payload;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    const message = err instanceof Error ? err.message : "Not allowed.";
    redirect(`/dashboard/catalog/options?err=${encodeURIComponent(message)}`);
  }
}

async function permittedSession(): Promise<{ ok: true; tenantId: string } | { ok: false; error: string }> {
  try {
    const { payload } = await requireStaffPermission("canManageServices");
    return { ok: true, tenantId: payload.tenantId };
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    return { ok: false, error: err instanceof Error ? err.message : "Not allowed." };
  }
}

function numberField(formData: FormData, name: string): number | undefined {
  const raw = formData.get(name);
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export async function addOptionGroup(formData: FormData): Promise<void> {
  const { tenantId } = await permittedRedirect();
  const name = String(formData.get("name") ?? "").trim();
  const selectionType = formData.get("selectionType") === "MULTIPLE" ? "MULTIPLE" : "SINGLE";
  const minSelections = numberField(formData, "minSelections") ?? 0;
  const maxSelections = numberField(formData, "maxSelections");

  try {
    await createOptionGroup(tenantId, { name, selectionType, minSelections, maxSelections });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not add that choice group.";
    redirect(`/dashboard/catalog/options?err=${encodeURIComponent(message)}`);
  }
  revalidatePath("/dashboard/catalog/options");
  redirect("/dashboard/catalog/options?added=group");
}

export async function editOptionGroup(groupId: string, formData: FormData): Promise<void> {
  const { tenantId } = await permittedRedirect();
  const name = String(formData.get("name") ?? "").trim();
  const selectionType = formData.get("selectionType") === "MULTIPLE" ? "MULTIPLE" : "SINGLE";
  const minSelections = numberField(formData, "minSelections") ?? 0;
  const maxSelections = numberField(formData, "maxSelections");

  try {
    await updateOptionGroup(tenantId, groupId, { name, selectionType, minSelections, maxSelections });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not update that choice group.";
    redirect(`/dashboard/catalog/options?err=${encodeURIComponent(message)}`);
  }
  revalidatePath("/dashboard/catalog/options");
  redirect("/dashboard/catalog/options?updated=group");
}

export async function toggleOptionGroupActive(groupId: string, isActive: boolean): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    await setOptionGroupActive(session.tenantId, groupId, isActive);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update that choice group." };
  }
  revalidatePath("/dashboard/catalog/options");
  return { ok: true };
}

export async function removeOptionGroup(groupId: string): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    await deleteOptionGroup(session.tenantId, groupId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not delete that choice group." };
  }
  revalidatePath("/dashboard/catalog/options");
  return { ok: true };
}

export async function addOption(groupId: string, formData: FormData): Promise<void> {
  const { tenantId } = await permittedRedirect();
  const name = String(formData.get("name") ?? "").trim();
  const priceDelta = numberField(formData, "priceDelta") ?? 0;
  try {
    await createOption(tenantId, groupId, { name, priceDelta });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not add that option.";
    redirect(`/dashboard/catalog/options?err=${encodeURIComponent(message)}`);
  }
  revalidatePath("/dashboard/catalog/options");
  redirect("/dashboard/catalog/options?added=option");
}

export async function editOption(optionId: string, formData: FormData): Promise<void> {
  const { tenantId } = await permittedRedirect();
  const name = String(formData.get("name") ?? "").trim();
  const priceDelta = numberField(formData, "priceDelta") ?? 0;
  try {
    await updateOption(tenantId, optionId, { name, priceDelta });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not update that option.";
    redirect(`/dashboard/catalog/options?err=${encodeURIComponent(message)}`);
  }
  revalidatePath("/dashboard/catalog/options");
  redirect("/dashboard/catalog/options?updated=option");
}

export async function toggleOptionActive(optionId: string, isActive: boolean): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    await setOptionActive(session.tenantId, optionId, isActive);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not update that option." };
  }
  revalidatePath("/dashboard/catalog/options");
  return { ok: true };
}

export async function removeOption(optionId: string): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;
  try {
    await deleteOption(session.tenantId, optionId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not delete that option." };
  }
  revalidatePath("/dashboard/catalog/options");
  return { ok: true };
}
