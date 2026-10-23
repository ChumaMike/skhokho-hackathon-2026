"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import { assignDriver, markDelivered } from "@/modules/orders/order-delivery.service";
import { rotateDropoffCode } from "@/modules/orders/delivery-code";
import { recordAudit, requestContext } from "@/modules/platform-admin/audit";
import { cancelNetworkDelivery, NetworkDeliveryError, requestNetworkDelivery, rotateDeliveryCode } from "@/modules/skhokholetha/delivery.service";

// canManageDeliveries already bypasses for isOwner (requireStaffPermission's
// existing owner shortcut) — this page's whole authority model is that one
// permission, matching the plan's permission matrix exactly.
async function permittedSession() {
  try {
    const { payload } = await requireStaffPermission("canManageDeliveries");
    return payload;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    throw err;
  }
}

export async function assignDriverAction(deliveryId: string, formData: FormData): Promise<void> {
  const driverStaffId = String(formData.get("driverStaffId") ?? "");

  let payload;
  try {
    payload = await permittedSession();
  } catch (e) {
    redirect(`/dashboard/deliveries?err=${encodeURIComponent(e instanceof Error ? e.message : "Could not assign that driver.")}`);
  }

  try {
    await assignDriver(payload.tenantId, deliveryId, driverStaffId);
  } catch (e) {
    redirect(`/dashboard/deliveries?err=${encodeURIComponent(e instanceof Error ? e.message : "Could not assign that driver.")}`);
  }
  revalidatePath("/dashboard/deliveries");
  revalidatePath("/dashboard/driver");
  revalidatePath("/dashboard");
  redirect("/dashboard/deliveries?assigned=1");
}

// ---------------------------------------------------------------------------
// Skhokholetha — request a network driver. Same single permission as above;
// every rule (eligibility, price, idempotency, tenant) is re-checked by the
// service, so nothing here trusts the form beyond "which order" and "which
// price the shop saw".
// ---------------------------------------------------------------------------

function back(params: string): never {
  revalidatePath("/dashboard/deliveries");
  redirect(`/dashboard/deliveries?${params}`);
}

async function lethaActor() {
  try {
    return await permittedSession();
  } catch (e) {
    unstable_rethrow(e); // the /login redirect must pass through
    back(`err=${encodeURIComponent(e instanceof Error ? e.message : "Not allowed.")}`);
  }
}

function lethaMessage(e: unknown): string {
  if (e instanceof NetworkDeliveryError) return e.message;
  console.error("[skhokholetha shop action]", e instanceof Error ? e.message : e);
  return "Something went wrong. Try again.";
}

export async function requestNetworkDriverAction(orderId: string, formData: FormData): Promise<void> {
  const payload = await lethaActor();
  const requestKey = String(formData.get("requestKey") ?? "");
  const confirmedFeeCents = Number(formData.get("confirmedFeeCents"));
  try {
    await requestNetworkDelivery(
      { businessId: payload.tenantId, staffId: payload.staffId },
      { orderId, requestKey, confirmedFeeCents: Number.isInteger(confirmedFeeCents) ? confirmedFeeCents : -1 },
    );
  } catch (e) {
    back(`err=${encodeURIComponent(lethaMessage(e))}`);
  }
  back("requested=1");
}

export async function cancelNetworkDriverAction(deliveryId: string, formData: FormData): Promise<void> {
  const payload = await lethaActor();
  try {
    await cancelNetworkDelivery({ type: "SHOP", id: payload.staffId, businessId: payload.tenantId }, deliveryId, String(formData.get("reason") ?? ""));
  } catch (e) {
    back(`err=${encodeURIComponent(lethaMessage(e))}`);
  }
  back("cancelled=1");
}

export async function rotateCodeAction(deliveryId: string, purpose: "PICKUP" | "DROPOFF"): Promise<void> {
  const payload = await lethaActor();
  if (purpose !== "PICKUP" && purpose !== "DROPOFF") back("err=Invalid%20request.");
  try {
    await rotateDeliveryCode(payload.tenantId, payload.staffId, deliveryId, purpose);
  } catch (e) {
    back(`err=${encodeURIComponent(lethaMessage(e))}`);
  }
  back("rotated=1");
}

// ---------------------------------------------------------------------------
// Own-driver proof of delivery (delivery-code.ts). Same canManageDeliveries
// authority as everything else on this page.
// ---------------------------------------------------------------------------

/** A new code after the driver locked it with wrong tries; it appears on the customer's page at once. */
export async function rotateOwnCodeAction(deliveryId: string): Promise<void> {
  const payload = await lethaActor();
  try {
    await rotateDropoffCode(payload.tenantId, deliveryId);
  } catch (e) {
    back(`err=${encodeURIComponent(e instanceof Error ? e.message : "Could not issue a new code.")}`);
  }
  revalidatePath("/dashboard/driver");
  back("rotated=1");
}

/** Completes a delivery WITHOUT the customer's code — a manager's call, with the reason on the record. */
export async function deliverWithoutCodeAction(deliveryId: string, formData: FormData): Promise<void> {
  const payload = await lethaActor();
  const reason = String(formData.get("reason") ?? "");
  try {
    await markDelivered(payload.tenantId, deliveryId, payload.staffId, { override: { reason, byStaffId: payload.staffId } });
    await recordAudit({
      category: "MERCHANT_ACTION",
      action: "delivery_code_overridden",
      actor: { type: "staff", id: payload.staffId },
      businessId: payload.tenantId,
      resource: { type: "order_delivery", id: deliveryId },
      reason,
      ...(await requestContext()),
    });
  } catch (e) {
    back(`err=${encodeURIComponent(e instanceof Error ? e.message : "Could not complete that delivery.")}`);
  }
  revalidatePath("/dashboard/driver");
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard");
  back("delivered=1");
}
