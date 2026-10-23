"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import {
  logVisit,
  redeemReward,
  registerCustomer,
  stampByPhone,
} from "@/modules/customers/customer.service";

export type ActionResult = { ok: true } | { ok: false; error: string };

/** For form-POST actions (addCustomer) that already redirect to ?err= on any failure. */
async function permittedRedirect() {
  try {
    const { payload } = await requireStaffPermission("canManageCustomers");
    return payload;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    const message = err instanceof Error ? err.message : "Not allowed.";
    redirect(`/dashboard/customers/add?err=${encodeURIComponent(message)}`);
  }
}

/**
 * For ActionButton-driven actions that return ActionResult instead of
 * redirecting. Returns a discriminated result rather than throwing on a
 * permission failure (403) — see the identical comment on
 * catalog/actions.ts's version of this helper for why.
 *
 * Takes the permission to check rather than hardcoding one: stamping and
 * redeeming are both loyalty actions on an already-registered member, but
 * are gated separately (`canIssueLoyalty` vs `canAdjustLoyalty`, added
 * Phase 5) rather than both riding on `canManageCustomers` — a role can
 * hand out stamps without being trusted to redeem rewards (effectively
 * giving away stock/cash), the same distinction `canManageOrders` vs
 * `canProcessPayments` already draws elsewhere in this permission model.
 */
async function permittedSession(
  permission: "canIssueLoyalty" | "canAdjustLoyalty",
): Promise<{ ok: true; tenantId: string; staffId: string } | { ok: false; error: string }> {
  try {
    const { payload } = await requireStaffPermission(permission);
    return { ok: true, tenantId: payload.tenantId, staffId: payload.staffId };
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    return { ok: false, error: err instanceof Error ? err.message : "Not allowed." };
  }
}

/**
 * Tap an empty slot on an already-listed card.
 *
 * Not in the function list the task named (listMembers, getRegulars,
 * getLapsed, stampByPhone, redeemReward, registerCustomer) — but none of
 * those can stamp a specific card that's already on screen. `listMembers` /
 * `getRegulars` / `getLapsed` never return a phone number (by design, see
 * customer.service's header comment), so `stampByPhone` has nothing to key
 * on for a member the owner is looking at rather than typing in. `logVisit`
 * is the one export in the same module that stamps by the pairwise
 * `public_id` alone, which is exactly what DESIGN.md's "tapping an empty
 * slot stamps it" needs. Reported as a gap in the task report rather than
 * inventing new business logic — this only calls the existing RPC wrapper.
 *
 * `tenantId` comes from the signed-in session, never from the client, so a
 * tampered call can only ever touch the caller's own business (the
 * `log_visit` RPC also re-checks `public_id`+`business_id` together, so a
 * mismatched pair is a no-op at the database layer too).
 */
/**
 * `idempotencyKey`: generated client-side once per tap (see StampCard.tsx)
 * and threaded through unchanged — if this exact request needs to be
 * retried, resending the same key lets log_visit recognize the replay
 * instead of stamping twice. A genuinely new tap generates a new key, so
 * this never blocks a real second stamp.
 */
export async function stampMember(publicId: string, idempotencyKey: string): Promise<ActionResult> {
  const session = await permittedSession("canIssueLoyalty");
  if (!session.ok) return session;
  try {
    await logVisit(session.tenantId, publicId, "stamp", session.staffId, idempotencyKey);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not give a stamp.",
    };
  }
  revalidatePath("/dashboard/customers");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function redeemMember(publicId: string, idempotencyKey: string): Promise<ActionResult> {
  const session = await permittedSession("canAdjustLoyalty");
  if (!session.ok) return session;
  try {
    await redeemReward(session.tenantId, publicId, session.staffId, idempotencyKey);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not redeem that reward.",
    };
  }
  revalidatePath("/dashboard/customers");
  return { ok: true };
}

/**
 * "Add a customer" — the full staff-manual form (name, phone, email,
 * consent). Unlike `stampByPhone` (below, still phone-only for the busy
 * Counter quick-stamp flow, deliberately untouched), this composes
 * `registerCustomer` + `logVisit` directly so it can pass name/email/
 * consent through to the identity RPC — staff attest to consent on the
 * customer's behalf here, the same way a real in-person POS flow would
 * (verbally confirming, then ticking the box), consistent with the
 * storefront's own self-service consent checkboxes.
 */
export async function addCustomer(formData: FormData): Promise<void> {
  const { tenantId, staffId } = await permittedRedirect();
  const name = String(formData.get("name") ?? "").trim() || undefined;
  const phone = String(formData.get("phone") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim() || undefined;
  const consent = formData.get("consent") === "on";
  const consentMarketing = formData.get("consentMarketing") === "on";

  if (!phone) {
    redirect(
      `/dashboard/customers/add?err=${encodeURIComponent("Enter a phone number.")}`,
    );
  }
  if (!consent) {
    redirect(
      `/dashboard/customers/add?err=${encodeURIComponent("They need to agree to the terms first.")}`,
    );
  }

  let shortCode: string | null = null;
  let errorMessage: string | null = null;
  try {
    const reg = await registerCustomer(
      tenantId, phone, name, "owner_dashboard", staffId, undefined,
      email, consentMarketing,
    );
    await logVisit(tenantId, reg.public_id, "stamp", staffId);
    shortCode = reg.short_code;
  } catch (e) {
    errorMessage =
      e instanceof Error ? e.message : "Could not add that customer.";
  }

  if (errorMessage || !shortCode) {
    redirect(
      `/dashboard/customers/add?err=${encodeURIComponent(errorMessage ?? "Could not add that customer.")}`,
    );
  }

  revalidatePath("/dashboard/customers");
  revalidatePath("/dashboard");
  redirect(`/dashboard/customers?added=${encodeURIComponent(shortCode)}`);
}

/**
 * The Counter workspace's own quick-stamp form — same operation as
 * addCustomer above (find-or-register by phone, then stamp), just
 * redirecting back to /dashboard/counter instead of the full customers
 * page, so a cashier's flow stays on their own screen. Gated identically
 * to addCustomer (canManageCustomers) since it's the same action.
 */
export async function stampByPhoneAction(formData: FormData): Promise<void> {
  const { tenantId, staffId } = await permittedRedirect();
  const phone = String(formData.get("phone") ?? "").trim();

  if (!phone) {
    redirect(`/dashboard/counter?err=${encodeURIComponent("Enter a phone number.")}`);
  }

  let shortCode: string | null = null;
  let errorMessage: string | null = null;
  try {
    const result = await stampByPhone(tenantId, phone, staffId);
    shortCode = result.short_code;
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : "Could not stamp that customer.";
  }

  if (errorMessage || !shortCode) {
    redirect(`/dashboard/counter?err=${encodeURIComponent(errorMessage ?? "Could not stamp that customer.")}`);
  }

  revalidatePath("/dashboard/customers");
  revalidatePath("/dashboard");
  redirect(`/dashboard/counter?stamped=${encodeURIComponent(shortCode)}`);
}
