import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../../session";
import { requireAnyStaffPermission } from "@/lib/auth/guards";
import { PAGE_ANALYTICS_WINDOWS, getPageAnalytics, type PageAnalyticsWindow } from "@/modules/storefront-learning/page-analytics";
import { getStorefrontInsights } from "@/modules/storefront-learning/insights";
import DashboardNav from "@/components/DashboardNav";
import styles from "./analytics.module.css";

export const dynamic = "force-dynamic";

function pct(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

/**
 * Dashboard › Storefront › Page analytics: for each page of the owner's
 * website, views, taps on the main button and enquiries over the last 7,
 * 30 or 90 days, plus the share of visits from phones — all from the
 * privacy-aware daily counters (no visitor is ever identified). Small
 * numbers are shown as they are.
 */
export default async function StorefrontAnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;

  let permitted = true;
  try {
    await requireAnyStaffPermission(["canViewAnalytics", "canManageSettings"]);
  } catch {
    permitted = false;
  }

  const requested = Number(sp.days);
  const days = (PAGE_ANALYTICS_WINDOWS as readonly number[]).includes(requested) ? (requested as PageAnalyticsWindow) : 30;
  const [analytics, insights] = permitted ? await Promise.all([getPageAnalytics(session.tenantId, days), getStorefrontInsights(session.tenantId)]) : [null, null];

  return (
    <main className="shell">
      <div className="column wide">
        <span className="eyebrow">Storefront</span>
        <h1 className={styles.title}>Page analytics</h1>
        <p className={styles.sub}>
          How each page of your website is doing. We count views and taps, never who the visitor is.{" "}
          <Link href="/dashboard/storefront">← Back to storefront</Link>
        </p>
        <DashboardNav current="storefront" {...workspaceContext} />

        {!permitted || !analytics ? (
          <div className="errorBanner">Your role doesn&apos;t have permission to see analytics — ask the business owner.</div>
        ) : (
          <>
            <nav className={styles.windows} aria-label="Period">
              {PAGE_ANALYTICS_WINDOWS.map((w) => (
                <Link key={w} href={`/dashboard/storefront/analytics?days=${w}`} className={`${styles.window} ${w === days ? styles.windowActive : ""}`}>
                  Last {w} days
                </Link>
              ))}
            </nav>

            <div className={styles.totals}>
              <div className={`card ${styles.total}`}>
                <span className={styles.totalLabel}>Page views</span>
                <strong className={styles.totalValue}>{analytics.totals.views}</strong>
              </div>
              <div className={`card ${styles.total}`}>
                <span className={styles.totalLabel}>Main button taps</span>
                <strong className={styles.totalValue}>{analytics.totals.primaryTaps}</strong>
              </div>
              <div className={`card ${styles.total}`}>
                <span className={styles.totalLabel}>Enquiries</span>
                <strong className={styles.totalValue}>{analytics.totals.enquiries}</strong>
                <span className={styles.totalHint}>WhatsApp and call taps, plus request forms sent</span>
              </div>
              <div className={`card ${styles.total}`}>
                <span className={styles.totalLabel}>From phones</span>
                <strong className={styles.totalValue}>{pct(analytics.totals.phoneShare)}</strong>
              </div>
              {(analytics.totals.orders > 0 || analytics.totals.bookings > 0) && (
                <div className={`card ${styles.total}`}>
                  <span className={styles.totalLabel}>Orders and bookings</span>
                  <strong className={styles.totalValue}>
                    {analytics.totals.orders} · {analytics.totals.bookings}
                  </strong>
                </div>
              )}
            </div>

            {analytics.totals.views === 0 ? (
              <div className={`card ${styles.empty}`}>No visits counted in the last {days} days yet. Share your storefront link and check back.</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Page</th>
                      <th scope="col" className={styles.num}>
                        Views
                      </th>
                      <th scope="col" className={styles.num}>
                        Main button taps
                      </th>
                      <th scope="col" className={styles.num}>
                        Enquiries
                      </th>
                      <th scope="col" className={styles.num}>
                        From phones
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.pages.map((row) => (
                      <tr key={row.id} className={row.live ? "" : styles.notLive}>
                        <td>
                          <span className={styles.pageTitle}>{row.title}</span>
                          <span className={styles.pagePath}>{row.path}</span>
                          {!row.live && <span className={styles.badge}>not showing now</span>}
                        </td>
                        <td className={styles.num}>{row.views}</td>
                        <td className={styles.num}>{row.primaryTaps}</td>
                        <td className={styles.num}>{row.enquiries}</td>
                        <td className={styles.num}>{pct(row.phoneShare)}</td>
                      </tr>
                    ))}
                    {analytics.otherViews > 0 && (
                      <tr className={styles.notLive}>
                        <td>
                          <span className={styles.pageTitle}>Pages you&apos;ve since renamed or removed</span>
                        </td>
                        <td className={styles.num}>{analytics.otherViews}</td>
                        <td className={styles.num}>—</td>
                        <td className={styles.num}>—</td>
                        <td className={styles.num}>—</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {insights && insights.enoughData && insights.insights.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>What stands out</h2>
                <ul className={styles.insights}>
                  {insights.insights.map((i) => (
                    <li key={i.key}>{i.text}</li>
                  ))}
                </ul>
              </section>
            )}
            <p className={styles.hint}>
              Visitors who ask not to be tracked aren&apos;t counted. Your own previews aren&apos;t counted either.{" "}
              <Link href="/dashboard/storefront/pages">Change your pages →</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
