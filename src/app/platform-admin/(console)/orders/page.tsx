import Link from "next/link";
import { OrderStatus, type PaymentStatus } from "@prisma/client";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { prisma } from "@/lib/prisma/client";
import { formatZAR } from "@/lib/utils";
import { ATTENTION_KINDS, listOrdersNeedingAttention, orderAttentionCounts, type AttentionKind } from "@/modules/platform-admin/order-attention";
import { Badge, Filters, PageHeader, Section, Table, when } from "../ui";

export const dynamic = "force-dynamic";

const PAY = ["ALL", "PAID", "PENDING", "FAILED", "REFUNDED"] as const;

const KINDS = ATTENTION_KINDS.map((k) => k.kind) as string[];

/** Orders across businesses — no customer details in the list. `view=attention` lists the potentially stuck ones. */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ pay?: string; business?: string; status?: string; view?: string }> }) {
  await adminPage("orders.view");
  const sp = await searchParams;
  const pay = (PAY as readonly string[]).includes(sp.pay ?? "") ? (sp.pay as (typeof PAY)[number]) : "ALL";
  const business = /^[0-9a-f-]{36}$/i.test(sp.business ?? "") ? sp.business : undefined;
  const view = sp.view === "attention" || KINDS.includes(sp.view ?? "") ? sp.view! : undefined;

  if (view) {
    const now = new Date();
    const counts = await orderAttentionCounts(now, business);
    const kinds = view === "attention" ? ATTENTION_KINDS.filter((k) => counts[k.kind] > 0) : ATTENTION_KINDS.filter((k) => k.kind === view);
    const lists = await Promise.all(kinds.map((k) => listOrdersNeedingAttention(k.kind as AttentionKind, { now, businessId: business, take: 50 })));
    return (
      <>
        <PageHeader title="Orders needing attention" sub="Surfaced for a human to look at — nothing here changes an order. Thresholds: src/modules/platform-admin/order-attention.ts." />
        <Filters
          base="/platform-admin/orders"
          param="view"
          current={view}
          keep={{ business }}
          options={[{ value: "attention", label: `All (${counts.total})` }, ...ATTENTION_KINDS.map((k) => ({ value: k.kind, label: `${k.label} (${counts[k.kind]})` }))]}
        />
        {kinds.length === 0 && <Section title="Nothing needs attention"><p>No order matches any of the situations right now.</p></Section>}
        {kinds.map((k, i) => (
          <Section key={k.kind} title={`${k.label} — ${k.why}`}>
            <Table
              head={["Order", "Business", "Status", "Payment", "Total", "Fulfilment", "Placed", "Last change"]}
              rows={lists[i].map((o) => [
                <Link key="o" href={`/platform-admin/orders/${o.id}`}>{o.orderNumber}</Link>,
                <Link key="b" href={`/platform-admin/businesses/${o.business.id}`}>{o.business.name}</Link>,
                o.status.toLowerCase(),
                <Badge key="p" tone={o.paymentStatus === "PAID" ? "ok" : o.paymentStatus === "FAILED" ? "bad" : "warn"}>{o.paymentStatus.toLowerCase()}</Badge>,
                formatZAR(o.total),
                o.fulfilmentMethod.toLowerCase(),
                when(o.createdAt),
                when(o.updatedAt),
              ])}
              empty="None."
            />
          </Section>
        ))}
        <p style={{ marginTop: 8 }}><Link href={`/platform-admin/orders${business ? `?business=${business}` : ""}`}>All orders →</Link></p>
      </>
    );
  }

  const orders = await prisma.order.findMany({
    where: { ...(pay === "ALL" ? {} : { paymentStatus: pay as PaymentStatus }), ...(business ? { businessId: business } : {}), ...(sp.status && (Object.values(OrderStatus) as string[]).includes(sp.status) ? { status: sp.status as OrderStatus } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, orderNumber: true, status: true, paymentStatus: true, paymentMethod: true, total: true, fulfilmentMethod: true, createdAt: true, business: { select: { id: true, name: true } } },
  });

  return (
    <>
      <PageHeader title="Orders" sub={business ? "One business. Newest first, 50 at a time." : "All businesses. Newest first, 50 at a time."} />
      <Filters base="/platform-admin/orders" param="pay" current={pay} keep={{ business }} options={PAY.map((p) => ({ value: p, label: p === "ALL" ? "All payments" : p.toLowerCase() }))} />
      <p style={{ marginTop: -4, marginBottom: 12 }}>
        <Link href={`/platform-admin/orders?view=attention${business ? `&business=${business}` : ""}`}>Orders needing attention →</Link>
      </p>
      <Section title={`${orders.length} shown`}>
        <Table
          head={["Order", "Business", "Status", "Payment", "Method", "Total", "Fulfilment", "Placed"]}
          rows={orders.map((o) => [
            <Link key="o" href={`/platform-admin/orders/${o.id}`}>{o.orderNumber}</Link>,
            <Link key="b" href={`/platform-admin/businesses/${o.business.id}`}>{o.business.name}</Link>,
            o.status.toLowerCase(),
            <Badge key="p" tone={o.paymentStatus === "PAID" ? "ok" : o.paymentStatus === "FAILED" ? "bad" : "warn"}>{o.paymentStatus.toLowerCase()}</Badge>,
            o.paymentMethod?.toLowerCase() ?? "—",
            formatZAR(o.total),
            o.fulfilmentMethod.toLowerCase(),
            when(o.createdAt),
          ])}
        />
      </Section>
    </>
  );
}
