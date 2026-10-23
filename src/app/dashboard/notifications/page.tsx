import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../session";
import { listRecentNotificationsFor } from "@/modules/dashboard/notifications";
import DashboardNav from "@/components/DashboardNav";
import ActionButton from "@/components/ActionButton";
import { markAllReadAction, markReadAction } from "./actions";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  new_order: "New order",
  payment_received: "Payment received",
  order_cancelled: "Order cancelled",
  delivery_assigned: "Driver assigned",
  delivery_failed: "Delivery problem",
  SKHOKHOLETHA: "Skhokholetha",
  PAYMENT_REFUND_DUE: "Refund due",
  PAYMENT_UNCONFIRMED: "Payment unconfirmed",
  new_appointment: "New booking",
  low_stock: "Low stock",
  new_review: "New review",
};

function when(d: Date) {
  return d.toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Every notification for this business, with YOUR read state (a teammate reading one doesn't hide it from you). */
export default async function NotificationsPage() {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const items = await listRecentNotificationsFor(session.tenantId, session.staffId, { limit: 100 });
  const unread = items.filter((i) => !i.isRead).length;
  const canSeeOrders = workspaceContext.isOwner || workspaceContext.permissions.canManageOrders;

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1>Notifications{unread > 0 ? ` (${unread} new)` : ""}</h1>
        <DashboardNav current="home" {...workspaceContext} />
        {unread > 0 && (
          <ActionButton action={markAllReadAction} className="btn" pendingLabel="Marking…">
            Mark all as read
          </ActionButton>
        )}
        {items.length === 0 ? (
          <div className="card"><p>Nothing yet — new orders, payments and delivery updates will show up here.</p></div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8, marginTop: 12 }}>
            {items.map((n) => (
              <li key={n.id} className="card" style={{ padding: 12, borderLeft: n.isRead ? undefined : "4px solid var(--amber)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <strong>{LABELS[n.type] ?? n.title}</strong>
                  <span style={{ opacity: 0.7, fontSize: "0.85rem" }}>{when(n.createdAt)}</span>
                </div>
                <p style={{ margin: "4px 0 8px" }}>{n.title !== (LABELS[n.type] ?? n.title) ? `${n.title} — ` : ""}{n.message}</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {n.orderId && canSeeOrders && <Link href={`/dashboard/orders?order=${n.orderId}`} className="btn" style={{ minHeight: 40 }}>Open order</Link>}
                  {n.type === "PAYMENT_REFUND_DUE" && (workspaceContext.isOwner || workspaceContext.permissions.canManageBilling) && (
                    <Link href="/dashboard/settings/payments#refunds" className="btn" style={{ minHeight: 40 }}>Refunds to make</Link>
                  )}
                  {!n.isRead && (
                    <ActionButton action={markReadAction.bind(null, n.id)} className="btn" pendingLabel="…">
                      Mark read
                    </ActionButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
