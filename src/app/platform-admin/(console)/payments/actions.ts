"use server";

import { z } from "zod";
import { adminCommand } from "@/modules/platform-admin/command";
import { markRefundResolved } from "@/modules/payments/refund-resolution.service";

/**
 * FINANCE closes a REFUND_DUE attempt on the merchant's behalf (support
 * case, or a merchant who refunded in PayFast but never came back to the
 * console). Reason required, audited, never edits the attempt itself.
 */
export async function resolveRefundAction(attemptId: string, fd: FormData) {
  const id = z.string().min(10).max(40).parse(attemptId);
  await adminCommand({ permission: "payments.manage", path: `/platform-admin/payments/${id}`, okFlag: "refunded" }, fd, async (admin, reason) => {
    const attempt = await (await import("@/lib/prisma/client")).prisma.businessPaymentAttempt.findUniqueOrThrow({ where: { id }, select: { businessId: true } });
    const providerRefundRef = String(fd.get("providerRefundRef") ?? "").trim() || null;
    await markRefundResolved(attempt.businessId, id, { reason: reason ?? "", providerRefundRef, actor: { type: "platform_admin", id: admin.adminId } });
    return { action: "payment_refund_resolved", resource: { type: "payment_attempt", id }, businessId: attempt.businessId, metadata: { providerRefundRef } };
  });
}
