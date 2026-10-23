/**
 * Dashboard > Analytics > Forecast — the next four weeks of takings.
 *
 * Reads only. The arithmetic is in `@/modules/analytics/forecast` (pure, tested
 * against fixtures) and the wording is the Business Buddy's own rules-first
 * explanation, so the page and the buddy never tell an owner two different
 * things about the same numbers.
 *
 * The chart is hand-rolled CSS bars, the same choice the Analytics overview
 * made: eight weekly figures do not need a charting library, and adding one
 * would be the only dependency on this page.
 */

import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { getBusinessEntitlements } from "@/modules/billing/subscription.service";
import { forecastAccess, FULL_REPORT_CONTENTS } from "@/modules/analytics/forecast-access";
import { getSalesForecast } from "@/modules/analytics/forecast.service";
import { explainForecast } from "@/modules/analytics/forecast-advice";
import type { SalesForecast } from "@/modules/analytics/forecast";
import DashboardNav from "@/components/DashboardNav";
import styles from "./forecast.module.css";

export const dynamic = "force-dynamic";

/** `19 Nov` — the short form the rest of the dashboard uses. */
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-ZA", { day: "numeric", month: "short", timeZone: "UTC" });
}

const CONFIDENCE_LABEL: Record<SalesForecast["confidence"], string> = {
  none: "No history yet",
  thin: "Early days",
  fair: "Taking shape",
  good: "Steady enough to plan on",
};

export default async function ForecastPage() {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);

  let permitted = true;
  try {
    await requireStaffPermission("canViewAnalytics");
  } catch {
    permitted = false;
  }

  // Permission is about the PERSON; the plan is about the BUSINESS. Both have
  // to hold, and the page says which one is missing. The policy itself lives
  // in forecast-access.ts, which all three pages of this feature share; the
  // requireStaffPermission call above stays as the independent check.
  const entitlements = await getBusinessEntitlements(session.tenantId);
  const access = forecastAccess({ permissions: workspaceContext.permissions, entitlements });

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>Cash-flow forecast</h1>
        <p className={styles.lede}>What your next four weeks look like, worked out from your own paid orders.</p>

        <DashboardNav current="analytics" {...workspaceContext} />

        <p className={styles.breadcrumb}>
          <Link href="/dashboard/analytics">&larr; Back to Analytics</Link>
        </p>

        {!permitted || access.forecastBlockedBy === "permission" ? (
          <div className={`card ${styles.upgrade}`}>
            <p>Your role doesn&apos;t have permission to view analytics — ask the business owner.</p>
          </div>
        ) : !access.forecast ? (
          <div className={`card ${styles.upgrade}`}>
            <p>
              The cash-flow forecast comes with the sales overview, which isn&apos;t included in your plan
              {entitlements.planName ? ` (${entitlements.planName})` : ""}.
            </p>
          </div>
        ) : (
          <ForecastView
            businessId={session.tenantId}
            canFullReport={access.fullReport}
            canWinBack={access.winBack}
            planName={entitlements.planName}
          />
        )}
      </div>
    </main>
  );
}

async function ForecastView({
  businessId,
  canFullReport,
  canWinBack,
  planName,
}: {
  businessId: string;
  canFullReport: boolean;
  canWinBack: boolean;
  planName: string | null;
}) {
  const forecast = await getSalesForecast(businessId);

  if (forecast.confidence === "none") {
    return (
      <div className={`card ${styles.upgrade}`}>
        <p>
          There are no paid orders yet, so there is nothing to forecast. Take a few orders and this page starts filling
          itself in.
        </p>
      </div>
    );
  }

  const nextWeek = forecast.weeks[0]!;
  const lastWeek = forecast.weeks[forecast.weeks.length - 1]!;

  return (
    <>
      <div className={styles.statGrid}>
        <div className={`card ${styles.statTile}`}>
          <p className={styles.statNumber}>{nextWeek.display}</p>
          <p className={styles.statLabel}>
            next week, {shortDate(nextWeek.weekStart)} to {shortDate(nextWeek.weekEnd)}
          </p>
        </div>
        <div className={`card ${styles.statTile}`}>
          <p className={styles.statNumber}>{forecast.totalDisplay}</p>
          <p className={styles.statLabel}>next four weeks, to {shortDate(lastWeek.weekEnd)}</p>
        </div>
        <div className={`card ${styles.statTile}`}>
          <p className={styles.statNumber}>
            {forecast.trend.direction === "flat" ? "Steady" : `${forecast.trend.direction === "up" ? "+" : "−"}${forecast.trend.perWeekDisplay}`}
          </p>
          <p className={styles.statLabel}>{forecast.trend.direction === "flat" ? "week on week" : "a week, week on week"}</p>
        </div>
        <div className={`card ${styles.statTile}`}>
          <p className={styles.statNumber}>{forecast.history.completeWeeks}</p>
          <p className={styles.statLabel}>full weeks behind it — {CONFIDENCE_LABEL[forecast.confidence]}</p>
        </div>
      </div>

      <BuddyExplanation forecast={forecast} />
      <WeeklyChart forecast={forecast} />
      <DailyTable forecast={forecast} />
      {canFullReport && (
        <Link href="/dashboard/analytics/forecast/funding" className={`card ${styles.reportLink}`}>
          <span className={styles.reportLinkTitle}>Funding-readiness report &rarr;</span>
          <span className={styles.reportLinkBody}>
            One page you can print or save as PDF for a lender, a supplier or a landlord: months trading, revenue, average
            order, repeat customers and how steady your weeks have been.
          </span>
        </Link>
      )}
      {canWinBack && (
        <Link href="/dashboard/analytics/forecast/win-back" className={`card ${styles.reportLink}`}>
          <span className={styles.reportLinkTitle}>Who to win back &rarr;</span>
          <span className={styles.reportLinkBody}>
            Customers whose own ordering pattern says they are slipping away, with a message ready to send.
          </span>
        </Link>
      )}
      {!canFullReport && <FullReportSummary planName={planName} />}
      <MethodCard forecast={forecast} />
    </>
  );
}

/**
 * The Business Buddy's own words, from the rules-first path — the same
 * sentences it gives in the chat when asked what next week looks like. No
 * outside AI service is involved, and the page says so rather than leaving an
 * owner to assume their numbers were sent somewhere.
 */
function BuddyExplanation({ forecast }: { forecast: SalesForecast }) {
  const lines = explainForecast(forecast);
  return (
    <section className={`card ${styles.buddyCard}`} aria-labelledby="buddy-heading">
      <p id="buddy-heading" className={styles.buddyTitle}>
        Business Buddy
      </p>
      <ul className={styles.buddyList}>
        {lines.map((line) => (
          <li key={line} className={styles.buddyLine}>
            {line}
          </li>
        ))}
      </ul>
      <p className={styles.hint}>
        Worked out from your own orders by Skhokho&apos;s built-in rules — no outside AI service sees your data.
      </p>
    </section>
  );
}

/**
 * Four weeks of what actually happened, then four weeks of what is forecast,
 * on one scale. Shown as a table to a screen reader (the same numbers appear
 * in the day-by-day table below), so the bars are decoration over real text.
 */
function WeeklyChart({ forecast }: { forecast: SalesForecast }) {
  const past = forecast.historyWeeks.slice(-4);
  const bars = [
    ...past.map((week) => ({ key: `past-${week.weekStart}`, label: shortDate(week.weekStart), cents: week.cents, display: week.display, forecast: false })),
    ...forecast.weeks.map((week) => ({ key: `next-${week.weekStart}`, label: shortDate(week.weekStart), cents: week.cents, display: week.display, forecast: true })),
  ];
  const max = Math.max(...bars.map((bar) => bar.cents), 1);

  return (
    <section className={`card ${styles.chartCard}`} aria-labelledby="chart-heading">
      <div className={styles.chartHeader}>
        <span id="chart-heading" className={styles.chartTitle}>
          Week by week
        </span>
        <span className={styles.chartHint}>
          {past.length > 0 ? "Solid = what you took · Outline = forecast" : "Forecast only — no full week behind it yet"}
        </span>
      </div>
      <div className={styles.bars}>
        {bars.map((bar) => (
          <div key={bar.key} className={styles.barCol}>
            <span className={styles.barValue}>{bar.display}</span>
            <div
              className={`${styles.bar} ${bar.forecast ? styles.barForecast : ""}`}
              style={{ height: `${Math.max(3, (bar.cents / max) * 100)}%` }}
            />
            <span className={styles.barLabel}>{bar.label}</span>
          </div>
        ))}
      </div>
      <p className={styles.hint}>Weeks run Monday to Sunday from the day after today. Paid orders only.</p>
    </section>
  );
}

function DailyTable({ forecast }: { forecast: SalesForecast }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className={styles.caption}>Day by day, {forecast.weeks.length} weeks ahead</caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">Mon</th>
            <th scope="col">Tue</th>
            <th scope="col">Wed</th>
            <th scope="col">Thu</th>
            <th scope="col">Fri</th>
            <th scope="col">Sat</th>
            <th scope="col">Sun</th>
            <th scope="col">Week</th>
          </tr>
        </thead>
        <tbody>
          {forecast.weeks.map((week) => {
            const byWeekday = new Map(week.days.map((day) => [day.weekday, day]));
            return (
              <tr key={week.weekStart}>
                <th scope="row">{shortDate(week.weekStart)}</th>
                {[1, 2, 3, 4, 5, 6, 0].map((weekday) => {
                  const day = byWeekday.get(weekday);
                  return (
                    <td key={weekday} className={day?.slow ? styles.slowCell : undefined}>
                      {day ? day.display : "—"}
                      {day?.slow ? <span className={styles.slowTag}> slow</span> : null}
                    </td>
                  );
                })}
                <td className={styles.weekTotal}>{week.display}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {forecast.slowWeekdays.length > 0 && (
        <p className={styles.hint}>
          Marked slow: {forecast.slowWeekdays.join(", ")} — under 60% of your average day.
        </p>
      )}
    </div>
  );
}

/**
 * What the longer sales history adds, for a business that doesn't have it.
 * Written as a plain list of what exists, not as a nag: the forecast on this
 * page is theirs and works, and the only honest thing to say about the rest is
 * what it is and which plans carry it.
 */
function FullReportSummary({ planName }: { planName: string | null }) {
  return (
    <section className={`card ${styles.summaryCard}`} aria-labelledby="full-report-summary">
      <p id="full-report-summary" className={styles.summaryTitle}>
        On Grow and Pro, this page also gives you
      </p>
      <ul className={styles.summaryList}>
        {FULL_REPORT_CONTENTS.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className={styles.hint}>
        Your forecast above is complete{planName ? ` on ${planName}` : ""} — nothing is held back from it.{" "}
        <Link href="/dashboard/settings/plan">See the plans</Link>
      </p>
    </section>
  );
}

function MethodCard({ forecast }: { forecast: SalesForecast }) {
  return (
    <section className={`card ${styles.methodCard}`} aria-labelledby="method-heading">
      <p id="method-heading" className={styles.methodTitle}>
        How this is worked out
      </p>
      <ol className={styles.methodList}>
        {forecast.method.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <p className={styles.hint}>
        Based on {forecast.history.daysCovered} days to {forecast.history.lastDate ? shortDate(forecast.history.lastDate) : "today"},
        in which you took {forecast.history.totalDisplay} across {forecast.history.tradingDays} trading{" "}
        {forecast.history.tradingDays === 1 ? "day" : "days"}. A forecast is an estimate, not a promise.
      </p>
    </section>
  );
}
