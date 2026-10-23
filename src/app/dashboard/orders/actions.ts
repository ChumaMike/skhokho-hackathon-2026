"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffPermission, requireAnyStaffPermission, AuthError } from "@/lib/auth/guards";
import {
  advanceOrderStatus,
  completeOrder,
  recordInPersonPayment,
  cancelOrder,
  acceptOrder,
  getOrderStatus,
  canAdvanceOrderFromStatus,
} from "@/modules/orders/order.service";
import { resolveActingStaffId } from "@/modules/staff/staff.service";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function permittedSession() {
  try {
    const { payload } = await requireStaffPermission("canManageOrders");
    return payload;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    throw err;
  }
}

// The door for advanceOrderStatusAction only — canPrepareOrders OR
// canManageOrders gets you in, but which specific transition is allowed
// still depends on the order's current status (canAdvanceOrderFromStatus),
// checked inside the action itself once the order is loaded.
async function permittedForPreparation() {
  try {
    return await requireAnyStaffPermission(["canManageOrders", "canPrepareOrders"]);
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    throw err;
  }
}

export async function advanceOrderStatusAction(orderId: string): Promise<ActionResult> {
  let payload, permissions;
  try {
    ({ payload, permissions } = await permittedForPreparation());
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not update that order.",
    };
  }

  const order = await getOrderStatus(payload.tenantId, orderId);
  if (!order) return { ok: false, error: "Order not found." };
  if (!canAdvanceOrderFromStatus(order.status, permissions)) {
    return { ok: false, error: "Your role doesn't have permission to do that — ask the business owner." };
  }

  try {
    await advanceOrderStatus(payload.tenantId, orderId);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not update that order.",
    };
  }
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/kitchen");
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * "Accept with ETA" — accepting a new order AND telling the customer when.
 * Distinct from Confirm (advanceOrderStatusAction), which promises nothing.
 * Managerial, like Confirm: canManageOrders only.
 */
export async function acceptOrderAction(orderId: string, formData: FormData): Promise<void> {
  const payload = await permittedSession();
  const minutes = Number(formData.get("etaMinutes"));
  try {
    await acceptOrder(payload.tenantId, orderId, minutes);
  } catch (e) {
    redirect(`/dashboard/orders?order=${orderId}&err=${encodeURIComponent(e instanceof Error ? e.message : "Could not accept that order.")}`);
  }
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/kitchen");
  revalidatePath("/dashboard");
  redirect(`/dashboard/orders?order=${orderId}&saved=1`);
}

/** Cancelling now needs a reason from the fixed list (plus a line of detail for "Other") — the customer is told why. */
export async function cancelOrderAction(orderId: string, formData: FormData): Promise<void> {
  const payload = await permittedSession();
  const reason = String(formData.get("reason") ?? "");
  const detail = String(formData.get("detail") ?? "");
  try {
    await cancelOrder(payload.tenantId, orderId, { reason: reason as never, detail }, payload.staffId);
  } catch (e) {
    redirect(`/dashboard/orders?order=${orderId}&err=${encodeURIComponent(e instanceof Error ? e.message : "Could not cancel that order.")}`);
  }
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard");
  redirect(`/dashboard/orders?saved=1`);
}

export async function markOrderComplete(orderId: string): Promise<ActionResult> {
  let payload;
  try {
    payload = await permittedSession();
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not complete that order.",
    };
  }

  const { tenantId, staffId, isOwner } = payload;
  const actingStaffId = await resolveActingStaffId(tenantId, { staffId, isOwner });

  try {
    await completeOrder(tenantId, orderId, actingStaffId);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not complete that order.",
    };
  }
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Records money taken in person, separately from handing the order over.
 *
 * These used to be one action, which meant marking an order complete also
 * declared it paid — including online orders still waiting on a gateway
 * notification, with nothing to reconcile the claim against. Taking payment
 * is now its own deliberate act, so a PAID order always means someone took
 * the money or a provider confirmed it.
 *
 * Gated on canProcessPayments, which is what the cashier and manager presets
 * already grant: taking a payment at the till is exactly this permission's
 * meaning. It is NOT canManageBilling — that governs where money is sent, a
 * far more dangerous thing than recording that some arrived.
 */
export async function recordPaymentAction(
  orderId: string,
  method: "CASH" | "CARD" | "EFT" | "SNAPSCAN" | "OZOW" | "ZAPPER" | "CAPITEC_PAY",
): Promise<ActionResult> {
  let tenantId: string;
  try {
    const { payload } = await requireStaffPermission("canProcessPayments");
    tenantId = payload.tenantId;
  } catch (e) {
    if (e instanceof AuthError && e.status === 401) redirect("/login");
    return { ok: false, error: "You don't have permission to record a payment." };
  }

  try {
    await recordInPersonPayment(tenantId, orderId, method);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not record that payment.",
    };
  }
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard");
  return { ok: true };
}
