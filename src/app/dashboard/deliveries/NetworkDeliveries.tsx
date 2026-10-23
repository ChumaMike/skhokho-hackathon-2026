import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma/client";
import { getAppUrl, formatCents, formatSAPhone } from "@/lib/utils";
import { checkOrderEligibility, getShopDeliveryView } from "@/modules/skhokholetha/delivery.service";
import { maybeTickDispatch } from "@/modules/skhokholetha/dispatch.service";
import { lethaEnabled } from "@/modules/skhokholetha/flags";
import { cancelNetworkDriverAction, requestNetworkDriverAction, rotateCodeAction } from "./actions";
import styles from "./deliveries.module.css";

const STATUS_LABELS: Record<string, string> = {
  CREATED: "Getting ready",
  SEARCHING: "Looking for a driver",
  OFFERED: "Offered to nearby drivers",
  ASSIGNED: "Driver found",
  DRIVER_TO_PICKUP: "Driver on the way to you",
  ARRIVED_PICKUP: "Driver is at your shop",
  PICKED_UP: "Collected",
  IN_TRANSIT: "On the way to the customer",
  ARRIVED_DROPOFF: "Driver is at the customer",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  FAILED: "Couldn't deliver",
  RETURNING: "Coming back to your shop",
  RETURNED: "Returned to your shop",
  DISPUTED: "Under review by Skhokho",
};

const CANCELLABLE = ["CREATED", "SEARCHING", "OFFERED", "ASSIGNED", "DRIVER_TO_PICKUP", "ARRIVED_PICKUP"];
const RECENT_MS = 24 * 60 * 60 * 1000;

/**
 * Skhokholetha on the shop's Deliveries page: request a network driver for an
 * unassigned delivery (at a server-quoted price), then follow it — status,
 * driver, the pickup code to hand over, and a status link the shop may share.
 * The customer's drop-off code is never shown here — only the customer has it.
 */
export default async function NetworkDeliveries({ businessId, unassigned }: { businessId: string; unassigned: { orderId: string; orderNumber: string }[] }) {
  // Ticks even when switched off: offers still expire; new rounds are skipped inside dispatch.
  await maybeTickDispatch();

  const recent = await prisma.networkDelivery.findMany({
    where: { businessId, OR: [{ endedAt: null }, { endedAt: { gt: new Date(Date.now() - RECENT_MS) } }] },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { orderId: true, orderDelivery: { select: { order: { select: { orderNumber: true } } } } },
  });
  const tracked = [...new Map(recent.map((r) => [r.orderId, r.orderDelivery.order.orderNumber])).entries()];
  const [views, quotes] = await Promise.all([
    Promise.all(tracked.map(async ([orderId, orderNumber]) => ({ orderNumber, view: await getShopDeliveryView(businessId, orderId) }))),
    Promise.all(unassigned.slice(0, 20).map(async (o) => ({ ...o, quote: await checkOrderEligibility(businessId, o.orderId) }))),
  ]);
  // Requests switched off: nothing new to offer, but existing deliveries stay visible.
  const requestable = lethaEnabled("deliveryRequests") ? quotes.filter((q) => !tracked.some(([id]) => id === q.orderId) || q.quote.ok) : [];
  const appUrl = getAppUrl();

  return (
    <section className={styles.section} aria-label="Skhokholetha drivers">
      <h2 className={styles.sectionTitle}>Skhokholetha drivers</h2>
      <p className={styles.emptyHint}>No driver free? Ask a nearby Skhokholetha driver to deliver for you. You see the price before you confirm.</p>

      {requestable.length > 0 && (
        <ul className={styles.list}>
          {requestable.map((q) => (
            <li key={q.orderId} className={`card ${styles.item}`}>
              <div className={styles.itemTop}>
                <span className={styles.orderNumber}>{q.orderNumber}</span>
              </div>
              {q.quote.ok ? (
                <form action={requestNetworkDriverAction.bind(null, q.orderId)} className={styles.assignForm}>
                  <input type="hidden" name="requestKey" value={randomUUID()} />
                  <input type="hidden" name="confirmedFeeCents" value={q.quote.order.quote.quoteFeeCents} />
                  <span>
                    {formatCents(q.quote.order.quote.quoteFeeCents)} · {(q.quote.order.quote.distanceMeters / 1000).toFixed(1)} km
                  </span>
                  <button type="submit" className="btn btnPrimary">Request a driver</button>
                </form>
              ) : (
                <p className={styles.emptyHint}>{q.quote.reason}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {views.length > 0 && (
        <ul className={styles.list}>
          {views.map(({ orderNumber, view }) =>
            view ? (
              <li key={view.id} className={`card ${styles.item}`}>
                <div className={styles.itemTop}>
                  <span className={styles.orderNumber}>{orderNumber}</span>
                  <span className={styles.driverName}>{STATUS_LABELS[view.status] ?? view.status}</span>
                </div>
                <p className={styles.address}>
                  {formatCents(view.quoteFeeCents)} · {(view.distanceMeters / 1000).toFixed(1)} km
                  {view.driver && (
                    <>
                      {" "}· {view.driver.name}
                      {view.driver.registration ? ` (${view.driver.registration})` : ""}
                      {view.driver.phone && <> · <a href={`tel:${view.driver.phone}`}>{formatSAPhone(view.driver.phone)}</a></>}
                    </>
                  )}
                </p>
                {view.pickupCode && (
                  <p>
                    Pickup code for the driver: <strong style={{ letterSpacing: 2 }}>{view.pickupCode}</strong>
                    {view.pickupCodeLocked && " — locked after too many wrong tries."}
                  </p>
                )}
                {!["DELIVERED", "CANCELLED", "RETURNED"].includes(view.status) && (
                  <p>
                    Status link you can share (it shows no codes — the customer gets their delivery code directly from Skhokho):{" "}
                    <a href={`${appUrl}/track/${view.trackingToken}`} target="_blank" rel="noreferrer">
                      {appUrl}/track/{view.trackingToken.slice(0, 8)}…
                    </a>
                  </p>
                )}
                {view.endReason && <p className={styles.failureReason}>{view.endReason}</p>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {view.pickupCodeLocked && (
                    <form action={rotateCodeAction.bind(null, view.id, "PICKUP")}>
                      <button type="submit" className="btn btnSecondary">New pickup code</button>
                    </form>
                  )}
                  {view.dropoffCodeLocked && (
                    <form action={rotateCodeAction.bind(null, view.id, "DROPOFF")}>
                      <button type="submit" className="btn btnSecondary">New customer code</button>
                    </form>
                  )}
                </div>
                {CANCELLABLE.includes(view.status) && (
                  <details>
                    <summary>Cancel this delivery</summary>
                    <form action={cancelNetworkDriverAction.bind(null, view.id)} className={styles.assignForm}>
                      <input className="input" name="reason" placeholder="Why are you cancelling?" required maxLength={300} />
                      <button type="submit" className="btn btnSecondary">Cancel delivery</button>
                    </form>
                  </details>
                )}
              </li>
            ) : null,
          )}
        </ul>
      )}
    </section>
  );
}
