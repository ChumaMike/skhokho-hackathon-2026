"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AuthError } from "@/lib/auth/guards";
import {
  assertCanActOnDelivery,
  markPickedUp,
  markDelivered,
  reportFailure,
} from "@/modules/orders/order-delivery.service";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function withAuth<T>(deliveryId: string, run: (ctx: { tenantId: string; staffId: string }) => Promise<T>) {
  let ctx;
  try {
    ctx = await assertCanActOnDelivery(deliveryId);
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    throw err;
  }
  return run(ctx);
}

export async function markPickedUpAction(deliveryId: string): Promise<ActionResult> {
  try {
    await withAuth(deliveryId, ({ tenantId }) => markPickedUp(tenantId, deliveryId));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not mark that picked up." };
  }
  revalidatePath("/dashboard/driver");
  revalidatePath("/dashboard/deliveries");
  return { ok: true };
}

/**
 * "Delivered" is a form, not a bare button: for a storefront order it carries
 * the customer's 6-digit code (proof of delivery — delivery-code.ts). A
 * wrong, missing or locked code comes back as a banner; the delivery stays
 * out until the right code is entered or a manager completes it with a
 * reason from the Deliveries page.
 */
export async function markDeliveredAction(deliveryId: string, formData: FormData): Promise<void> {
  const code = String(formData.get("code") ?? "");
  try {
    await withAuth(deliveryId, ({ tenantId, staffId }) => markDelivered(tenantId, deliveryId, staffId, { code }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not mark that delivered.";
    redirect(`/dashboard/driver?err=${encodeURIComponent(message)}`);
  }
  revalidatePath("/dashboard/driver");
  revalidatePath("/dashboard/deliveries");
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard");
  redirect("/dashboard/driver?delivered=1");
}

export async function reportProblemAction(formData: FormData): Promise<void> {
  const deliveryId = String(formData.get("deliveryId") ?? "");
  const reason = String(formData.get("reason") ?? "");

  try {
    await withAuth(deliveryId, ({ tenantId }) => reportFailure(tenantId, deliveryId, reason));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not report that problem.";
    redirect(`/dashboard/driver?err=${encodeURIComponent(message)}`);
  }
  revalidatePath("/dashboard/driver");
  revalidatePath("/dashboard/deliveries");
  redirect("/dashboard/driver?reported=1");
}
