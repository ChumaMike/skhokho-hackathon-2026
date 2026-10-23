"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma/client";
import { createOrder } from "@/modules/orders/order.service";
import { resolveActingStaffId } from "@/modules/staff/staff.service";

export type ActionResult = { ok: true; orderId?: string } | { ok: false; error: string };

/**
 * Walk-in/counter order creation — createOrder's own doc comment already
 * anticipates this exact caller ("a generic, trusted-input function used
 * by POS too"). The one thing this action must NOT do is trust a client-
 * submitted price: `items` here carries only productId + quantity: the
 * current price is re-fetched from `Product` server-side, same boundary
 * rule the storefront checkout route already applies to customer-submitted
 * carts.
 */
export async function createCounterOrderAction(formData: FormData): Promise<ActionResult> {
  let payload;
  try {
    ({ payload } = await requireStaffPermission("canManageOrders"));
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    return { ok: false, error: "Your role doesn't have permission to take orders — ask the business owner." };
  }

  const raw = String(formData.get("items") ?? "[]");
  const paymentMethod = String(formData.get("paymentMethod") ?? "CASH");

  let cart: { productId: string; quantity: number }[];
  try {
    cart = JSON.parse(raw);
  } catch {
    return { ok: false, error: "That order couldn't be read — try again." };
  }
  if (!Array.isArray(cart) || cart.length === 0) {
    return { ok: false, error: "Add at least one item first." };
  }

  const productIds = cart.map((c) => c.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, businessId: payload.tenantId, isActive: true },
    select: { id: true, name: true, price: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const items = cart.flatMap((line) => {
    const product = byId.get(line.productId);
    if (!product || line.quantity < 1) return [];
    return [
      {
        productId: product.id,
        name: product.name,
        quantity: line.quantity,
        unitPrice: Number(product.price),
        discount: 0,
      },
    ];
  });

  if (items.length === 0) {
    return { ok: false, error: "Those items are no longer available." };
  }

  const actingStaffId = await resolveActingStaffId(payload.tenantId, {
    staffId: payload.staffId,
    isOwner: payload.isOwner,
  });

  try {
    const order = await createOrder(payload.tenantId, {
      source: "pos",
      staffId: actingStaffId,
      items,
      // The counter already took payment before this fires — the concept's
      // single "Take payment / place order" action, not a separate later
      // step. CASH/CARD are the two realistic in-person methods; EFT/
      // SnapScan etc. stay reachable through the full Orders page.
      paymentMethod: paymentMethod === "CARD" ? "CARD" : "CASH",
      paymentStatus: "PAID",
      fulfilmentMethod: "COLLECTION",
      discount: 0,
      deliveryFee: 0,
    });
    revalidatePath("/dashboard/counter");
    revalidatePath("/dashboard/orders");
    revalidatePath("/dashboard/kitchen");
    revalidatePath("/dashboard");
    return { ok: true, orderId: order?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create that order." };
  }
}
