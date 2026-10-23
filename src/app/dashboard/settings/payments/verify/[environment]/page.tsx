import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireOwnerSession } from "../../../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { getAppUrl } from "@/lib/utils";
import { prisma } from "@/lib/prisma/client";
import { buildPaymentFields, payfastProcessUrl } from "@/lib/payfast";
import { createAttempt, markAttemptSubmitted } from "@/modules/payments/payment-attempt.service";
import { getConnection } from "@/modules/payments/payment-connection.service";
import AutoSubmitForm from "@/components/payments/AutoSubmitForm";
import type { PaymentEnvironment } from "@prisma/client";

export const dynamic = "force-dynamic";

const PAGE = "/dashboard/settings/payments";

/** Small on purpose — large enough to be a genuine transaction, small enough not to matter. */
const VERIFICATION_AMOUNT = 5;

/**
 * Builds and auto-submits the real PayFast verification payment — split out
 * from startVerificationAction (actions.ts) because PayFast requires an
 * actual HTML form POST carrying the signed fields, not a redirect with
 * them in the query string (a GET submission gets a 400 from PayFast's own
 * engine). The real customer checkout handoff (store/pay/[orderId]) already
 * solves this the same way; this page mirrors it for the owner's own
 * account-verification payment.
 */
export default async function VerifyPaymentPage({
  params,
}: {
  params: Promise<{ environment: string }>;
}) {
  const { environment: rawEnvironment } = await params;
  const environment = rawEnvironment.toUpperCase();
  if (environment !== "SANDBOX" && environment !== "LIVE") notFound();

  const session = await requireOwnerSession();
  try {
    await requireStaffPermission("canManageBilling");
  } catch {
    redirect(`${PAGE}?err=${encodeURIComponent("Only the business owner can change where payments go.")}`);
  }

  // Re-checked here, not just in the action that linked here — this page is
  // a real URL, and an owner (or a bookmark) reaching it directly must never
  // bypass the same gate the button does.
  if (environment === "LIVE" && process.env.PAYMENTS_ALLOW_LIVE_VERIFICATION !== "true") {
    redirect(
      `${PAGE}?err=${encodeURIComponent("Live verification is a real payment from your own account and is not switched on yet. Verify with the sandbox first.")}`,
    );
  }

  const env = environment as PaymentEnvironment;
  const connection = await getConnection(session.tenantId, env);
  if (!connection) {
    redirect(`${PAGE}?err=${encodeURIComponent("Connect an account first.")}`);
  }

  const h = await headers();
  const origin = getAppUrl(`${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`);

  // PayFast requires at least one of email_address/cell_number on every
  // submission — the business's own contact details stand in here since
  // this is the owner's own verification payment, not a customer's.
  const business = await prisma.business.findUnique({
    where: { id: session.tenantId },
    select: { email: true, phone: true },
  });

  // A verification attempt proves an account can receive money. It has no
  // order, because it is not a purchase.
  const attempt = await createAttempt(session.tenantId, env, {
    orderId: null,
    amount: VERIFICATION_AMOUNT,
    purpose: "LIVE_VERIFICATION",
  });

  const fields = buildPaymentFields(
    {
      reference: attempt.reference,
      amount: VERIFICATION_AMOUNT,
      itemName: "Skhokho account verification",
      returnUrl: `${origin}${PAGE}?verifying=1`,
      cancelUrl: `${origin}${PAGE}?err=${encodeURIComponent("Verification was cancelled.")}`,
      notifyUrl: `${origin}/api/payments/payfast/notify`,
      buyerEmail: business?.email ?? undefined,
      buyerCellNumber: business?.phone ?? undefined,
    },
    attempt.credentials,
  );
  await markAttemptSubmitted(attempt.id);

  return (
    <main className="shell">
      <div className="column" style={{ paddingTop: "20vh", textAlign: "center" }}>
        <p>R{VERIFICATION_AMOUNT.toFixed(2)} verification payment</p>
        <p style={{ color: "var(--dust)" }}>Taking you to PayFast…</p>
        <AutoSubmitForm action={payfastProcessUrl(attempt.environment)} fields={fields} />
      </div>
    </main>
  );
}
