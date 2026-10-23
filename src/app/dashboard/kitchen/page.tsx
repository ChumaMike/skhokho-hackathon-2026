import { requireOwnerSession, getStaffWorkspaceContext } from "../session";
import { listKitchenOrders } from "@/modules/orders/order.service";
import DashboardNav from "@/components/DashboardNav";
import { ConnectedKitchen } from "@/components/connected-ui";
import type { KitchenTicket } from "@/components/connected-ui";
import ActionButton from "@/components/ActionButton";
import { advanceOrderStatusAction } from "../orders/actions";
import styles from "./kitchen.module.css";

export const dynamic = "force-dynamic";

// Same "Start preparing" / "Mark ready" language as the full Orders page —
// one order pipeline, one set of transition actions
// (advanceOrderStatusAction, dashboard/orders/actions.ts), just a
// different, deliberately minimal view onto it. This page invents no
// second order-status mechanism.
const ADVANCE_LABEL: Record<string, string> = {
  CONFIRMED: "Start preparing",
  PROCESSING: "Mark ready",
};

type KitchenOrder = Awaited<ReturnType<typeof listKitchenOrders>>[number];

function ageMinutes(createdAt: Date): number {
  return Math.floor((Date.now() - createdAt.getTime()) / 60_000);
}

/**
 * KitchenOrder -> KitchenTicket.
 *
 * `fulfilment` is deliberately not set: listKitchenOrders does not select it,
 * and a ticket showing a guessed Collection/Delivery is worse than one
 * showing none. Nothing here reaches for customer, phone, address or payment
 * fields — the query does not return them, and this view exists precisely so
 * kitchen staff never see them.
 *
 * The action is the same authorized advanceOrderStatusAction the Orders page
 * uses; this page invents no second order-status mechanism.
 */
function toTicket(order: KitchenOrder): KitchenTicket {
  const age = ageMinutes(order.createdAt);
  return {
    id: order.id,
    number: order.orderNumber,
    ageLabel: `${age}m`,
    items: order.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      options: item.options.map((option) => option.optionNameSnapshot),
    })),
    fulfilment: order.fulfilmentMethod === "DELIVERY" ? "Delivery — pack to travel" : "Collection",
    note: order.notes ?? undefined,
    action: (
      <ActionButton
        action={advanceOrderStatusAction.bind(null, order.id)}
        className={styles.actionBtn}
        pendingLabel="Updating…"
      >
        {ADVANCE_LABEL[order.status] ?? "Update"}
      </ActionButton>
    ),
  };
}

export default async function KitchenPage() {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const orders = await listKitchenOrders(session.tenantId);

  const newOrders = orders.filter((o) => o.status === "CONFIRMED");
  const preparing = orders.filter((o) => o.status === "PROCESSING");

  return (
    // staffSurface keeps the dark ground the Connected direction gives staff
    // screens, against the owner console's warm paper.
    <div className="shell staffSurface">
      <div className="consoleChrome">
        <DashboardNav current="kitchen" {...workspaceContext} />
      </div>

      <div className="consoleCanvas">
        <ConnectedKitchen
          newTickets={newOrders.map(toTicket)}
          preparing={preparing.map(toTicket)}
          // No `ready`: listKitchenOrders stops at PROCESSING, so a Ready
          // column here could never fill. Kept as current behaviour rather
          // than widening the query to fill a column.
        />
      </div>
    </div>
  );
}
