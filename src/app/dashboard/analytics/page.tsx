import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { getBusinessEntitlements } from "@/modules/billing/subscription.service";
import { hasFeature } from "@/modules/billing/entitlements";
import { getWeeklyAnalytics, type WeeklyAnalyticsRow } from "@/modules/analytics/analytics.service";
import { formatZAR } from "@/lib/utils";
import { getStorefrontInsights } from "@/modules/storefront-learning/insights";
import DashboardNav from "@/components/DashboardNav";
import styles from "./analytics.module.css";

export const dynamic = "force-dynamic";

/** basic_analytics: the recent picture. advanced_analytics: about six months of history. */
const BASIC_HISTORY_WEEKS = 6;
const ADVANCED_HISTORY_WEEKS = 26;

function formatWeekLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "UTC" });
}

export default async function AnalyticsPage() {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);

  let permitted = true;
  try {
    await requireStaffPermission("canViewAnalytics");
  } catch {
    permitted = false;
  }

  // Permission (above) is about the PERSON; the plan is about the BUSINESS.
  const entitlements = await getBusinessEntitlements(session.tenantId);
  const weeks = hasFeature(entitlements, "advanced_analytics") ? ADVANCED_HISTORY_WEEKS : BASIC_HISTORY_WEEKS;

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Analytics</h1>

        <DashboardNav current="analytics" {...workspaceContext} />

        {!permitted ? (
          <div className={`card ${styles.upgrade}`}>
            <p>Your role doesn&apos;t have permission to view analytics — ask the business owner.</p>
          </div>
        ) : !hasFeature(entitlements, "basic_analytics") ? (
          <div className={`card ${styles.upgrade}`}>
            <p>Sales analytics isn&apos;t included in your plan{entitlements.planName ? ` (${entitlements.planName})` : ""}.</p>
          </div>
        ) : (
          <>
            {/* Cash-flow forecast lives one level down, under Analytics, rather
             * than as its own nav section: it reads the same orders this page
             * does and belongs next to them. */}
            <Link href="/dashboard/analytics/forecast" className={`card ${styles.forecastLink}`}>
              <span className={styles.forecastLinkTitle}>Cash-flow forecast &rarr;</span>
              <span className={styles.forecastLinkBody}>
                What your next four weeks look like, your busiest and slowest days, and a one-page funding report you can
                print.
              </span>
            </Link>
            <WeeklyOverview businessId={session.tenantId} weeks={weeks} />
            <StorefrontInsightsCard businessId={session.tenantId} />
          </>
        )}
      </div>
    </main>
  );
}

// Plain sentences about this business's OWN storefront visits — counts only,
// no visitor-level data exists to show.
async function StorefrontInsightsCard({ businessId }: { businessId: string }) {
  const insights = await getStorefrontInsights(businessId);
  return (
    <section className={`card ${styles.insightCard}`} aria-labelledby="storefront-insights-heading">
      <p id="storefront-insights-heading" className={styles.insightTitle}>
        Your storefront, last 30 days
      </p>
      {!insights.enoughData ? (
        <p className={styles.insightBody}>
          {insights.visits === 0
            ? "No storefront visits counted yet. Share your storefront link and tips will show up here."
            : `${insights.visits} storefront ${insights.visits === 1 ? "visit" : "visits"} so far — tips will show up here once a few more people have visited.`}
        </p>
      ) : (
        <ul className={styles.insightList}>
          {insights.insights.map((i) => (
            <li key={i.key} className={styles.insightBody}>
              {i.text}
            </li>
          ))}
        </ul>
      )}
      <p className={styles.hint}>We count visits and taps on your storefront — never who your visitors are.</p>
    </section>
  );
}

async function WeeklyOverview({ businessId, weeks: weekCount }: { businessId: string; weeks: number }) {
  const weeks = await getWeeklyAnalytics(businessId, weekCount);
  const latest = weeks[weeks.length - 1];
  const previous = weeks[weeks.length - 2];

  const totalRevenue = weeks.reduce((sum, w) => sum + w.revenue, 0);
  const totalOrders = weeks.reduce((sum, w) => sum + w.orders, 0);
  const paidOrders = weeks.reduce((sum, w) => sum + w.paidOrders, 0);
  const cancelledOrders = weeks.reduce((sum, w) => sum + w.cancelledOrders, 0);
  const deliveryOrders = weeks.reduce((sum, w) => sum + w.deliveryOrders, 0);
  const totalAppointments = weeks.reduce((sum, w) => sum + w.appointments, 0);
  // Paid revenue over PAID orders — dividing by every order (unpaid, cancelled) understated it.
  const avgOrderValue = paidOrders > 0 ? totalRevenue / paidOrders : 0;
  const maxRevenue = Math.max(...weeks.map((w) => w.revenue), 1);

  const insight = buildInsight(latest, previous);

  return (
    <>
      <div className={styles.statGrid}>
        <div className={`card ${styles.statTile}`}>
          <p className={styles.statNumber}>{formatZAR(totalRevenue)}</p>
          <p className={styles.statLabel}>sales, last {weekCount} weeks</p>
        </div>
        <div className={`card ${styles.statTile}`}>
          <p className={styles.statNumber}>{totalOrders}</p>
          <p className={styles.statLabel}>orders</p>
        </div>
        <div className={`card ${styles.statTile}`}>
          <p className={styles.statNumber}>{paidOrders > 0 ? formatZAR(avgOrderValue) : "—"}</p>
          <p className={styles.statLabel}>average paid order ({paidOrders} paid)</p>
        </div>
        <div className={`card ${styles.statTile}`}>
          <p className={styles.statNumber}>{totalAppointments}</p>
          <p className={styles.statLabel}>bookings</p>
        </div>
        <div className={`card ${styles.statTile}`}>
          <p className={styles.statNumber}>{totalOrders > 0 ? `${deliveryOrders} / ${totalOrders - deliveryOrders}` : "—"}</p>
          <p className={styles.statLabel}>delivery / collection orders</p>
        </div>
        <div className={`card ${styles.statTile}`}>
          <p className={styles.statNumber}>{cancelledOrders}</p>
          <p className={styles.statLabel}>cancelled orders</p>
        </div>
      </div>

      {insight && (
        <div className={`card ${styles.insightCard}`}>
          <p className={styles.insightTitle}>{insight.title}</p>
          <p className={styles.insightBody}>{insight.body}</p>
        </div>
      )}

      <div className={`card ${styles.chartCard}`}>
        <div className={styles.chartHeader}>
          <span className={styles.chartTitle}>Sales by week</span>
          <span className={styles.chartHint}>Paid orders only</span>
        </div>
        <div className={styles.bars}>
          {weeks.map((w) => (
            <div key={w.weekStart} className={styles.barCol}>
              <span className={styles.barValue}>{w.revenue > 0 ? formatZAR(w.revenue) : ""}</span>
              <div className={styles.bar} style={{ height: `${Math.max(3, (w.revenue / maxRevenue) * 100)}%` }} />
              <span className={styles.barLabel}>{formatWeekLabel(w.weekStart)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Week of</th>
              <th>Orders</th>
              <th>Paid</th>
              <th>Cancelled</th>
              <th>Revenue</th>
              <th>New customers</th>
              <th>Bookings</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week.weekStart}>
                <td>{formatWeekLabel(week.weekStart)}</td>
                <td>{week.orders}</td>
                <td>{week.paidOrders}</td>
                <td>{week.cancelledOrders}</td>
                <td>{formatZAR(week.revenue)}</td>
                <td>{week.newCustomers}</td>
                <td>{week.appointments}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className={styles.hint}>
          Revenue counts orders marked paid only. Numbers for the current week are still coming in.
        </p>
      </div>
    </>
  );
}

// One truthful comparative sentence — current week vs the one before it.
// No "why"/"watch"/"try" sub-insights: those would need signals (busiest
// time of day, top product) this app doesn't track yet, and a plausible-
// sounding invented reason is worse than no reason.
function buildInsight(
  latest: WeeklyAnalyticsRow | undefined,
  previous: WeeklyAnalyticsRow | undefined,
): { title: string; body: string } | null {
  if (!latest || !previous) return null;
  const diff = latest.revenue - previous.revenue;
  if (latest.revenue === 0 && previous.revenue === 0) return null;

  if (diff > 0) {
    return {
      title: "You had a stronger week",
      body: `${formatZAR(latest.revenue)} sales, up ${formatZAR(diff)} from the week before.`,
    };
  }
  if (diff < 0) {
    return {
      title: "A quieter week",
      body: `${formatZAR(latest.revenue)} sales, down ${formatZAR(Math.abs(diff))} from the week before.`,
    };
  }
  return {
    title: "A steady week",
    body: `${formatZAR(latest.revenue)} sales, the same as the week before.`,
  };
}
