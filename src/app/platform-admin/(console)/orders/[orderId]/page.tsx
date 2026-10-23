import Link from "next/link";
import { notFound } from "next/navigation";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { can } from "@/modules/platform-admin/permissions";
import { prisma } from "@/lib/prisma/client";
import { formatCents, formatZAR } from "@/lib/utils";
import { Badge, KV, PageHeader, Section, Table, when } from "../../ui";

export const dynamic = "force-dynamic";

/**
 * Trace: Business → Order → Payment attempt(s) → provider notifications, plus
 * any delivery. The customer's address and phone are shown only to roles with
 * orders.customerDetails; the customer's identity (customers.id) never is.
 */
export default async function OrderTracePage({ params }: { params: Promise<{ orderId: string }> }) {
  const admin = await adminPage("orders.view");
  const { orderId } = await params;
  const o = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      paymentRef: true,
      paidAt: true,
      subtotal: true,
      deliveryFee: true,
      discount: true,
      total: true,
      fulfilmentMethod: true,
      source: true,
      createdAt: true,
      membershipId: true,
      business: { select: { id: true, name: true } },
      items: { select: { name: true, quantity: true, unitPrice: true } },
      delivery: { select: { status: true, deliveryAddressSnapshot: true, contactPhone: true, deliveredAt: true, failureReason: true, customerKeyHash: true, networkDeliveries: { select: { id: true, status: true, quoteFeeCents: true } } } },
      paymentAttempts: {
        orderBy: { createdAt: "asc" },
        select: { id: true, reference: true, status: true, environment: true, expectedAmount: true, providerPaymentId: true, createdAt: true, verifiedAt: true, failureReason: true },
      },
    },
  });
  if (!o) notFound();
  const showCustomer = can(admin.role, "orders.customerDetails");
  const showPayments = can(admin.role, "payments.view");

  return (
    <>
      <PageHeader title={`Order ${o.orderNumber}`} sub={`${o.business.name} · placed ${when(o.createdAt)}`} />
      <Section title="Order">
        <KV
          items={[
            ["Business", <Link key="b" href={`/platform-admin/businesses/${o.business.id}`}>{o.business.name}</Link>],
            ["Status", o.status.toLowerCase()],
            ["Payment", <Badge key="p" tone={o.paymentStatus === "PAID" ? "ok" : "warn"}>{o.paymentStatus.toLowerCase()}</Badge>],
            ["Method", `${o.paymentMethod?.toLowerCase() ?? "—"}${o.paymentRef ? ` · ref ${o.paymentRef}` : ""}${o.paidAt ? ` · paid ${when(o.paidAt)}` : ""}`],
            ["Amounts", `subtotal ${formatZAR(o.subtotal)} · delivery ${formatZAR(o.deliveryFee)} · discount ${formatZAR(o.discount)} · total ${formatZAR(o.total)}`],
            ["Customer", o.membershipId ? "loyalty member (identity not shown)" : "guest"],
            ["Source", o.source ?? "—"],
          ]}
        />
        <Table head={["Item", "Qty", "Unit"]} rows={o.items.map((i) => [i.name, i.quantity, formatZAR(i.unitPrice)])} />
      </Section>

      {showPayments && (
        <Section title="Payment attempts → provider">
          <Table
            head={["Reference", "Status", "Env", "Expected", "Provider payment id", "Created", "Verified", "Failure"]}
            rows={o.paymentAttempts.map((a) => [
              <Link key="r" href={`/platform-admin/payments/${a.id}`}>{a.reference}</Link>,
              a.status.toLowerCase(),
              a.environment.toLowerCase(),
              formatZAR(a.expectedAmount),
              a.providerPaymentId ?? "—",
              when(a.createdAt),
              when(a.verifiedAt),
              a.failureReason ?? "",
            ])}
            empty="No online payment attempts (in-person or unpaid)."
          />
        </Section>
      )}

      {o.delivery && (
        <Section title="Delivery">
          <KV
            items={[
              ["Own-driver status", o.delivery.status.toLowerCase()],
              ["Address", showCustomer ? o.delivery.deliveryAddressSnapshot : "hidden for your role"],
              ["Customer phone", showCustomer ? o.delivery.contactPhone ?? "—" : "hidden for your role"],
              ["Customer delivery key", o.delivery.customerKeyHash ? "issued (held by the customer only)" : "none"],
              ["Delivered", when(o.delivery.deliveredAt)],
              ["Failure", o.delivery.failureReason ?? "—"],
            ]}
          />
          <Table
            head={["Skhokholetha delivery", "Status", "Fee"]}
            rows={o.delivery.networkDeliveries.map((n) => [<Link key="n" href={`/platform-admin/deliveries/${n.id}`}>{n.id.slice(0, 12)}…</Link>, n.status.toLowerCase(), formatCents(n.quoteFeeCents)])}
            empty="No Skhokholetha delivery."
          />
        </Section>
      )}
    </>
  );
}
