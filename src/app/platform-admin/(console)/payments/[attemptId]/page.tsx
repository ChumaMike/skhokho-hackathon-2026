import Link from "next/link";
import { notFound } from "next/navigation";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { prisma } from "@/lib/prisma/client";
import { formatZAR } from "@/lib/utils";
import { Badge, Banner, KV, PageHeader, ReasonField, Section, Table, when } from "../../ui";
import { can } from "@/modules/platform-admin/permissions";
import { resolveRefundAction } from "../actions";

export const dynamic = "force-dynamic";

/** One payment attempt and every provider notification for it (duplicates included) — read-only. */
export default async function PaymentTracePage({
  params,
  searchParams,
}: {
  params: Promise<{ attemptId: string }>;
  searchParams: Promise<{ ok?: string; err?: string }>;
}) {
  const admin = await adminPage("payments.view");
  const { attemptId } = await params;
  const sp = await searchParams;
  const a = await prisma.businessPaymentAttempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      reference: true,
      purpose: true,
      provider: true,
      environment: true,
      merchantIdSnapshot: true,
      expectedAmount: true,
      currency: true,
      status: true,
      providerPaymentId: true,
      failureReason: true,
      createdAt: true,
      submittedAt: true,
      verifiedAt: true,
      business: { select: { id: true, name: true } },
      order: { select: { id: true, orderNumber: true, paymentStatus: true } },
      connection: { select: { status: true, environment: true } },
      refundResolution: { select: { resolvedAt: true, resolvedByType: true, resolvedById: true, reason: true, providerRefundRef: true } },
      events: { orderBy: { receivedAt: "asc" }, select: { id: true, providerPaymentId: true, providerStatus: true, amountGross: true, outcome: true, detail: true, receivedAt: true } },
    },
  });
  if (!a) notFound();
  // The merchant id is an account identifier, not a secret — still, only its tail is needed here.
  const merchant = `…${a.merchantIdSnapshot.slice(-4)}`;

  return (
    <>
      <PageHeader title={`Payment ${a.reference}`} sub={`${a.provider} · ${a.environment.toLowerCase()} · ${a.purpose.toLowerCase().replace("_", " ")}`} />
      <Banner ok={sp.ok === "refunded" ? "Refund recorded." : undefined} err={sp.err} />
      <Section title="Trace">
        <KV
          items={[
            ["Business", <Link key="b" href={`/platform-admin/businesses/${a.business.id}`}>{a.business.name}</Link>],
            ["Order", a.order ? <Link key="o" href={`/platform-admin/orders/${a.order.id}`}>{a.order.orderNumber} ({a.order.paymentStatus.toLowerCase()})</Link> : "—"],
            ["Status", <Badge key="s" tone={a.status === "COMPLETE" ? "ok" : a.status === "REFUND_DUE" || a.status === "FAILED" ? "bad" : "warn"}>{a.status.toLowerCase()}</Badge>],
            ["Expected", `${formatZAR(a.expectedAmount)} ${a.currency}`],
            ["Provider payment id", a.providerPaymentId ?? "—"],
            ["Merchant account", `${merchant} (connection ${a.connection.status.toLowerCase()})`],
            ["Created / submitted / verified", `${when(a.createdAt)} / ${when(a.submittedAt)} / ${when(a.verifiedAt)}`],
            ["Failure", a.failureReason ?? "—"],
          ]}
        />
      </Section>
      {a.status === "REFUND_DUE" && (
        <Section title="Refund">
          {a.refundResolution ? (
            <KV
              items={[
                ["Resolved", when(a.refundResolution.resolvedAt)],
                ["By", `${a.refundResolution.resolvedByType} ${a.refundResolution.resolvedById}`],
                ["Reason", a.refundResolution.reason],
                ["PayFast refund reference", a.refundResolution.providerRefundRef ?? "—"],
              ]}
            />
          ) : (
            <>
              <p>Still owed to the customer. The merchant refunds in their own PayFast account and marks it done in Settings › Payments; FINANCE can record it here on their behalf.</p>
              {can(admin.role, "payments.manage") && (
                <form action={resolveRefundAction.bind(null, a.id)} style={{ display: "grid", gap: 8, maxWidth: 480 }}>
                  <ReasonField placeholder="Why it is resolved (e.g. merchant confirmed the PayFast refund on …)" />
                  <input className="input" name="providerRefundRef" maxLength={100} placeholder="PayFast refund reference (optional)" />
                  <button type="submit" className="btn btnPrimary">Mark refund resolved</button>
                </form>
              )}
            </>
          )}
        </Section>
      )}
      <Section title={`Provider notifications (${a.events.length})`}>
        <Table
          head={["Received", "Provider status", "Outcome", "Gross", "Provider id", "Detail"]}
          rows={a.events.map((e) => [
            when(e.receivedAt),
            e.providerStatus,
            <Badge key="o" tone={e.outcome === "SETTLED" ? "ok" : e.outcome === "REFUND_DUE" ? "bad" : undefined}>{e.outcome.toLowerCase().replace("_", " ")}</Badge>,
            e.amountGross ? formatZAR(e.amountGross) : "—",
            e.providerPaymentId,
            e.detail ?? "",
          ])}
          empty="No notification received from the provider yet."
        />
        <p style={{ opacity: 0.75 }}>A repeated notification is stored once and shown as &quot;duplicate notification&quot; — it never settles twice.</p>
      </Section>
    </>
  );
}
