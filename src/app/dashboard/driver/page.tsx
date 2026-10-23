import { requireOwnerSession, getStaffWorkspaceContext } from "../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { listMyDeliveries, listMyCompletedDeliveries } from "@/modules/orders/order-delivery.service";
import DashboardNav from "@/components/DashboardNav";
import ActionButton from "@/components/ActionButton";
import DriverLocationSharer from "./DriverLocationSharer";
import { markPickedUpAction, markDeliveredAction, reportProblemAction } from "./actions";
import styles from "./driver.module.css";
import { whatsappLink } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FAILURE_REASONS = [
  "Customer unavailable",
  "Wrong/incomplete address",
  "Customer cancelled",
  "Vehicle/problem",
  "Other",
];

function directionsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function waUrl(phone: string): string | null {
  return whatsappLink(phone);
}

export default async function DriverPage({
  searchParams,
}: {
  searchParams: Promise<{ reported?: string; err?: string; delivered?: string }>;
}) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;

  let permitted = true;
  try {
    await requireStaffPermission("canPerformDeliveries");
  } catch {
    permitted = false;
  }

  if (!permitted) {
    return (
      <main className="shell staffSurface">
        <div className="column">
          <span className="eyebrow">Skhokho</span>
          <h1 className={styles.title}>Deliveries</h1>
          <DashboardNav current="deliveries" {...workspaceContext} />
          <div className={`card ${styles.empty}`}>
            <p>Your role doesn&apos;t have permission to perform deliveries — ask the business owner.</p>
          </div>
        </div>
      </main>
    );
  }

  const [active, history] = await Promise.all([
    listMyDeliveries(session.tenantId, session.staffId),
    listMyCompletedDeliveries(session.tenantId, session.staffId),
  ]);

  return (
    <main className="shell staffSurface">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>My deliveries</h1>

        <DashboardNav current="deliveries" {...workspaceContext} />

        {sp.reported && <div className="successBanner">Problem reported — a manager will follow up.</div>}
        {sp.delivered && <div className="successBanner">Delivered — nice one.</div>}
        {sp.err && <div className="errorBanner">{sp.err}</div>}

        <DriverLocationSharer
          activeDeliveryIds={active.filter((d) => d.status === "PICKED_UP").map((d) => d.id)}
        />

        {active.length > 0 && (
          <div className={`card ${styles.routeSummary}`}>
            <p className={styles.routeSummaryEyebrow}>Today&apos;s route</p>
            <p className={styles.routeSummaryTitle}>
              {active.length} {active.length === 1 ? "delivery" : "deliveries"} left
            </p>
          </div>
        )}

        {active.length === 0 ? (
          <div className={`card ${styles.empty}`}>
            <p>Nothing assigned to you right now.</p>
          </div>
        ) : (
          <ul className={styles.list}>
            {active.map((delivery) => {
              const itemNames = delivery.order.items.map((i) => `${i.quantity}× ${i.name}`).join(", ");
              return (
                <li key={delivery.id} className={`card ${styles.item}`}>
                  <div className={styles.itemTop}>
                    <span className={styles.orderNumber}>{delivery.order.orderNumber}</span>
                    <span className={styles.status}>{delivery.status === "PICKED_UP" ? "Out for delivery" : "Ready to collect"}</span>
                  </div>
                  <p className={styles.customer}>{delivery.order.membership?.displayName || "Customer"}</p>
                  <p className={styles.items}>{itemNames}</p>
                  <p className={styles.address}>{delivery.deliveryAddressSnapshot}</p>
                  {delivery.deliveryInstructions && (
                    <p className={styles.instructions}>{delivery.deliveryInstructions}</p>
                  )}

                  <div className={styles.linkRow}>
                    <a
                      href={directionsUrl(delivery.deliveryAddressSnapshot)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.linkBtn}
                    >
                      Open directions
                    </a>
                    {delivery.contactPhone && (
                      <>
                        <a href={`tel:${delivery.contactPhone}`} className={styles.linkBtn}>
                          Call
                        </a>
                        {waUrl(delivery.contactPhone) && (
                          <a
                            href={waUrl(delivery.contactPhone)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.linkBtn}
                          >
                            WhatsApp
                          </a>
                        )}
                      </>
                    )}
                  </div>

                  <div className={styles.actionRow}>
                    {delivery.status === "ASSIGNED" && (
                      <ActionButton
                        action={markPickedUpAction.bind(null, delivery.id)}
                        className={styles.primaryBtn}
                        pendingLabel="Updating…"
                      >
                        Picked up
                      </ActionButton>
                    )}
                    {delivery.status === "PICKED_UP" && (
                      <form action={markDeliveredAction.bind(null, delivery.id)} className={styles.reportForm}>
                        {delivery.needsCode && (
                          <>
                            {delivery.codeLocked ? (
                              <p className="errorBanner" style={{ margin: 0 }}>
                                Too many wrong codes — ask your manager to issue a new one.
                              </p>
                            ) : (
                              <input
                                className="input"
                                name="code"
                                inputMode="numeric"
                                pattern="[0-9 ]{6,7}"
                                maxLength={7}
                                autoComplete="one-time-code"
                                placeholder="Customer's 6-digit code"
                                aria-label="The customer's 6-digit delivery code"
                                required
                              />
                            )}
                          </>
                        )}
                        <button type="submit" className={styles.primaryBtn} disabled={delivery.needsCode && delivery.codeLocked}>
                          Delivered
                        </button>
                      </form>
                    )}
                  </div>

                  <form action={reportProblemAction} className={styles.reportForm}>
                    <input type="hidden" name="deliveryId" value={delivery.id} />
                    <select name="reason" className="input" required defaultValue="" aria-label="Report a problem with this delivery">
                      <option value="" disabled>
                        Report a problem…
                      </option>
                      {FAILURE_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {reason}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className={styles.problemBtn}>
                      Report
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}

        {history.length > 0 && (
          <section className={styles.historySection}>
            <h2 className={styles.historyTitle}>Recent</h2>
            <ul className={styles.historyList}>
              {history.map((delivery) => (
                <li key={delivery.id} className={styles.historyItem}>
                  <span className={styles.orderNumber}>{delivery.order.orderNumber}</span>
                  <span className={delivery.status === "FAILED" ? styles.historyFailed : styles.historyDelivered}>
                    {delivery.status === "FAILED" ? delivery.failureReason || "Problem reported" : "Delivered"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
