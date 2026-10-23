import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../session";
import { requireAnyStaffPermission } from "@/lib/auth/guards";
import { listOrders } from "@/modules/orders/order.service";
import { counterAccess, COUNTER_ENTRY_PERMISSIONS } from "@/modules/orders/counter-access";
import { getActiveCatalog } from "@/modules/catalog/catalog.service";
import { formatZAR } from "@/lib/utils";
import DashboardNav from "@/components/DashboardNav";
import { stampByPhoneAction } from "../customers/actions";
import CounterPOS from "./CounterPOS";
import styles from "./counter.module.css";

export const dynamic = "force-dynamic";

const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: "New",
  CONFIRMED: "Confirmed",
  PROCESSING: "Preparing",
  READY: "Ready",
};

const TERMINAL_STATUSES = new Set(["COMPLETED", "CANCELLED"]);

export default async function CounterPage({
  searchParams,
}: {
  searchParams: Promise<{ stamped?: string; err?: string }>;
}) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;

  // Checked before any order data is fetched (same shape as orders/page.tsx):
  // a driver, kitchen or stock role gets a denial banner, not the active
  // orders of the whole shop. Which parts render comes from the same
  // permissions (counter-access.ts); every action re-checks its own.
  let permitted = true;
  try {
    await requireAnyStaffPermission([...COUNTER_ENTRY_PERMISSIONS]);
  } catch {
    permitted = false;
  }
  const access = counterAccess(workspaceContext.permissions, workspaceContext.isOwner);

  if (!permitted || !access.allowed) {
    return (
      <main className="shell staffSurface">
        <div className="column">
          <span className="eyebrow">Skhokho</span>
          <h1 className={styles.title}>Counter</h1>
          <DashboardNav current="home" {...workspaceContext} />
          <div className={`card ${styles.empty}`}>
            <p>Your role doesn&apos;t have permission to use the counter — ask the business owner.</p>
          </div>
        </div>
      </main>
    );
  }

  const [{ orders }, catalog] = await Promise.all([
    access.canSeeOrders ? listOrders(session.tenantId, { perPage: 50 }) : Promise.resolve({ orders: [] as Awaited<ReturnType<typeof listOrders>>["orders"] }),
    access.canTakeOrders ? getActiveCatalog(session.tenantId) : Promise.resolve({ products: [], services: [] }),
  ]);
  const activeOrders = orders.filter((o) => !TERMINAL_STATUSES.has(o.status));
  // Options-configured products need the full configurator (size, extras)
  // this quick-tap grid doesn't have yet — simple products only for now.
  const posProducts = catalog.products.filter((p) => !p.hasOptions);

  return (
    <main className="shell staffSurface">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Counter</h1>

        <DashboardNav current="home" {...workspaceContext} />

        {sp.stamped && <div className="successBanner">Stamped — code {sp.stamped}.</div>}
        {sp.err && <div className="errorBanner">{sp.err}</div>}

        {access.canTakeOrders && <CounterPOS products={posProducts} />}

        {access.canStamp && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Find a customer &amp; give a stamp</h2>
          <form action={stampByPhoneAction} className={styles.stampForm}>
            <input
              className="input"
              name="phone"
              inputMode="tel"
              placeholder="082 123 4567"
              required
            />
            <button type="submit" className="btn btnPrimary">
              Stamp
            </button>
          </form>
        </section>
        )}

        {access.canSeeOrders && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Active orders</h2>
          {activeOrders.length === 0 ? (
            <div className={`card ${styles.empty}`}>
              <p>No active orders right now.</p>
            </div>
          ) : (
            <ul className={styles.list}>
              {activeOrders.map((order) => {
                const itemNames = order.items
                  .map((item) => `${item.quantity}× ${item.product?.name ?? item.service?.name ?? item.name}`)
                  .join(", ");
                return (
                  <li key={order.id} className={`card ${styles.order}`}>
                    <div className={styles.orderTop}>
                      <span className={styles.orderNumber}>{order.orderNumber}</span>
                      <span className={styles.total}>{formatZAR(order.total.toString())}</span>
                    </div>
                    <p className={styles.items}>{itemNames}</p>
                    <span className={styles.status}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <Link href="/dashboard/orders" className={styles.fullOrdersLink}>
            Manage all orders →
          </Link>
        </section>
        )}
      </div>
    </main>
  );
}
