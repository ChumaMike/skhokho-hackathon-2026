import Link from "next/link";
import type { NetworkDeliveryStatus, Prisma } from "@prisma/client";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { prisma } from "@/lib/prisma/client";
import { formatCents } from "@/lib/utils";
import { LATE_OPEN_MS } from "@/modules/platform-admin/metrics";
import { Badge, Filters, PageHeader, Section, Table, when } from "../ui";

export const dynamic = "force-dynamic";

const OPEN: NetworkDeliveryStatus[] = ["CREATED", "SEARCHING", "OFFERED", "ASSIGNED", "DRIVER_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "IN_TRANSIT", "ARRIVED_DROPOFF", "RETURNING"];
const VIEWS: Record<string, { label: string; where: (now: Date) => Prisma.NetworkDeliveryWhereInput }> = {
  active: { label: "Active", where: () => ({ status: { in: OPEN } }) },
  searching: { label: "Looking for a driver", where: () => ({ status: { in: ["CREATED", "SEARCHING", "OFFERED"] } }) },
  enroute: { label: "With a driver", where: () => ({ status: { in: ["ASSIGNED", "DRIVER_TO_PICKUP", "ARRIVED_PICKUP", "PICKED_UP", "IN_TRANSIT", "ARRIVED_DROPOFF"] } }) },
  late: { label: "Late (>90 min)", where: (now) => ({ status: { in: OPEN }, createdAt: { lt: new Date(now.getTime() - LATE_OPEN_MS) } }) },
  failed: { label: "Failed / returning", where: () => ({ status: { in: ["FAILED", "RETURNING", "RETURNED"] } }) },
  disputed: { label: "Disputed", where: () => ({ status: "DISPUTED" }) },
  delivered: { label: "Delivered", where: () => ({ status: "DELIVERED" }) },
  cancelled: { label: "Cancelled", where: () => ({ status: "CANCELLED" }) },
};

/** Skhokholetha deliveries by state. No addresses or codes in the list. */
export default async function DeliveriesAdminPage({ searchParams }: { searchParams: Promise<{ view?: string; business?: string }> }) {
  await adminPage("deliveries.view");
  const sp = await searchParams;
  const view = sp.view && VIEWS[sp.view] ? sp.view : "active";
  const business = /^[0-9a-f-]{36}$/i.test(sp.business ?? "") ? sp.business : undefined;
  const now = new Date();
  const rows = await prisma.networkDelivery.findMany({
    where: { ...VIEWS[view].where(now), ...(business ? { businessId: business } : {}) },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, status: true, quoteFeeCents: true, createdAt: true, assignedAt: true, business: { select: { id: true, name: true } }, driver: { select: { id: true, displayName: true } }, orderDelivery: { select: { order: { select: { id: true, orderNumber: true } } } } },
  });

  return (
    <>
      <PageHeader title="Deliveries" sub="Skhokholetha. Interventions are explicit commands on a delivery's page — there is no status editor." />
      <Filters base="/platform-admin/deliveries" param="view" current={view} keep={{ business }} options={Object.entries(VIEWS).map(([k, v]) => ({ value: k, label: v.label }))} />
      <Section title={`${rows.length} shown`}>
        <Table
          head={["Delivery", "Status", "Shop", "Order", "Driver", "Fee", "Created", "Assigned"]}
          rows={rows.map((d) => [
            <Link key="d" href={`/platform-admin/deliveries/${d.id}`}>{d.id.slice(0, 12)}…</Link>,
            <Badge key="s" tone={d.status === "DELIVERED" ? "ok" : ["FAILED", "DISPUTED", "RETURNING", "RETURNED"].includes(d.status) ? "bad" : "warn"}>{d.status.toLowerCase().replace(/_/g, " ")}</Badge>,
            <Link key="b" href={`/platform-admin/businesses/${d.business.id}`}>{d.business.name}</Link>,
            <Link key="o" href={`/platform-admin/orders/${d.orderDelivery.order.id}`}>{d.orderDelivery.order.orderNumber}</Link>,
            d.driver ? <Link key="r" href={`/platform-admin/drivers/${d.driver.id}`}>{d.driver.displayName}</Link> : "—",
            formatCents(d.quoteFeeCents),
            when(d.createdAt),
            when(d.assignedAt),
          ])}
        />
      </Section>
    </>
  );
}
