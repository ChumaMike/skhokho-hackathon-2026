import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma/client";
import { getAppUrl, formatZAR } from "@/lib/utils";
import { buildPaymentFields, payfastProcessUrl } from "@/lib/payfast";
import { createAttempt, markAttemptSubmitted, expireStaleAttemptsForOrder } from "@/modules/payments/payment-attempt.service";
import { decideHandoff, buyerContactForHandoff } from "@/modules/payments/pay-handoff";
import { getReceivingConnection } from "@/modules/payments/payment-connection.service";
import AutoSubmitForm from "@/components/payments/AutoSubmitForm";
import { orderVisibleOnRequest, requestTenant } from "@/lib/tenant/storefront-request";
import { canonicalStorefrontUrl } from "@/modules/tenant/storefront-url";

export const dynamic = "force-dynamic";

/**
 * Auto-submitting PayFast handoff — PayFast requires an actual HTML form
 * POST carrying the signed fields, not a plain redirect link, so this
 * page exists only to render that form and submit it immediately.
 * Reached right after order creation (see /api/store/order/route.ts).
 */
export default async function PayOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = await params;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      businessId: true,
      total: true,
      status: true,
      paymentStatus: true,
      business: { select: { slug: true } },
      membership: {
        select: { customer: { select: { identifiers: { select: { type: true, value: true } } } } },
      },
    },
  });
  // On a tenant host, never hand off another business's order for payment.
  const tenant = await requestTenant();
  if (!order || !orderVisibleOnRequest(order.businessId, tenant)) notFound();

  // PayFast requires at least one of email_address/cell_number on every
  // submission (no field-level error on a missing one — it's a bare 400).
  // Only one is sent: this page is reachable by anyone holding the order id.
  // A walk-in/POS order has no membership at all and never reaches here.
  const buyer = buyerContactForHandoff(order.membership?.customer.identifiers ?? []);

  const h = await headers();
  const requestOrigin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  // notify_url is registered with a third party (PayFast) as the
  // destination for payment-confirmation callbacks — this must be the
  // trusted canonical origin, never the request's own (spoofable) Host
  // header, or a forged Host could redirect real payment confirmations
  // to an attacker's server. return_url/cancel_url carry the same risk
  // at a lower severity (they only affect where the customer's own
  // browser bounces back to), so all three use the same trusted origin.
  const origin = getAppUrl(requestOrigin);
  // A customer who checked out on the business's own host returns there;
  // the legacy path flow keeps returning to the platform origin.
  const storeUrl = tenant ? canonicalStorefrontUrl(order.business.slug) : `${origin}/store/${order.business.slug}`;

  // The handoff is built from THIS business's own connection, resolved from
  // the order rather than from anything in the request. A business with no
  // verified live account has no card option at all — it must never fall back
  // to a platform account, which would route this merchant's customer money to
  // SGDataInt.
  const payable = order.paymentStatus === "PENDING" && order.status !== "CANCELLED" && order.status !== "COMPLETED";
  const receiving = payable ? await getReceivingConnection(order.businessId) : null;
  // Tidies this order's stale handoffs away first (bookkeeping only — a late
  // verified payment for an expired one is still recorded), so the cap below
  // counts only genuinely live ones.
  const openAttempts = payable && receiving?.status === "VERIFIED" ? await expireStaleAttemptsForOrder(order.businessId, order.id) : 0;
  const decision = decideHandoff({
    paymentStatus: order.paymentStatus,
    orderStatus: order.status,
    receivingVerified: receiving?.status === "VERIFIED",
    openAttempts,
    // In production notify_url must come from NEXT_PUBLIC_APP_URL, never Host.
    trustedOriginConfigured: Boolean(process.env.NEXT_PUBLIC_APP_URL) || process.env.NODE_ENV !== "production",
  });

  if (decision.kind !== "HANDOFF") {
    if (decision.kind === "MISCONFIGURED") {
      console.error("[store/pay] NEXT_PUBLIC_APP_URL is not set — refusing to build a PayFast notify_url from the Host header");
    }
    return <PayNotice kind={decision.kind} orderNumber={order.orderNumber} total={formatZAR(order.total)} storeUrl={storeUrl} />;
  }

  // A fresh attempt per visit, each with its own provider reference. Reusing
  // one reference across retries is what makes a late notification impossible
  // to attribute to the submission that produced it.
  const attempt = await createAttempt(order.businessId, "LIVE", {
    orderId: order.id,
    amount: Number(order.total),
  });

  const fields = buildPaymentFields(
    {
      reference: attempt.reference,
      amount: Number(order.total),
      itemName: `Order ${order.orderNumber}`,
      returnUrl: `${storeUrl}?ok=order&orderId=${order.id}`,
      cancelUrl: `${storeUrl}?err=${encodeURIComponent("Payment was cancelled.")}`,
      notifyUrl: `${origin}/api/payments/payfast/notify`,
      ...buyer,
    },
    attempt.credentials,
  );
  await markAttemptSubmitted(attempt.id);

  return (
    <main className="shell">
      <div className="column" style={{ paddingTop: "20vh", textAlign: "center" }}>
        <p>
          Order <strong>{order.orderNumber}</strong> — <strong>{formatZAR(order.total)}</strong>
        </p>
        <p style={{ color: "var(--dust)" }}>Taking you to PayFast to pay…</p>
        <AutoSubmitForm action={payfastProcessUrl(attempt.environment)} fields={fields} />
      </div>
    </main>
  );
}

const NOTICE_COPY: Record<Exclude<ReturnType<typeof decideHandoff>["kind"], "HANDOFF">, string> = {
  ALREADY_PAID: "This order is already paid.",
  NOT_PAYABLE: "This order can't be paid online any more. Please contact the shop if you think that's wrong.",
  ONLINE_PAYMENT_OFF: "Paying online isn't switched on for this shop yet, so nothing has been charged.",
  TOO_MANY_ATTEMPTS: "There are already a few payment windows open for this order. Please finish one of them, or try again a bit later.",
  MISCONFIGURED: "Paying online is temporarily unavailable. Nothing has been charged — please try again soon.",
};

function PayNotice({
  kind,
  orderNumber,
  total,
  storeUrl,
}: {
  kind: keyof typeof NOTICE_COPY;
  orderNumber: string;
  total: string;
  storeUrl: string;
}) {
  return (
    <main className="shell">
      <div className="column">
        <div className="successBanner">
          Order <strong>{orderNumber}</strong>
        </div>
        <p>{NOTICE_COPY[kind]}</p>
        {kind === "ONLINE_PAYMENT_OFF" && (
          <p>
            Your order total is <strong>{total}</strong> — arrange payment with the shop directly when you collect.
          </p>
        )}
        <a className="btn btnSecondary" href={storeUrl}>
          Back to the shop
        </a>
      </div>
    </main>
  );
}
