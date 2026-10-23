import Link from "next/link";
import type { PaymentAttemptStatus } from "@prisma/client";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { prisma } from "@/lib/prisma/client";
import { formatZAR } from "@/lib/utils";
import { Badge, Filters, PageHeader, Section, Stats, Table, when } from "../ui";

export const dynamic = "force-dynamic";

const STATUSES = ["ALL", "CREATED", "SUBMITTED", "COMPLETE", "FAILED", "CANCELLED", "EXPIRED", "REFUND_DUE"] as const;
const tone = (s: string) => (s === "COMPLETE" ? "ok" : s === "REFUND_DUE" || s === "FAILED" ? "bad" : "warn");

/** Customer payment attempts — read-only. Amounts can't be edited anywhere in the admin. */
export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string; business?: string }> }) {
  await adminPage("payments.view");
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof STATUSES)[number]) : "ALL";
  const business = /^[0-9a-f-]{36}$/i.test(sp.business ?? "") ? sp.business : undefined;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [attempts, duplicates24h, byStatus, refundsOwed] = await Promise.all([
    prisma.businessPaymentAttempt.findMany({
      where: { ...(status === "ALL" ? {} : { status: status as PaymentAttemptStatus }), ...(business ? { businessId: business } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, reference: true, status: true, environment: true, expectedAmount: true, providerPaymentId: true, createdAt: true, business: { select: { id: true, name: true } }, order: { select: { id: true, orderNumber: true } } },
    }),
    prisma.businessPaymentEvent.count({ where: { outcome: "DUPLICATE_NOTIFICATION", receivedAt: { gte: since } } }),
    prisma.businessPaymentAttempt.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.businessPaymentAttempt.count({ where: { status: "REFUND_DUE", refundResolution: null } }),
  ]);
  const c = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));

  return (
    <>
      <PageHeader title="Payments" sub="Business → order → payment attempt → provider. Read-only." />
      <Stats
        items={[
          { label: "Pending (24h)", value: (c.CREATED ?? 0) + (c.SUBMITTED ?? 0) },
          { label: "Successful (24h)", value: c.COMPLETE ?? 0, tone: "ok" },
          { label: "Failed / cancelled / expired (24h)", value: (c.FAILED ?? 0) + (c.CANCELLED ?? 0) + (c.EXPIRED ?? 0) },
          { label: "Refunds still owed (all time)", value: refundsOwed, tone: refundsOwed ? "bad" : undefined },
          { label: "Duplicate notifications absorbed (24h)", value: duplicates24h },
        ]}
      />
      <Filters base="/platform-admin/payments" param="status" current={status} keep={{ business }} options={STATUSES.map((s) => ({ value: s, label: s === "ALL" ? "All" : s.replace("_", " ").toLowerCase() }))} />
      <Section title={`${attempts.length} shown`}>
        <Table
          head={["Reference", "Status", "Business", "Order", "Env", "Amount", "Provider id", "Created"]}
          rows={attempts.map((a) => [
            <Link key="r" href={`/platform-admin/payments/${a.id}`}>{a.reference}</Link>,
            <Badge key="s" tone={tone(a.status)}>{a.status.toLowerCase()}</Badge>,
            <Link key="b" href={`/platform-admin/businesses/${a.business.id}`}>{a.business.name}</Link>,
            a.order ? <Link key="o" href={`/platform-admin/orders/${a.order.id}`}>{a.order.orderNumber}</Link> : "—",
            a.environment.toLowerCase(),
            formatZAR(a.expectedAmount),
            a.providerPaymentId ?? "—",
            when(a.createdAt),
          ])}
        />
      </Section>
    </>
  );
}
