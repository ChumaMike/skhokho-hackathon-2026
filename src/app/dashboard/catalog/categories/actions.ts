"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import { createCategory, deleteCategory, moveCategory, setCategoryActive, updateCategory } from "@/modules/catalog/menu-options.service";

const PAGE = "/dashboard/catalog/categories";

/** Same permission as the rest of the catalogue (canManageServices). */
async function permitted(): Promise<string> {
  try {
    const { payload } = await requireStaffPermission("canManageServices");
    return payload.tenantId;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    redirect(`${PAGE}?err=${encodeURIComponent(err instanceof Error ? err.message : "Not allowed.")}`);
  }
}

function done(): never {
  revalidatePath(PAGE);
  revalidatePath("/dashboard/catalog");
  redirect(`${PAGE}?saved=1`);
}

function failed(e: unknown): never {
  const message = e instanceof ZodError ? e.issues[0]?.message ?? "Check the details." : e instanceof Error ? e.message : "Could not save.";
  redirect(`${PAGE}?err=${encodeURIComponent(message)}`);
}

export async function addCategoryAction(fd: FormData): Promise<void> {
  const tenantId = await permitted();
  try {
    await createCategory(tenantId, { name: String(fd.get("name") ?? "").trim(), description: String(fd.get("description") ?? "").trim() || undefined });
  } catch (e) {
    failed(e);
  }
  done();
}

export async function renameCategoryAction(categoryId: string, fd: FormData): Promise<void> {
  const tenantId = await permitted();
  try {
    await updateCategory(tenantId, categoryId, { name: String(fd.get("name") ?? "").trim(), description: String(fd.get("description") ?? "").trim() || undefined });
  } catch (e) {
    failed(e);
  }
  done();
}

export async function toggleCategoryAction(categoryId: string, active: boolean): Promise<void> {
  const tenantId = await permitted();
  try {
    await setCategoryActive(tenantId, categoryId, active);
  } catch (e) {
    failed(e);
  }
  done();
}

export async function moveCategoryAction(categoryId: string, direction: "UP" | "DOWN"): Promise<void> {
  const tenantId = await permitted();
  try {
    await moveCategory(tenantId, categoryId, direction === "UP" ? "UP" : "DOWN");
  } catch (e) {
    failed(e);
  }
  done();
}

export async function deleteCategoryAction(categoryId: string): Promise<void> {
  const tenantId = await permitted();
  try {
    await deleteCategory(tenantId, categoryId);
  } catch (e) {
    failed(e);
  }
  done();
}
