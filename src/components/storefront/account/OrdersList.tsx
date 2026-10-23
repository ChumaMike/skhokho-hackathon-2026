import { CANCEL_REASONS, type CustomerOrderView } from "@/modules/customers/customer-orders.service";
import ReorderButton from "./ReorderButton";
import CancelOrderForm from "./CancelOrderForm";
import styles from "./Account.module.css";

const REASONS = Object.entries(CANCEL_REASONS).map(([key, label]) => ({ key, label }));

/** The customer's orders at one shop: live ones first, then history. Server component; the two buttons are the only client parts. */
export default function OrdersList({ orders, businessId, basePath }: { orders: CustomerOrderView[]; businessId: string; basePath: string }) {
  if (orders.length === 0) {
    return <p className={styles.muted}>No orders here yet. Once you order from the shop, it shows up here with its status.</p>;
  }
  return (
    <ul className={styles.orderList} aria-label="Your orders">
      {orders.map((o) => (
        <li key={o.id} className={styles.card}>
          <div className={styles.orderHead}>
            <span className={styles.orderNumber}>Order {o.orderNumber}</span>
            <span className={`${styles.chip} ${o.live ? styles.chipLive : styles.chipDone}`}>{o.statusLabel}</span>
          </div>
          <p className={styles.muted}>
            {o.placedLabel} · {o.fulfilmentMethod === "DELIVERY" ? "Delivery" : "Collection"} · {o.totalFormatted} · {o.paymentLine}
            {o.deliveryLabel ? ` · ${o.deliveryLabel}` : ""}
          </p>
          <ul className={styles.itemLines}>
            {o.items.map((i, idx) => (
              <li key={idx}>
                {i.quantity} × {i.name}
                {i.options.length > 0 ? ` — ${i.options.join(", ")}` : ""}
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <a className="btn btnSecondary" href={o.trackingPath}>
              {o.live ? "Track order" : "View order"}
            </a>
            {o.deliveryPageUrl && o.live && (
              <a className="btn btnSecondary" href={o.deliveryPageUrl}>
                Your delivery page
              </a>
            )}
            <ReorderButton businessId={businessId} basePath={basePath} lines={o.reorderLines} className="btn btnSecondary" />
            {o.canCancel && <CancelOrderForm businessId={businessId} orderId={o.id} orderNumber={o.orderNumber} reasons={REASONS} />}
          </div>
        </li>
      ))}
    </ul>
  );
}
