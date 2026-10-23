/**
 * Dashboard > Analytics > Forecast > Win-back — the customers whose own
 * ordering rhythm says they are about to stop coming, and what to do about
 * each one.
 *
 * Three separate gates, because they answer three different questions:
 *   - may this PERSON see analytics at all (canViewAnalytics);
 *   - may they see customer details (canManageCustomers / canIssueLoyalty) —
 *     a cashier who may read the sales overview still has no business with a
 *     customer list;
 *   - may they see a customer's contact number (canManageOrders /
 *     canManageDeliveries) — the same pair the Orders page uses before it
 *     shows one, since that number is the customer's own and was left for a
 *     delivery, not for marketing.
 * The plan gate (advanced_analytics) is about the BUSINESS and is checked
 * alongside them.
 */

import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { getBusinessEntitlements } from "@/modules/billing/subscription.service";
import { forecastAccess } from "@/modules/analytics/forecast-access";
import { getWinBackList } from "@/modules/analytics/win-back.service";
import type { WinBackCustomer, WinBackList } from "@/modules/analytics/win-back";
import DashboardNav from "@/components/DashboardNav";
import styles from "./win-back.module.css";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<WinBackCustomer["status"], string> = {
  slipping: "Slipping",
  overdue: "Overdue",
  gone: "Gone quiet",
};

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "UTC" });
}

export default async function WinBackPage() {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);

  let permitted = true;
  try {
    await requireStaffPermission("canViewAnalytics");
  } catch {
    permitted = false;
  }

  const entitlements = await getBusinessEntitlements(session.tenantId);
  const access = forecastAccess({ permissions: workspaceContext.permissions, entitlements });

  const blocked =
    !permitted || access.winBackBlockedBy === "permission"
      ? "Your role doesn't have permission to view analytics — ask the business owner."
      : access.winBackBlockedBy === "customer-permission"
        ? "Your role doesn't include customer details — ask the business owner if you need this list."
        : null;

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Who to win back</h1>
        <p className={styles.lede}>
          Customers whose own ordering pattern says they are slipping away, with a message you can send them.
        </p>

        <DashboardNav current="analytics" {...workspaceContext} />

        <p className={styles.breadcrumb}>
          <Link href="/dashboard/analytics/forecast">&larr; Back to the forecast</Link>
        </p>

        {blocked ? (
          <div className={`card ${styles.blocked}`}>
            <p>{blocked}</p>
          </div>
        ) : !access.winBack ? (
          <div className={`card ${styles.blocked}`}>
            <p>
              The win-back list comes with the longer sales history
              {entitlements.planName ? `, which isn't on your plan (${entitlements.planName})` : ", which isn't on your plan"}. Your
              cash-flow forecast is still on <Link href="/dashboard/analytics/forecast">the forecast page</Link>.
            </p>
          </div>
        ) : (
          <WinBackView businessId={session.tenantId} maySeeNumbers={access.contactNumbers} />
        )}
      </div>
    </main>
  );
}

async function WinBackView({ businessId, maySeeNumbers }: { businessId: string; maySeeNumbers: boolean }) {
  const list = await getWinBackList(businessId, { includeContactNumbers: maySeeNumbers });

  if (list.consideredCount === 0) {
    return (
      <div className={`card ${styles.blocked}`}>
        <p>No customer has paid for an order yet, so there is nobody to win back. This fills in as people order.</p>
      </div>
    );
  }

  if (list.customers.length === 0) {
    return (
      <>
        <div className={`card ${styles.allWell}`}>
          <p className={styles.allWellTitle}>Nobody is slipping right now</p>
          <p className={styles.allWellBody}>
            All {list.consideredCount} of your paying customers have ordered within their usual rhythm. Come back to this page in a
            week or two.
          </p>
        </div>
        <MethodCard list={list} />
      </>
    );
  }

  return (
    <>
      <div className={styles.statGrid}>
        <div className={`card ${styles.statTile}`}>
          <p className={styles.statNumber}>{list.counts.slipping}</p>
          <p className={styles.statLabel}>slipping — still easy to bring back</p>
        </div>
        <div className={`card ${styles.statTile}`}>
          <p className={styles.statNumber}>{list.counts.overdue}</p>
          <p className={styles.statLabel}>overdue — well past their usual</p>
        </div>
        <div className={`card ${styles.statTile}`}>
          <p className={styles.statNumber}>{list.counts.gone}</p>
          <p className={styles.statLabel}>gone quiet</p>
        </div>
        <div className={`card ${styles.statTile}`}>
          <p className={styles.statNumber}>{list.atRiskDisplay}</p>
          <p className={styles.statLabel}>spent here by everyone on this list</p>
        </div>
      </div>

      <ul className={styles.list}>
        {list.customers.map((customer) => (
          <li key={customer.publicId} className={`card ${styles.customer}`}>
            <div className={styles.customerHead}>
              <div>
                <p className={styles.customerName}>
                  {customer.name} <span className={styles.code}>{customer.shortCode}</span>
                </p>
                <p className={styles.customerMeta}>
                  Last order {shortDate(customer.lastOrder)} · {customer.daysSince} days ago ·{" "}
                  {customer.orders} {customer.orders === 1 ? "order" : "orders"} · {customer.spentDisplay} spent
                </p>
              </div>
              <span className={`${styles.badge} ${styles[customer.status]}`}>{STATUS_LABEL[customer.status]}</span>
            </div>
            <p className={styles.action}>{customer.action}</p>
            {customer.whatsappUrl ? (
              <a className={styles.whatsapp} href={customer.whatsappUrl} target="_blank" rel="noreferrer">
                Message on WhatsApp
              </a>
            ) : (
              <p className={styles.contactNote}>{customer.contactNote}</p>
            )}
          </li>
        ))}
      </ul>

      {!maySeeNumbers && (
        <p className={styles.hint}>
          Your role doesn&apos;t include customer contact numbers, so there are no WhatsApp links here — ask for these customers by
          their short code.
        </p>
      )}

      <MethodCard list={list} />
    </>
  );
}

function MethodCard({ list }: { list: WinBackList }) {
  return (
    <section className={`card ${styles.methodCard}`} aria-labelledby="win-back-method">
      <p id="win-back-method" className={styles.methodTitle}>
        How this list is worked out
      </p>
      <ol className={styles.methodList}>
        {list.method.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <p className={styles.hint}>
        A prediction, not a certainty — someone may simply have been away. The short code is how you look a customer up; we never show
        anyone else&apos;s details.
      </p>
    </section>
  );
}
