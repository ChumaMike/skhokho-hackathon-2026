"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { SecretBoxError } from "@/lib/crypto/secret-box";
import { requireStaffPermission, AuthError } from "@/lib/auth/guards";
import {
  saveConnection,
  setConnectionEnabled,
  disconnect,
  getConnection,
} from "@/modules/payments/payment-connection.service";
import type { PaymentEnvironment } from "@prisma/client";
import { markRefundResolved, RefundResolutionError } from "@/modules/payments/refund-resolution.service";
import { recordAudit, requestContext } from "@/modules/platform-admin/audit";
import { setCustomerPaymentMode, type CustomerPaymentMode } from "@/modules/orders/checkout-payment";

export type ActionResult = { ok: true } | { ok: false; error: string };

const PAGE = "/dashboard/settings/payments";

/**
 * Every action here is gated on canManageBilling.
 *
 * Not canProcessPayments — that is granted to cashiers and managers and means
 * "can take a payment at the till". This screen decides WHERE a business's
 * money is sent, which is a different and far more dangerous thing. No staff
 * preset grants canManageBilling, so in practice only an owner reaches these.
 */
async function permittedRedirect(): Promise<string> {
  try {
    const { payload } = await requireStaffPermission("canManageBilling");
    return payload.tenantId;
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    const message = err instanceof Error ? err.message : "Not allowed.";
    redirect(`${PAGE}?err=${encodeURIComponent(message)}`);
  }
}

async function permittedSession(): Promise<{ ok: true; tenantId: string } | { ok: false; error: string }> {
  try {
    const { payload } = await requireStaffPermission("canManageBilling");
    return { ok: true, tenantId: payload.tenantId };
  } catch (err) {
    if (err instanceof AuthError && err.status === 401) redirect("/login");
    return { ok: false, error: err instanceof Error ? err.message : "Not allowed." };
  }
}

/** ZodError.message is a JSON-stringified issue array — not fit to show a person. */
function friendlyMessage(e: unknown, fallback: string): string {
  if (e instanceof ZodError) return e.issues[0]?.message ?? fallback;
  // A missing or broken encryption key is a deployment fault, not something an
  // owner did or can fix. Its real message names an environment variable and a
  // shell command — useful in a log, meaningless and alarming on a settings
  // page — so it is logged and replaced.
  if (e instanceof SecretBoxError) {
    console.error("[payments] credential encryption unavailable:", e.message);
    return "Payments can't be set up right now — this is on our side. Please try again shortly or contact support.";
  }
  return e instanceof Error ? e.message : fallback;
}

function readEnvironment(value: FormDataEntryValue | null): PaymentEnvironment {
  return String(value ?? "") === "LIVE" ? "LIVE" : "SANDBOX";
}

/**
 * Saves credentials for one environment.
 *
 * The values never touch a log or a redirect. On failure only the validation
 * message travels back in the query string — never the field the owner typed.
 */
export async function saveConnectionAction(formData: FormData): Promise<void> {
  const tenantId = await permittedRedirect();
  const environment = readEnvironment(formData.get("environment"));

  try {
    await saveConnection(tenantId, {
      environment,
      merchantId: String(formData.get("merchantId") ?? ""),
      merchantKey: String(formData.get("merchantKey") ?? ""),
      passphrase: String(formData.get("passphrase") ?? "") || undefined,
    });
  } catch (e) {
    redirect(`${PAGE}?err=${encodeURIComponent(friendlyMessage(e, "Could not save those details."))}`);
  }

  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=${environment.toLowerCase()}`);
}

export async function setEnabledAction(
  environment: PaymentEnvironment,
  enabled: boolean,
): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;

  try {
    await setConnectionEnabled(session.tenantId, environment, enabled);
  } catch (e) {
    return { ok: false, error: friendlyMessage(e, "Could not change that.") };
  }
  revalidatePath(PAGE);
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Disconnects. The row is retired, never deleted — it carries the receiving
 * identity for every payment already made through it, and a notification
 * still in flight must remain verifiable against it.
 */
export async function disconnectAction(environment: PaymentEnvironment): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;

  try {
    await disconnect(session.tenantId, environment);
  } catch (e) {
    return { ok: false, error: friendlyMessage(e, "Could not disconnect.") };
  }
  revalidatePath(PAGE);
  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * Starts a verification payment and hands the owner to PayFast.
 *
 * SANDBOX moves no real money and is the normal path: it proves the
 * credentials, the signature and the notification round-trip actually work.
 *
 * LIVE is a real charge against the owner's own account and is therefore
 * gated behind PAYMENTS_ALLOW_LIVE_VERIFICATION. The workflow is built and
 * ready, but it stays switched off until the real-money step is signed off
 * separately — an accidental live charge during development is not something
 * to leave one click away.
 */
export async function startVerificationAction(environment: PaymentEnvironment): Promise<ActionResult> {
  const session = await permittedSession();
  if (!session.ok) return session;

  if (environment === "LIVE" && process.env.PAYMENTS_ALLOW_LIVE_VERIFICATION !== "true") {
    return {
      ok: false,
      error:
        "Live verification is a real payment from your own account and is not switched on yet. Verify with the sandbox first.",
    };
  }

  const connection = await getConnection(session.tenantId, environment);
  if (!connection) return { ok: false, error: "Connect an account first." };

  // PayFast requires an actual HTML form POST carrying the signed fields,
  // not a redirect with them in the query string — a GET submission gets a
  // 400 from PayFast's own engine. The verify page builds the attempt and
  // renders/auto-submits that form (the same pattern the real customer
  // checkout handoff already uses — see AutoSubmitForm's own comment); this
  // action's job is just the permission/gate checks above.
  redirect(`${PAGE}/verify/${environment.toLowerCase()}`);
}

/**
 * Closes a REFUND_DUE payment once the owner has refunded the customer in
 * their own PayFast dashboard. Same canManageBilling gate as the rest of
 * this screen — it is a statement about money, made by the person who
 * controls where the money goes. Recorded with a reason and audited; the
 * attempt itself is never edited.
 */
export async function markRefundResolvedAction(attemptId: string, formData: FormData): Promise<void> {
  const { tenantId, staffId } = await (async () => {
    try {
      const { payload } = await requireStaffPermission("canManageBilling");
      return payload;
    } catch (err) {
      if (err instanceof AuthError && err.status === 401) redirect("/login");
      redirect(`${PAGE}?err=${encodeURIComponent(err instanceof Error ? err.message : "Not allowed.")}`);
    }
  })();
  const reason = String(formData.get("reason") ?? "");
  const providerRefundRef = String(formData.get("providerRefundRef") ?? "");
  try {
    await markRefundResolved(tenantId, attemptId, { reason, providerRefundRef, actor: { type: "staff", id: staffId } });
  } catch (e) {
    if (e instanceof RefundResolutionError) redirect(`${PAGE}?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
  await recordAudit({
    category: "MERCHANT_ACTION",
    action: "payment_refund_resolved",
    actor: { type: "staff", id: staffId },
    businessId: tenantId,
    resource: { type: "payment_attempt", id: attemptId },
    reason,
    ...(await requestContext()),
  });
  revalidatePath(PAGE);
  revalidatePath("/dashboard/notifications");
  redirect(`${PAGE}?refunded=1`);
}

/**
 * How customers may pay once card is live: both (customer chooses), card
 * only, or in person only — one radio group, written to the same settings
 * JSON checkout reads (checkout-payment.ts). Same canManageBilling gate as
 * everything else on this page: it changes what money a shop takes and how.
 */
export async function setCustomerPaymentModeAction(formData: FormData): Promise<void> {
  const tenantId = await permittedRedirect();
  const mode = String(formData.get("mode") ?? "");
  try {
    await setCustomerPaymentMode(tenantId, mode as CustomerPaymentMode);
  } catch (e) {
    redirect(`${PAGE}?err=${encodeURIComponent(friendlyMessage(e, "Could not save that."))}`);
  }
  revalidatePath(PAGE);
  redirect(`${PAGE}?saved=mode`);
}
