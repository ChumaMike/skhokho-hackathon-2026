/**
 * Funding-Readiness Report — one page an owner prints, or saves as PDF, and
 * hands to a lender, a funder, a landlord or a supplier asking for terms.
 *
 * Light-on-white rather than the console's dark palette, like the invoice
 * page: this surface is paper. No PDF library — the browser's own print-to-PDF
 * makes a better document than a hand-rolled renderer and adds no dependency.
 *
 * Every figure comes with the sum that produced it, because the reader is
 * deciding whether to put money behind this shop and must be able to check the
 * arithmetic. Nothing here is a credit score, a rating or a recommendation to
 * lend, and the page says so in as many words.
 */

import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { getBusinessEntitlements } from "@/modules/billing/subscription.service";
import { forecastAccess } from "@/modules/analytics/forecast-access";
import { getFundingReadiness } from "@/modules/analytics/funding-readiness.service";
import { monthLabel, type FundingReadiness } from "@/modules/analytics/funding-readiness";
import DashboardNav from "@/components/DashboardNav";
import styles from "./funding.module.css";

export const dynamic = "force-dynamic";

const BAND_LABEL: Record<FundingReadiness["consistency"]["band"], string> = {
  "too early": "Too early to score",
  uneven: "Uneven",
  fair: "Fair",
  strong: "Strong",
};

const CONFIDENCE_LABEL: Record<FundingReadiness["forecast"]["confidence"], string> = {
  none: "no trading history",
  thin: "a few days of trading",
  fair: "a few weeks of trading",
  good: "a month or more of trading",
};

function longDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function FundingReadinessPage() {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);

  let permitted = true;
  try {
    await requireStaffPermission("canViewAnalytics");
  } catch {
    permitted = false;
  }

  // The full report is the longer-history capability (GROW and PRO); the
  // forecast page itself only needs the sales overview. No new plan key: this
  // is `advanced_analytics`, which already means "more than the recent
  // picture" everywhere else in the app. The decision is shared by all three
  // pages of this feature — see forecast-access.ts.
  const entitlements = await getBusinessEntitlements(session.tenantId);
  const access = forecastAccess({ permissions: workspaceContext.permissions, entitlements });

  if (!permitted || !access.fullReport) {
    return (
      <main className="shell">
        <div className="column">
          <span className="eyebrow">Skhokho</span>
          <h1 className={styles.blockedTitle}>Funding-readiness report</h1>
          <DashboardNav current="analytics" {...workspaceContext} />
          <div className={`card ${styles.blocked}`}>
            {!permitted || access.reportBlockedBy === "permission" ? (
              <p>Your role doesn&apos;t have permission to view analytics — ask the business owner.</p>
            ) : (
              <p>
                The funding-readiness report comes with the longer sales history
                {entitlements.planName ? `, which isn't on your plan (${entitlements.planName})` : ", which isn't on your plan"}. Your
                cash-flow forecast and sales summary are still on{" "}
                <Link href="/dashboard/analytics/forecast">the forecast page</Link>.
              </p>
            )}
          </div>
        </div>
      </main>
    );
  }

  const report = await getFundingReadiness(session.tenantId);
  if (!report) {
    return (
      <main className="shell">
        <div className="column">
          <div className={`card ${styles.blocked}`}>
            <p>We couldn&apos;t load your business details. Try again in a moment.</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.noPrint}>
        <Link href="/dashboard/analytics/forecast">&larr; Back to the forecast</Link>
        <p className={styles.printHint}>
          Print this page, or choose &ldquo;Save as PDF&rdquo; in your print options, to send it to a lender or a supplier.
        </p>
      </div>

      <article className={styles.doc}>
        <header className={styles.head}>
          <div>
            <h1 className={styles.title}>Funding-readiness report</h1>
            <p className={styles.business}>{report.businessName}</p>
          </div>
          <div className={styles.headMeta}>
            <p>Prepared {longDate(report.preparedOn)}</p>
            <p>Trading on Skhokho since {longDate(report.tradingSince)}</p>
          </div>
        </header>

        <section className={styles.figures} aria-label="The figures">
          <Figure label="Months trading" value={report.monthsTradingDisplay} note="since the first paid order on Skhokho" />
          <Figure label="Paid orders" value={String(report.paidOrders)} note="orders paid for, cancelled and refunded excluded" />
          <Figure label="Revenue" value={report.revenueTotalDisplay} note="all paid orders, whole history" />
          <Figure
            label="Average order"
            value={report.averageOrderDisplay}
            note={`revenue / ${report.paidOrders} paid ${report.paidOrders === 1 ? "order" : "orders"}`}
          />
          <Figure
            label="Repeat customers"
            value={report.repeatCustomers.rateDisplay}
            note={`${report.repeatCustomers.repeat} of ${report.repeatCustomers.withOrders} paying customers ordered again`}
          />
          <Figure
            label="Consistency"
            value={report.consistency.band === "too early" ? "—" : `${report.consistency.score} / 100`}
            note={BAND_LABEL[report.consistency.band]}
          />
        </section>

        <section className={styles.block} aria-labelledby="revenue-heading">
          <h2 id="revenue-heading" className={styles.blockTitle}>
            Revenue, month by month
          </h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Paid orders</th>
                <th scope="col">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {report.months.length === 0 ? (
                <tr>
                  <td colSpan={3}>No paid orders yet.</td>
                </tr>
              ) : (
                report.months.map((month) => (
                  <tr key={month.month}>
                    <th scope="row">
                      {monthLabel(month.month)}
                      {month.partial ? <span className={styles.tag}> so far</span> : null}
                    </th>
                    <td>{month.orders}</td>
                    <td>{month.display}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <p className={styles.note}>
            {report.revenueTrend.monthOnMonth
              ? `${report.revenueTrend.monthOnMonth.to} was ${
                  report.revenueTrend.monthOnMonth.direction === "flat"
                    ? "level with"
                    : `${report.revenueTrend.monthOnMonth.changeDisplay} ${report.revenueTrend.monthOnMonth.direction} on`
                } ${report.revenueTrend.monthOnMonth.from}. `
              : "There are not two whole months to compare yet. "}
            {report.revenueTrend.weekDirection === "flat"
              ? "Week to week the takings have been level."
              : `Week to week the takings have been ${report.revenueTrend.weekDirection === "up" ? "climbing" : "slipping"} by about ${report.revenueTrend.weekChangeDisplay}.`}
          </p>
        </section>

        <section className={styles.block} aria-labelledby="consistency-heading">
          <h2 id="consistency-heading" className={styles.blockTitle}>
            Consistency score, and how it is worked out
          </h2>
          <ol className={styles.formulaList}>
            {report.consistency.formula.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </section>

        <section className={styles.block} aria-labelledby="forecast-heading">
          <h2 id="forecast-heading" className={styles.blockTitle}>
            What the next four weeks look like
          </h2>
          <p className={styles.lead}>
            Next week about {report.forecast.nextWeekDisplay}; the four weeks after today about {report.forecast.fourWeekDisplay}.
          </p>
          <p className={styles.note}>
            Worked out from this business&apos;s own paid orders — a day-of-week average with a straight-line trend through the weekly
            totals, held to 50% up or down. Built on {CONFIDENCE_LABEL[report.forecast.confidence]}. A forecast is an estimate, not a
            promise.
          </p>
        </section>

        <section className={styles.block} aria-labelledby="summary-heading">
          <h2 id="summary-heading" className={styles.blockTitle}>
            In short
          </h2>
          <ul className={styles.noteList}>
            {report.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>

        <footer className={styles.foot}>
          <p>
            Produced by Skhokho from {report.businessName}&apos;s own order records on {longDate(report.preparedOn)}. Figures cover paid
            orders placed through Skhokho only; cash taken outside Skhokho is not included. This report has not been audited, and it is
            not a credit score, a rating or a recommendation to lend.
          </p>
        </footer>
      </article>
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className={styles.figure}>
      <p className={styles.figureLabel}>{label}</p>
      <p className={styles.figureValue}>{value}</p>
      <p className={styles.figureNote}>{note}</p>
    </div>
  );
}
