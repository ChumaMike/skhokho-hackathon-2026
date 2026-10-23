import { requireOwnerSession, getStaffWorkspaceContext } from "../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { listDeliveriesForManagement, listEligibleDrivers } from "@/modules/orders/order-delivery.service";
import DashboardNav from "@/components/DashboardNav";
import { assignDriverAction, rotateOwnCodeAction, deliverWithoutCodeAction } from "./actions";
import NetworkDeliveries from "./NetworkDeliveries";
import styles from "./deliveries.module.css";

export const dynamic = "force-dynamic";

const FAILURE_REASONS = [
  "Customer unavailable",
  "Wrong/incomplete address",
  "Customer cancelled",
  "Vehicle/problem",
  "Other",
];

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ assigned?: string; err?: string; requested?: string; cancelled?: string; rotated?: string; delivered?: string }>;
}) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;

  let permitted = true;
  try {
    await requireStaffPermission("canManageDeliveries");
  } catch {
    permitted = false;
  }

  if (!permitted) {
    return (
      <main className="shell">
        <div className="column">
          <span className="eyebrow">Skhokho</span>
          <h1 className={styles.title}>Deliveries</h1>
          <DashboardNav current="deliveries" {...workspaceContext} />
          <div className={`card ${styles.empty}`}>
            <p>Your role doesn&apos;t have permission to manage deliveries — ask the business owner.</p>
          </div>
        </div>
      </main>
    );
  }

  if (!workspaceContext.capabilities.has("DELIVERY")) {
    return (
      <main className="shell">
        <div className="column">
          <span className="eyebrow">Skhokho</span>
          <h1 className={styles.title}>Deliveries</h1>
          <DashboardNav current="deliveries" {...workspaceContext} />
          <div className={`card ${styles.empty}`}>
            <p>Delivery isn&apos;t set up for this business yet.</p>
          </div>
        </div>
      </main>
    );
  }

  const [deliveries, drivers] = await Promise.all([
    listDeliveriesForManagement(session.tenantId),
    listEligibleDrivers(session.tenantId),
  ]);

  const needsDriver = deliveries.filter((d) => d.status === "UNASSIGNED" && d.order.status === "READY");
  const assigned = deliveries.filter((d) => d.status === "ASSIGNED");
  const pickedUp = deliveries.filter((d) => d.status === "PICKED_UP");
  const problems = deliveries.filter((d) => d.status === "FAILED");

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const deliveredToday = deliveries.filter(
    (d) => d.status === "DELIVERED" && d.deliveredAt && d.deliveredAt >= startOfToday,
  ).length;

  // Active-load count per driver — the closest honest reading of
  // "Available"/"Busy" this app can give without a real shift/roster
  // concept: currently assigned or out-for-delivery right now.
  const activeByDriver = new Map<string, number>();
  for (const d of [...assigned, ...pickedUp]) {
    if (!d.driverStaffId) continue;
    activeByDriver.set(d.driverStaffId, (activeByDriver.get(d.driverStaffId) ?? 0) + 1);
  }

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Deliveries</h1>

        <DashboardNav current="deliveries" {...workspaceContext} />

        {sp.assigned && <div className="successBanner">Driver assigned.</div>}
        {sp.requested && <div className="successBanner">Request sent — we&apos;re finding a Skhokholetha driver near you.</div>}
        {sp.cancelled && <div className="successBanner">Delivery cancelled.</div>}
        {sp.rotated && <div className="successBanner">New code issued — the old one no longer works.</div>}
        {sp.delivered && <div className="successBanner">Delivery completed and the reason recorded.</div>}
        {sp.err && <div className="errorBanner">{sp.err}</div>}

        <div className={styles.statGrid}>
          <div className={`card ${styles.statTile}`}>
            <p className={styles.statNumber}>{needsDriver.length}</p>
            <p className={styles.statLabel}>ready to assign</p>
          </div>
          <div className={`card ${styles.statTile}`}>
            <p className={styles.statNumber}>{assigned.length}</p>
            <p className={styles.statLabel}>assigned</p>
          </div>
          <div className={`card ${styles.statTile}`}>
            <p className={styles.statNumber}>{pickedUp.length}</p>
            <p className={styles.statLabel}>out for delivery</p>
          </div>
          <div className={`card ${styles.statTile}`}>
            <p className={styles.statNumber}>{deliveredToday}</p>
            <p className={styles.statLabel}>delivered today</p>
          </div>
        </div>

        <div className={styles.layout}>
        <div>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Needs driver ({needsDriver.length})</h2>
          {needsDriver.length === 0 ? (
            <p className={styles.emptyHint}>Nothing waiting for a driver.</p>
          ) : (
            <ul className={styles.list}>
              {needsDriver.map((delivery) => (
                <li key={delivery.id} className={`card ${styles.item}`}>
                  <div className={styles.itemTop}>
                    <span className={styles.orderNumber}>{delivery.order.orderNumber}</span>
                  </div>
                  <p className={styles.address}>{delivery.deliveryAddressSnapshot}</p>
                  {drivers.length === 0 ? (
                    <p className={styles.emptyHint}>No eligible drivers on the team yet.</p>
                  ) : (
                    <form action={assignDriverAction.bind(null, delivery.id)} className={styles.assignForm}>
                      <select name="driverStaffId" className="input" required aria-label="Choose a driver">
                        <option value="" disabled>
                          Choose a driver…
                        </option>
                        {drivers.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.firstName} {d.lastName}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn btnPrimary">
                        Assign
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Assigned ({assigned.length})</h2>
          {assigned.length === 0 ? (
            <p className={styles.emptyHint}>No deliveries currently assigned.</p>
          ) : (
            <ul className={styles.list}>
              {assigned.map((delivery) => (
                <li key={delivery.id} className={`card ${styles.item}`}>
                  <div className={styles.itemTop}>
                    <span className={styles.orderNumber}>{delivery.order.orderNumber}</span>
                    <span className={styles.driverName}>
                      {delivery.driverStaff?.firstName} {delivery.driverStaff?.lastName}
                    </span>
                  </div>
                  <p className={styles.address}>{delivery.deliveryAddressSnapshot}</p>
                  {delivery.codeLocked && (
                    <form action={rotateOwnCodeAction.bind(null, delivery.id)} className={styles.assignForm}>
                      <span className={styles.failureReason}>Delivery code locked after too many wrong tries.</span>
                      <button type="submit" className="btn btnSecondary">Issue a new code</button>
                    </form>
                  )}
                  {drivers.length > 0 && (
                    <form action={assignDriverAction.bind(null, delivery.id)} className={styles.assignForm}>
                      <select name="driverStaffId" className="input" defaultValue={delivery.driverStaffId ?? ""} required aria-label="Reassign to a driver">
                        {drivers.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.firstName} {d.lastName}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn btnSecondary">
                        Reassign
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Picked up / out ({pickedUp.length})</h2>
          {pickedUp.length === 0 ? (
            <p className={styles.emptyHint}>No deliveries currently out.</p>
          ) : (
            <ul className={styles.list}>
              {pickedUp.map((delivery) => (
                <li key={delivery.id} className={`card ${styles.item}`}>
                  <div className={styles.itemTop}>
                    <span className={styles.orderNumber}>{delivery.order.orderNumber}</span>
                    <span className={styles.driverName}>
                      {delivery.driverStaff?.firstName} {delivery.driverStaff?.lastName}
                    </span>
                  </div>
                  <p className={styles.address}>{delivery.deliveryAddressSnapshot}</p>
                  <p className={styles.emptyHint}>Out for delivery — reassignment isn&apos;t available after pickup.</p>
                  {delivery.needsCode && (
                    <>
                      {delivery.codeLocked && (
                        <form action={rotateOwnCodeAction.bind(null, delivery.id)} className={styles.assignForm}>
                          <span className={styles.failureReason}>Delivery code locked after too many wrong tries.</span>
                          <button type="submit" className="btn btnSecondary">Issue a new code</button>
                        </form>
                      )}
                      <form action={deliverWithoutCodeAction.bind(null, delivery.id)} className={styles.assignForm}>
                        <input className="input" name="reason" required minLength={5} maxLength={300} placeholder="Reason for completing without the customer's code" aria-label="Reason for completing without the code" />
                        <button type="submit" className="btn btnSecondary">Mark delivered without code</button>
                      </form>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Problems ({problems.length})</h2>
          {problems.length === 0 ? (
            <p className={styles.emptyHint}>No delivery problems reported.</p>
          ) : (
            <ul className={styles.list}>
              {problems.map((delivery) => (
                <li key={delivery.id} className={`card ${styles.item} ${styles.itemProblem}`}>
                  <div className={styles.itemTop}>
                    <span className={styles.orderNumber}>{delivery.order.orderNumber}</span>
                    <span className={styles.driverName}>
                      {delivery.driverStaff?.firstName} {delivery.driverStaff?.lastName}
                    </span>
                  </div>
                  <p className={styles.address}>{delivery.deliveryAddressSnapshot}</p>
                  <p className={styles.failureReason}>{delivery.failureReason}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <NetworkDeliveries
          businessId={session.tenantId}
          unassigned={deliveries
            .filter((d) => d.status === "UNASSIGNED" && ["CONFIRMED", "PROCESSING", "READY"].includes(d.order.status))
            .map((d) => ({ orderId: d.order.id, orderNumber: d.order.orderNumber }))}
        />

        {/* Suggested reasons shared with the driver workspace's Report problem
            action — kept here only as a visible reference for the reasons
            managers will see, not a form of its own on this page. */}
        <p className={styles.reasonsHint}>Common reasons: {FAILURE_REASONS.join(", ")}.</p>
        </div>

        <aside className={`card ${styles.driverPanel}`} aria-label="Drivers">
          <p className={styles.driverPanelTitle}>Drivers</p>
          {drivers.length === 0 ? (
            <p className={styles.emptyHint}>No eligible drivers on the team yet.</p>
          ) : (
            drivers.map((d) => {
              const active = activeByDriver.get(d.id) ?? 0;
              return (
                <div key={d.id} className={styles.driverRow}>
                  <span className={styles.driverRowName}>
                    {d.firstName} {d.lastName}
                  </span>
                  <span className={`${styles.driverStatus} ${active > 0 ? styles.driverStatusBusy : styles.driverStatusAvailable}`}>
                    {active > 0 ? `${active} active` : "Available"}
                  </span>
                </div>
              );
            })
          )}
        </aside>
        </div>
      </div>
    </main>
  );
}
