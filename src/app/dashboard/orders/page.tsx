import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { listOrders } from "@/modules/orders/order.service";
import { listUnreviewedCompletedOrders } from "@/modules/reviews/review.service";
import { formatZAR } from "@/lib/utils";
import DashboardNav from "@/components/DashboardNav";
import { ConnectedOrders } from "@/components/connected-ui";
import type { OrderRow as ConnectedOrderRow, Tone } from "@/components/connected-ui";
import ActionButton from "@/components/ActionButton";
import CopyLinkButton from "@/components/CopyLinkButton";
import { advanceOrderStatusAction, cancelOrderAction, acceptOrderAction, markOrderComplete, recordPaymentAction } from "./actions";
import { ACCEPT_ETA_MINUTES, ORDER_CANCELLATION_REASONS, getOrderEta, formatEtaTime, getOrderCancellation } from "@/modules/orders/order.service";
import { prisma } from "@/lib/prisma/client";
import { getTradingStatus } from "@/modules/tenant/trading-status";
import { formatSAPhone, whatsappLink } from "@/lib/utils";
import PauseOrdersControl from "../settings/hours/PauseOrdersControl";
import styles from "./orders.module.css";

export const dynamic = "force-dynamic";

// Fulfillment progress, not payment status (that's a separate field) — same
// "New -> Preparing -> Ready -> Complete" language as the order-pipeline
// visual planned for the dashboard, so this is the vocabulary to keep
// consistent with later, not a one-off relabeling.
const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: "New",
  CONFIRMED: "Confirmed",
  PROCESSING: "Preparing",
  READY: "Ready",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

// The label for the button that advances an order OUT of this status —
// e.g. a PENDING order's next step is "Confirm order", moving it to
// CONFIRMED. READY has no entry here because its next step is the terminal
// markOrderComplete action, not advanceOrderStatusAction.
const ADVANCE_BUTTON_LABELS: Record<string, string> = {
  PENDING: "Confirm order",
  CONFIRMED: "Start preparing",
  PROCESSING: "Mark ready",
};

// The status-tab filter row — order matters (reading left to right follows
// the pipeline), and "All" always comes first.
const STATUS_TABS: { key: string; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "PENDING", label: "New" },
  { key: "CONFIRMED", label: "Confirmed" },
  { key: "PROCESSING", label: "Preparing" },
  { key: "READY", label: "Ready" },
  { key: "COMPLETED", label: "Completed" },
  { key: "CANCELLED", label: "Cancelled" },
];

/*
 * Fulfilment status -> the Connected UI's chip vocabulary.
 *
 * CANCELLED maps to `neutral`, not `warning`. It is a terminal, already-dealt-
 * with state; painting every cancelled order in alarm colours would train
 * staff to ignore the colour that actually means "something needs you".
 * PENDING and CONFIRMED share `new` — the labels already tell them apart, and
 * both mean the same thing to the person working the queue: not started.
 */
const ORDER_TONES: Record<string, Tone> = {
  PENDING: "new",
  CONFIRMED: "new",
  PROCESSING: "preparing",
  READY: "ready",
  COMPLETED: "complete",
  CANCELLED: "neutral",
};

function formatTime(date: Date): string {
  return date.toLocaleString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

const PAYMENT_LABELS: Record<string, string> = { PENDING: "Not paid yet", PAID: "Paid", PARTIAL: "Partly paid", REFUNDED: "Refunded", FAILED: "Payment failed" };
const DELIVERY_LABELS: Record<string, string> = { UNASSIGNED: "Needs a driver", ASSIGNED: "Driver assigned", PICKED_UP: "Out for delivery", DELIVERED: "Delivered", FAILED: "Delivery failed" };
const NETWORK_LABELS: Record<string, string> = {
  CREATED: "Skhokholetha: requested", SEARCHING: "Skhokholetha: finding a driver", OFFERED: "Skhokholetha: offered to drivers", ASSIGNED: "Skhokholetha: driver assigned",
  DRIVER_TO_PICKUP: "Skhokholetha: driver on the way to you", ARRIVED_PICKUP: "Skhokholetha: driver at your shop", PICKED_UP: "Skhokholetha: collected", IN_TRANSIT: "Skhokholetha: on the way to the customer",
  ARRIVED_DROPOFF: "Skhokholetha: at the customer", DELIVERED: "Skhokholetha: delivered", CANCELLED: "Skhokholetha: cancelled", FAILED: "Skhokholetha: failed", RETURNING: "Skhokholetha: returning", RETURNED: "Skhokholetha: returned", DISPUTED: "Skhokholetha: under review",
};

/**
 * What the person working the queue needs, shaped by permission: everyone with
 * canManageOrders sees items, notes, payment and delivery STATE; the customer's
 * phone and address appear only for staff who can act on them (manage orders
 * or deliveries). Nothing here ever shows the customer's drop-off code.
 */
function OrderDetail({ order, showContact }: { order: OrderRow; showContact: boolean }) {
  const d = order.delivery;
  const network = d?.networkDeliveries[0];
  const phone = d?.contactPhone ?? null;
  const wa = phone ? whatsappLink(phone) : null;
  return (
    <div style={{ display: "grid", gap: 6, fontSize: "0.92rem", marginTop: 8 }}>
      <div><strong>Payment:</strong> {PAYMENT_LABELS[order.paymentStatus] ?? order.paymentStatus}{order.paymentMethod ? ` · ${order.paymentMethod.toLowerCase()}` : ""}</div>
      <div><strong>Placed:</strong> {order.createdAt.toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</div>
      {order.notes && <div><strong>Note:</strong> {order.notes}</div>}
      {(() => {
        const eta = getOrderEta(order.metadata);
        const cancellation = getOrderCancellation(order.metadata);
        return (
          <>
            {eta && order.status !== "CANCELLED" && <div><strong>Promised:</strong> about {formatEtaTime(eta.readyAt)} ({eta.minutes} min)</div>}
            {cancellation && <div><strong>Cancelled:</strong> {ORDER_CANCELLATION_REASONS[cancellation.reason].label}{cancellation.detail ? ` — ${cancellation.detail}` : ""}</div>}
          </>
        );
      })()}
      {order.fulfilmentMethod === "DELIVERY" && d && (
        <>
          <div><strong>Delivery:</strong> {network ? NETWORK_LABELS[network.status] ?? network.status : DELIVERY_LABELS[d.status] ?? d.status}{d.deliveryZoneName ? ` · ${d.deliveryZoneName}` : ""}</div>
          {d.driverStaff && <div><strong>Driver:</strong> {d.driverStaff.firstName} {d.driverStaff.lastName}</div>}
          {network?.driver && <div><strong>Driver:</strong> {network.driver.displayName} (Skhokholetha)</div>}
          {d.failureReason && <div className="errorBanner">{d.failureReason}</div>}
          {showContact && <div><strong>Address:</strong> {d.deliveryAddressSnapshot}</div>}
          {showContact && d.deliveryInstructions && <div><strong>Instructions:</strong> {d.deliveryInstructions}</div>}
        </>
      )}
      {showContact && phone && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <strong>Customer:</strong> {formatSAPhone(phone)}
          <a className="btn" href={`tel:${phone}`} style={{ minHeight: 40 }}>Call</a>
          {wa && <a className="btn" href={wa} target="_blank" rel="noopener noreferrer" style={{ minHeight: 40 }}>WhatsApp</a>}
        </div>
      )}
    </div>
  );
}

type OrderRow = Awaited<ReturnType<typeof listOrders>>["orders"][number];

function OrderActions({ order, block }: { order: OrderRow; block?: boolean }) {
  const advanceLabel = ADVANCE_BUTTON_LABELS[order.status];
  const cancellable = ["PENDING", "CONFIRMED", "PROCESSING", "READY"].includes(order.status);
  const cls = block ? styles.detailActions : styles.footer;

  // Completing an order no longer marks it paid — handing something over and
  // being paid for it are different facts, and an online order can be handed
  // over while its gateway notification is still in flight. So taking the
  // money needs its own button, or a pay-on-collection order would be
  // completed and then sit unpaid for ever with no way to correct it.
  const awaitingPayment = order.paymentStatus === "PENDING" && order.status !== "CANCELLED";

  if (!advanceLabel && order.status !== "READY" && !cancellable && !awaitingPayment) return null;

  return (
    <div className={cls}>
      {order.status === "PENDING" && (
        // Accept WITH a time the customer will be told — alongside the plain
        // Confirm below, which promises nothing.
        <form action={acceptOrderAction.bind(null, order.id)} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <select name="etaMinutes" className="input" defaultValue="20" aria-label="Ready in about" style={{ minHeight: 40, width: "auto" }}>
            {ACCEPT_ETA_MINUTES.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
          <button type="submit" className={styles.completeBtn}>
            Accept with ETA
          </button>
        </form>
      )}
      {advanceLabel && (
        <ActionButton action={advanceOrderStatusAction.bind(null, order.id)} className={styles.completeBtn} pendingLabel="Updating…">
          {advanceLabel}
        </ActionButton>
      )}
      {order.status === "READY" && (
        <ActionButton action={markOrderComplete.bind(null, order.id)} className={styles.completeBtn} pendingLabel="Completing…">
          Mark complete
        </ActionButton>
      )}
      {awaitingPayment && (
        <ActionButton
          action={recordPaymentAction.bind(null, order.id, "CASH")}
          className={styles.completeBtn}
          pendingLabel="Recording…"
        >
          Mark paid (cash)
        </ActionButton>
      )}
      {cancellable && (
        <form action={cancelOrderAction.bind(null, order.id)} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <select name="reason" className="input" required defaultValue="" aria-label="Reason for cancelling" style={{ minHeight: 40, width: "auto" }}>
            <option value="" disabled>
              Why cancel?
            </option>
            {Object.entries(ORDER_CANCELLATION_REASONS).map(([key, r]) => (
              <option key={key} value={key}>
                {r.label}
              </option>
            ))}
          </select>
          <input className="input" name="detail" maxLength={200} placeholder="Detail (needed for Other)" aria-label="Cancellation detail" style={{ minHeight: 40, width: "auto" }} />
          <button type="submit" className={styles.cancelBtn}>
            Cancel order
          </button>
        </form>
      )}
    </div>
  );
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; order?: string; saved?: string; err?: string }>;
}) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;
  const activeTab = STATUS_TABS.some((t) => t.key === sp.status) ? (sp.status as string) : "ALL";

  // Checked before any order data is fetched — a Kitchen worker (or anyone
  // else without canManageOrders) gets a denial banner, not a fetch-then-
  // hide. Kitchen has its own privacy-shaped view at /dashboard/kitchen
  // instead of this full management page.
  let permitted = true;
  try {
    await requireStaffPermission("canManageOrders");
  } catch {
    permitted = false;
  }

  if (!permitted) {
    return (
      <main className="shell">
        <div className="column">
          <span className="eyebrow">Skhokho</span>
          <h1 className={styles.title}>Orders</h1>
          <DashboardNav current="orders" {...workspaceContext} />
          <div className={`card ${styles.empty}`}>
            <p>Your role doesn&apos;t have permission to view orders — ask the business owner.</p>
          </div>
        </div>
      </main>
    );
  }

  const [{ orders: allOrders }, unreviewed, bizForTrading] = await Promise.all([
    listOrders(session.tenantId, { perPage: 50 }),
    listUnreviewedCompletedOrders(session.tenantId),
    prisma.business.findUniqueOrThrow({ where: { id: session.tenantId }, select: { settings: true, operatingHours: true } }),
  ]);
  const trading = getTradingStatus(bizForTrading);
  const showContact = workspaceContext.isOwner || workspaceContext.permissions.canManageOrders || workspaceContext.permissions.canManageDeliveries;

  const counts: Record<string, number> = { ALL: allOrders.length };
  for (const tab of STATUS_TABS) {
    if (tab.key === "ALL") continue;
    counts[tab.key] = allOrders.filter((o) => o.status === tab.key).length;
  }

  const orders = activeTab === "ALL" ? allOrders : allOrders.filter((o) => o.status === activeTab);
  const selectedOrder = orders.find((o) => o.id === sp.order) ?? orders[0] ?? null;

  // Normalised purely for presentation. Every authorization decision already
  // happened above (requireStaffPermission before the fetch); nothing below
  // decides what a viewer may see or do.
  const connectedRows: ConnectedOrderRow[] = orders.map((order) => ({
    id: order.id,
    number: order.orderNumber,
    customer: order.membership?.displayName ?? "Guest",
    fulfilment: order.fulfilmentMethod === "DELIVERY" ? "Delivery" : "Collection",
    total: formatZAR(order.total.toString()),
    statusLabel: ORDER_STATUS_LABELS[order.status] ?? order.status,
    tone: ORDER_TONES[order.status] ?? "neutral",
    placedAt: formatTime(order.createdAt),
    items: order.items.map((item) => ({
      label: item.name,
      quantity: item.quantity,
      priceLabel: formatZAR(item.total.toString()),
    })),
  }));

  const hrefForOrder = (id: string) =>
    `/dashboard/orders?${activeTab === "ALL" ? "" : `status=${activeTab}&`}order=${id}`;

  return (
    <div className="shell">
      <div className="consoleChrome">
        <DashboardNav current="orders" {...workspaceContext} />
      </div>

      <div className="consoleCanvas">
        <ConnectedOrders
          orders={connectedRows}
          selectedId={selectedOrder?.id}
          hrefForOrder={hrefForOrder}
          emptyMessage={
            activeTab === "ALL"
              ? "No orders yet. Orders placed from your storefront will show up here."
              : `No ${ORDER_STATUS_LABELS[activeTab]?.toLowerCase() ?? "matching"} orders right now.`
          }
          // The queue's own transitions, so staff can advance or cancel without
          // selecting a row first — the most repeated action in a busy shop.
          // These are the same authorized server actions as the detail panel.
          rowActions={(row) => {
            const order = orders.find((o) => o.id === row.id);
            return order ? <OrderActions order={order} /> : null;
          }}
          actions={
            selectedOrder ? (
              <>
                <OrderDetail order={selectedOrder} showContact={showContact} />
                <OrderActions order={selectedOrder} block />
              </>
            ) : undefined
          }
          toolbar={
            <>
            {(sp.saved || sp.err) && <div className={sp.err ? "errorBanner" : "successBanner"}>{sp.err ?? "Saved."}</div>}
            <div style={{ marginBottom: 10 }}>
              <PauseOrdersControl trading={trading} returnTo="/dashboard/orders" />
            </div>
            <div className={styles.tabs}>
              {STATUS_TABS.map((tab) => (
                <Link
                  key={tab.key}
                  href={tab.key === "ALL" ? "/dashboard/orders" : `/dashboard/orders?status=${tab.key}`}
                  className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ""}`}
                >
                  {tab.label}
                  <span className={styles.tabCount}>{counts[tab.key] ?? 0}</span>
                </Link>
              ))}
            </div>
            </>
          }
        >
          {unreviewed.length > 0 && (
            <section className={styles.reviewSection}>
              <h2 className={styles.sectionTitle}>Ask for a review</h2>
              <p className={styles.sectionHint}>
                Share this link with the customer — WhatsApp is fine — so they can rate their order.
              </p>
              <ul className={styles.reviewList}>
                {unreviewed.map((order) => (
                  <li key={order.id} className={`card ${styles.reviewItem}`}>
                    <span className={styles.orderNumber}>{order.orderNumber}</span>
                    <CopyLinkButton path={`/review/order/${order.id}`} className={styles.completeBtn} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </ConnectedOrders>
      </div>
    </div>
  );
}
