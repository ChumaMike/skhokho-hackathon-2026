import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { can } from "@/modules/platform-admin/permissions";
import { prisma } from "@/lib/prisma/client";
import { formatCents } from "@/lib/utils";
import { NOT_YET_COLLECTED, TERMINAL_STATUSES } from "@/modules/skhokholetha/state-machine";
import { Badge, Banner, KV, PageHeader, ReasonField, Section, Table, when } from "../../ui";
import { interveneDeliveryAction } from "../../drivers/actions";

export const dynamic = "force-dynamic";

/**
 * Lifecycle reconstruction of one network delivery: who, money, every
 * timestamp, every offer, every event (incl. code checks — counts only),
 * the earning, the shop's notifications and the admin audit trail.
 * Never selected: code nonces, tracking token hash, customer key.
 */
export default async function DeliveryDetailPage({ params, searchParams }: { params: Promise<{ deliveryId: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await adminPage("deliveries.view");
  const { deliveryId } = await params;
  const sp = await searchParams;
  const d = await prisma.networkDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      status: true,
      requestedByStaffId: true,
      distanceMeters: true,
      quoteFeeCents: true,
      platformFeeCents: true,
      driverEarningCents: true,
      pricingSnapshot: true,
      pickupCodeFailures: true,
      dropoffCodeFailures: true,
      createdAt: true,
      searchingAt: true,
      assignedAt: true,
      arrivedPickupAt: true,
      pickedUpAt: true,
      arrivedDropoffAt: true,
      deliveredAt: true,
      endedAt: true,
      endReason: true,
      business: { select: { id: true, name: true } },
      driver: { select: { id: true, displayName: true } },
      orderDelivery: { select: { deliveryAddressSnapshot: true, order: { select: { id: true, orderNumber: true } } } },
      offers: { orderBy: { createdAt: "asc" }, select: { id: true, status: true, distanceMeters: true, createdAt: true, respondedAt: true, expiresAt: true, driver: { select: { id: true, displayName: true } } } },
      events: { orderBy: { createdAt: "asc" }, select: { id: true, type: true, fromStatus: true, toStatus: true, actorType: true, createdAt: true } },
      ledger: { select: { id: true, type: true, status: true, amountCents: true, createdAt: true } },
    },
  });
  if (!d) notFound();
  const orderId = d.orderDelivery.order.id;
  const [notifications, audit] = await Promise.all([
    prisma.businessNotification.findMany({
      where: { businessId: d.business.id, type: "SKHOKHOLETHA", data: { path: ["orderId"], equals: orderId } as Prisma.JsonNullableFilter<"BusinessNotification"> },
      orderBy: { createdAt: "asc" },
      take: 30,
      select: { title: true, createdAt: true, isRead: true },
    }),
    prisma.platformAuditEvent.findMany({ where: { resourceType: "network_delivery", resourceId: d.id }, orderBy: { createdAt: "asc" }, select: { action: true, outcome: true, actorType: true, reason: true, createdAt: true } }),
  ]);
  const live = !(TERMINAL_STATUSES as readonly string[]).includes(d.status) && d.status !== "DISPUTED";
  const canAct = can(admin.role, "deliveries.intervene");
  const showAddress = can(admin.role, "orders.customerDetails");

  return (
    <>
      <PageHeader title={`Delivery ${d.id.slice(0, 12)}…`} sub={`${d.business.name} · order ${d.orderDelivery.order.orderNumber}`} />
      <Banner ok={sp.ok} err={sp.err} />

      <Section title="Summary">
        <KV
          items={[
            ["Status", <Badge key="s" tone={d.status === "DELIVERED" ? "ok" : live ? "warn" : "bad"}>{d.status.toLowerCase().replace(/_/g, " ")}</Badge>],
            ["Shop", <Link key="b" href={`/platform-admin/businesses/${d.business.id}`}>{d.business.name}</Link>],
            ["Order", <Link key="o" href={`/platform-admin/orders/${orderId}`}>{d.orderDelivery.order.orderNumber}</Link>],
            ["Driver", d.driver ? <Link key="r" href={`/platform-admin/drivers/${d.driver.id}`}>{d.driver.displayName}</Link> : "not assigned"],
            ["Requested by (staff/owner id)", d.requestedByStaffId ?? "—"],
            ["Drop-off address", showAddress ? d.orderDelivery.deliveryAddressSnapshot : "hidden for your role"],
            ["Pricing", `${formatCents(d.quoteFeeCents)} = driver ${formatCents(d.driverEarningCents)} + platform ${formatCents(d.platformFeeCents)} · ${(d.distanceMeters / 1000).toFixed(1)} km`],
            ["Pricing snapshot", <code key="p" style={{ fontSize: "0.8rem" }}>{JSON.stringify(d.pricingSnapshot)}</code>],
            ["Pickup verification", d.pickedUpAt ? `verified ${when(d.pickedUpAt)}` : "not yet"],
            ["Delivery verification", d.deliveredAt ? `verified with the customer's code ${when(d.deliveredAt)}` : "not yet"],
            ["Wrong code attempts", `pickup ${d.pickupCodeFailures} · drop-off ${d.dropoffCodeFailures}`],
            ["Ended", d.endedAt ? `${when(d.endedAt)}${d.endReason ? ` — ${d.endReason}` : ""}` : "—"],
          ]}
        />
      </Section>

      <Section title="Timeline">
        <Table
          head={["Step", "At"]}
          rows={(
            [
              ["Requested", d.createdAt],
              ["Searching", d.searchingAt],
              ["Assigned", d.assignedAt],
              ["At pickup", d.arrivedPickupAt],
              ["Collected", d.pickedUpAt],
              ["At drop-off", d.arrivedDropoffAt],
              ["Delivered", d.deliveredAt],
            ] as const
          )
            .filter(([, at]) => at)
            .map(([step, at]) => [step, when(at)])}
        />
      </Section>

      <Section title={`Offers (${d.offers.length})`}>
        <Table head={["Driver", "Status", "To pickup", "Offered", "Responded", "Expires"]} rows={d.offers.map((o) => [o.driver.displayName, o.status.toLowerCase(), `${(o.distanceMeters / 1000).toFixed(1)} km`, when(o.createdAt), when(o.respondedAt), when(o.expiresAt)])} empty="No offers." />
      </Section>

      <Section title={`Events (${d.events.length})`}>
        <Table head={["When", "Event", "From → to", "By"]} rows={d.events.map((e) => [when(e.createdAt), e.type, e.fromStatus ? `${e.fromStatus.toLowerCase()} → ${e.toStatus?.toLowerCase()}` : "", e.actorType.toLowerCase()])} />
      </Section>

      <Section title="Earning (ledger)">
        <Table head={["Type", "Status", "Amount", "Created"]} rows={d.ledger.map((l) => [l.type.toLowerCase(), l.status.toLowerCase(), formatCents(l.amountCents), when(l.createdAt)])} empty="No earning recorded (only a completed delivery earns, exactly once)." />
      </Section>

      <Section title="Shop notifications">
        <Table head={["When", "Title", "Read"]} rows={notifications.map((n) => [when(n.createdAt), n.title, n.isRead ? "yes" : "no"])} empty="None." />
      </Section>

      <Section title="Admin & security events">
        <Table head={["When", "Action", "Outcome", "By", "Reason"]} rows={audit.map((a) => [when(a.createdAt), a.action, a.outcome.toLowerCase(), a.actorType, a.reason ?? ""])} empty="None." />
      </Section>

      {canAct && live && (
        <Section title="Intervene">
          <div style={{ display: "grid", gap: 10 }}>
            {(NOT_YET_COLLECTED as readonly string[]).includes(d.status) && (
              <form action={interveneDeliveryAction.bind(null, d.id, "CANCEL")} style={{ display: "flex", gap: 8 }}>
                <ReasonField placeholder="Reason to cancel (the shop sees this)" />
                <button type="submit" className="btn">Cancel delivery</button>
              </form>
            )}
            <form action={interveneDeliveryAction.bind(null, d.id, "DISPUTE")} style={{ display: "flex", gap: 8 }}>
              <ReasonField placeholder="What needs investigating" />
              <button type="submit" className="btn">Open dispute</button>
            </form>
          </div>
        </Section>
      )}
    </>
  );
}
