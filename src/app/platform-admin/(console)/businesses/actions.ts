"use server";

import { z } from "zod";
import { adminCommand } from "@/modules/platform-admin/command";
import { setBusinessStatus } from "@/modules/platform-admin/businesses.service";
import { changeBusinessPlan, clearEntitlementOverride, setEntitlementOverride } from "@/modules/billing/subscription.service";
import { AdminCommandError } from "@/modules/platform-admin/command";
import { eraseBusinessData } from "@/modules/privacy/data-subject.service";

const id = z.string().uuid();

/** Suspend or reactivate a business — explicit command, reason required, audited. */
export async function businessStatusAction(businessId: string, command: "SUSPEND" | "REACTIVATE", fd: FormData) {
  const bid = id.parse(businessId);
  await adminCommand({ permission: "businesses.manage", path: `/platform-admin/businesses/${bid}` }, fd, async () => {
    const to = await setBusinessStatus(bid, command === "SUSPEND" ? "SUSPEND" : "REACTIVATE");
    return { action: command === "SUSPEND" ? "business_suspended" : "business_reactivated", resource: { type: "business", id: bid }, businessId: bid, metadata: { to } };
  });
}

/** Put a business on a plan — a command with a reason (pilot merchants are moved by hand; no billing yet). */
export async function changePlanAction(businessId: string, fd: FormData) {
  const bid = id.parse(businessId);
  await adminCommand({ permission: "businesses.manage", path: `/platform-admin/businesses/${bid}` }, fd, async () => {
    const planCode = z.string().trim().min(1).max(32).parse(fd.get("planCode"));
    await changeBusinessPlan(bid, planCode);
    return { action: "business_plan_changed", resource: { type: "business", id: bid }, businessId: bid, metadata: { planCode } };
  });
}

/** Grant or remove ONE feature for ONE business, with a reason and optional expiry — the pilot's "switch it on for them" lever. */
export async function setOverrideAction(businessId: string, fd: FormData) {
  const bid = id.parse(businessId);
  await adminCommand({ permission: "businesses.manage", path: `/platform-admin/businesses/${bid}` }, fd, async (_admin, reason) => {
    const featureKey = z.string().trim().min(1).max(64).parse(fd.get("featureKey"));
    const mode = String(fd.get("mode") ?? "grant");
    if (mode === "clear") {
      const removed = await clearEntitlementOverride(bid, featureKey);
      if (!removed) throw new AdminCommandError("There was no override for that feature.");
      return { action: "entitlement_override_cleared", resource: { type: "business", id: bid }, businessId: bid, metadata: { featureKey } };
    }
    const enabled = mode !== "deny";
    const limitRaw = String(fd.get("limitValue") ?? "").trim();
    const limitValue = limitRaw === "" ? null : z.coerce.number().int().min(0).max(1_000_000).parse(limitRaw);
    const expiresRaw = String(fd.get("expiresAt") ?? "").trim();
    const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) throw new AdminCommandError("The expiry date is not valid.");
    await setEntitlementOverride(bid, featureKey, { enabled, limitValue, expiresAt, reason: reason ?? "" });
    return { action: enabled ? "entitlement_override_granted" : "entitlement_override_denied", resource: { type: "business", id: bid }, businessId: bid, metadata: { featureKey, limitValue, expiresAt: expiresAt?.toISOString() ?? null } };
  });
}

/** Tab 5 — erase a suspended/deactivated business's personal data. Super admins only, reason required, recorded as a data-subject request and audited. */
export async function eraseBusinessAction(businessId: string, fd: FormData) {
  const bid = id.parse(businessId);
  await adminCommand({ permission: "businesses.erase", path: `/platform-admin/businesses/${bid}`, okFlag: "erased" }, fd, async (admin, reason) => {
    const summary = await eraseBusinessData(bid, { type: "platform_admin", id: admin.adminId }, reason ?? "");
    return { action: "business_erased", resource: { type: "business", id: bid }, businessId: bid, metadata: { ...summary } };
  });
}
