import Link from "next/link";
import { prisma } from "@/lib/prisma/client";
import { listMembers } from "@/modules/customers/customer.service";
import { listOrders } from "@/modules/orders/order.service";
import { listUpcomingAppointments } from "@/modules/appointments/appointment.service";
import { getLowStockItems } from "@/modules/inventory/inventory.service";
import { listStaff } from "@/modules/staff/staff.service";
import { listDeliveriesForManagement } from "@/modules/orders/order-delivery.service";
import { requireOwnerSession, getStaffWorkspaceContext } from "./session";
import { getPublishReadiness } from "@/modules/tenant/tenant.service";
import { buildAttentionItems, type AttentionCounts, type AttentionItem } from "@/modules/dashboard/attention";
import { getHomeSections, computeLapsedRegulars } from "@/modules/dashboard/home-composition";
import { listRecentNotificationsFor, countUnreadNotificationsFor } from "@/modules/dashboard/notifications";
import { isEmailConfigured } from "@/lib/email";
import { formatZAR } from "@/lib/utils";
import DashboardNav from "@/components/DashboardNav";
import { ConnectedHome } from "@/components/connected-ui";
import type { Priority, Signal, Tone } from "@/components/connected-ui";
import PublicationStatus from "./PublicationStatus";
import QuickActions from "./QuickActions";
import ComingUp from "./ComingUp";
import RecentActivity from "./RecentActivity";
import InterviewGate from "./onboarding/InterviewGate";
import styles from "./dashboard.module.css";

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatSlot(date: Date): string {
  return date.toLocaleString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

/** "+3 vs last week" / "-2 vs last week" / "same as last week" — plain
 * English over a percentage, matching docs/DESIGN.md's copy voice, and no
 * chart: BusinessMetric is unpopulated, so a number with a delta is the
 * honest first step, not a graph implying a history that isn't tracked.
 *
 * A string rather than the old <Delta> element because a ConnectedHome
 * Signal takes `detail` as text; the wording is unchanged. */
function deltaLabel(current: number, previous: number): string {
  const diff = current - previous;
  if (diff === 0) return "same as last week";
  return `${diff > 0 ? "+" : ""}${diff} vs last week`;
}

/**
 * AttentionSeverity -> the Connected UI's chip vocabulary.
 *
 * `critical` exists on both sides, so a genuinely bad signal (failed
 * deliveries) keeps reading differently from a merely pending one. `info`
 * maps to `new` rather than `neutral` because everything buildAttentionItems
 * returns is actionable by definition — it is the "what needs you" list, not
 * a status readout.
 */
const TONE_BY_SEVERITY: Record<AttentionItem["severity"], Tone> = {
  info: "new",
  warning: "warning",
  critical: "critical",
};

/**
 * AttentionItem -> Priority. Deliberately a real adapter and not a spread:
 * the shapes genuinely differ (`label` vs `title`, `severity` vs `tone`), and
 * AttentionItem carries no description at all. `detail` is therefore left
 * undefined rather than filled with something invented to make the card look
 * fuller — the integration brief's own example sketches fields this codebase
 * does not have.
 */
function toPriority(item: AttentionItem): Priority {
  return {
    id: item.id,
    title: item.label,
    href: item.href,
    tone: TONE_BY_SEVERITY[item.severity],
  };
}

export default async function DashboardPage() {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const { capabilities, permissions, isOwner } = workspaceContext;
  const homeSections = getHomeSections(capabilities, permissions, isOwner);

  const business = await prisma.business.findUnique({
    where: { id: session.tenantId },
    select: { name: true, status: true, slug: true, logoUrl: true, primaryColor: true },
  });

  // Server Component under `force-dynamic`: runs once per request, so
  // Date.now() here isn't a stale-render risk the way it would be in a
  // memoized client render. react-hooks/purity's "impure during render"
  // concern is about client re-renders producing inconsistent output; a
  // per-request server render calling Date.now() once is the same thing as
  // a request handler reading the clock, not a hook-purity violation.
  // Bare disable (no rule name): the local eslint-plugin-react-hooks
  // version doesn't define this rule at all, while Vercel's fresh install
  // resolves a newer one that does and actually flags this line — a
  // rule-named disable comment errors in whichever environment doesn't
  // know the rule ("Definition for rule ... was not found"), so this has
  // to stay version-agnostic until the two environments' installs agree.
  // eslint-disable-next-line
  const now = Date.now();
  const nowDate = new Date(now);
  const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());

  const canDispatch = isOwner || permissions.canManageDeliveries;
  const showDeliverySignals = canDispatch && capabilities.has("DELIVERY");

  const emptyOrderList: Awaited<ReturnType<typeof listOrders>> = {
    orders: [],
    total: 0,
    page: 1,
    perPage: 0,
    totalPages: 0,
  };

  // Every fetch below is conditional on the composition rules in
  // home-composition.ts/attention.ts — a business without a given
  // capability (or a viewer without the matching permission) never queries
  // for data it wouldn't be allowed to show, not just hides it after the
  // fact.
  const [
    members,
    ordersToday,
    unpaidOrdersCount,
    pendingConfirmationCount,
    upcomingAppointments,
    lowStock,
    staff,
    deliveries,
    recentNotifications,
    unreadNotificationCount,
  ] = await Promise.all([
    listMembers(session.tenantId, { limit: 500 }),
    homeSections.showOrdersToday
      ? listOrders(session.tenantId, { dateFrom: startOfToday, perPage: 50 })
      : Promise.resolve(emptyOrderList),
    capabilities.has("ORDERS")
      ? listOrders(session.tenantId, { paymentStatus: "PENDING", perPage: 1 })
      : Promise.resolve(emptyOrderList),
    capabilities.has("ORDERS")
      ? listOrders(session.tenantId, { status: "PENDING", perPage: 1 })
      : Promise.resolve(emptyOrderList),
    homeSections.showBookingsToday
      ? listUpcomingAppointments(session.tenantId, { limit: 200 })
      : Promise.resolve([]),
    capabilities.has("INVENTORY") ? getLowStockItems(session.tenantId) : Promise.resolve([]),
    isOwner ? listStaff(session.tenantId) : Promise.resolve([]),
    showDeliverySignals ? listDeliveriesForManagement(session.tenantId) : Promise.resolve([]),
    // Every business writes to BusinessNotification (new orders/bookings/
    // reviews/low-stock) regardless of capabilities, so this is always
    // fetched — the guaranteed fallback when email isn't configured or fails.
    listRecentNotificationsFor(session.tenantId, session.staffId, { limit: 10 }),
    countUnreadNotificationsFor(session.tenantId, session.staffId),
  ]);

  // customer.service has no ready-made "seen this week" count — listMembers
  // is the closest fit, so the weekly figures are a simple last_seen filter
  // over its rows rather than a new query or business rule. Caveat: a
  // member active in both weeks only ever shows in the most recent bucket
  // (last_seen is a running max, not a per-week event log), so "last week"
  // slightly undercounts anyone still active now. Good enough for a first
  // trend indicator; the visits ledger would give an exact count if this
  // ever needs to be precise.
  const seenThisWeek = members.filter((m) => now - m.last_seen.getTime() <= WEEK_MS).length;
  const seenLastWeek = members.filter((m) => {
    const age = now - m.last_seen.getTime();
    return age > WEEK_MS && age <= 2 * WEEK_MS;
  }).length;

  const readiness = business?.status === "PENDING_VERIFICATION" ? await getPublishReadiness(session.tenantId) : null;

  // Caveat: ordersToday.orders is capped at 50 rows (see the fetch above) —
  // the headline count uses the real, uncapped `.total`, but the sales
  // figure and status breakdown below only sum what was actually fetched.
  // Fine for any realistic single-day order volume; flagged rather than
  // silently wrong if that ever changes.
  const todaysSalesTotal = ordersToday.orders.reduce((sum, o) => sum + Number(o.total), 0);
  const preparingCount = ordersToday.orders.filter((o) => o.status === "PROCESSING").length;
  const readyCount = ordersToday.orders.filter((o) => o.status === "READY").length;

  const bookingsToday = upcomingAppointments.filter((a) => isSameCalendarDay(a.startTime, nowDate)).length;
  const nextAppointment = upcomingAppointments[0];
  const bookingsAwaitingConfirmation = upcomingAppointments.filter((a) => a.status === "SCHEDULED").length;

  const pendingInvites = staff.filter((s) => s.resetToken && !s.isOwner).length;
  const deliveriesNeedingDriver = deliveries.filter((d) => d.status === "UNASSIGNED" && d.order.status === "READY").length;
  const deliveriesAssigned = deliveries.filter((d) => d.status === "ASSIGNED").length;
  const deliveriesOut = deliveries.filter((d) => d.status === "PICKED_UP").length;
  const deliveryProblems = deliveries.filter((d) => d.status === "FAILED").length;

  const attentionCounts: AttentionCounts = {
    unpaidOrders: unpaidOrdersCount.total,
    ordersAwaitingConfirmation: pendingConfirmationCount.total,
    bookingsAwaitingConfirmation,
    lowStockCount: lowStock.length,
    pendingStaffInvites: pendingInvites,
    deliveriesNeedingDriver,
    deliveriesOut,
    deliveryProblems,
  };
  const attentionItems = buildAttentionItems(attentionCounts, capabilities, permissions, isOwner);

  const happeningNowItems = [
    preparingCount > 0 && { id: "preparing", label: `${preparingCount} preparing` },
    readyCount > 0 && { id: "ready", label: `${readyCount} ready` },
    deliveriesAssigned > 0 && { id: "assigned", label: `${deliveriesAssigned} assigned` },
    deliveriesOut > 0 && { id: "out", label: `${deliveriesOut} out for delivery` },
  ].filter((item): item is { id: string; label: string } => item !== false);

  const lapsedRegulars = homeSections.showRetention ? computeLapsedRegulars(members) : 0;

  // The sales figure sums only the rows actually fetched, and that fetch is
  // capped at 50 (see the listOrders call above). Saying "R X today" when a
  // 51st order exists would be a quietly wrong number on the owner's home
  // screen, so the label tells the truth about what it covers.
  const salesIsComplete = ordersToday.orders.length >= ordersToday.total;
  const salesDetail = salesIsComplete
    ? `${formatZAR(todaysSalesTotal)} today`
    : `${formatZAR(todaysSalesTotal)} from the first ${ordersToday.orders.length}`;

  const signals: Signal[] = [
    ...(homeSections.showOrdersToday
      ? [{
          label: ordersToday.total === 1 ? "order today" : "orders today",
          value: String(ordersToday.total),
          detail: ordersToday.total > 0 ? salesDetail : undefined,
        }]
      : []),
    ...(homeSections.showBookingsToday
      ? [{
          label: bookingsToday === 1 ? "booking today" : "bookings today",
          value: String(bookingsToday),
          detail: nextAppointment
            ? `Next: ${nextAppointment.membership?.displayName || "Customer"} · ${formatSlot(nextAppointment.startTime)}` +
              (nextAppointment.service?.name ? ` · ${nextAppointment.service.name}` : "")
            : undefined,
        }]
      : []),
    {
      label: "customers seen this week",
      value: String(seenThisWeek),
      detail: deltaLabel(seenThisWeek, seenLastWeek),
    },
  ];

  return (
    // `div`, not `main`: ConnectedHome renders the page's <main> itself, and
    // nesting one inside another is invalid. `.shell` is a layout/theme class,
    // not an element, so the console's warm palette still applies.
    <div className="shell">
      <div className="consoleChrome">
        <div className={styles.header}>
          <div className={styles.headerBrand}>
            {business?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={business.logoUrl} alt="" className={styles.headerLogo} />
            ) : (
              <div className={styles.headerLogoFallback} style={{ background: business?.primaryColor || "var(--amber)" }}>
                {(business?.name ?? "?").charAt(0).toUpperCase()}
              </div>
            )}
            <span className="eyebrow">Skhokho</span>
          </div>
          <div className={styles.headerActions}>
            {isOwner && (
              <Link href="/dashboard/staff" className={styles.headerLink}>
                Team
              </Link>
            )}
            <form action="/api/platform/logout" method="post">
              <button type="submit" className={styles.logout}>
                Log out
              </button>
            </form>
          </div>
        </div>

        {business?.status && (
          <PublicationStatus status={business.status} missing={readiness?.missing ?? []} slug={business.slug} />
        )}

        {/* No self-serve fix exists for this (it's an env var, not a dashboard
            setting) — honest disclosure plus a pointer at the guaranteed
            fallback (Recent Activity below), not a fake "set it up" button. */}
        {isOwner && !isEmailConfigured() && (
          <div className={`${styles.pubStatus} ${styles.pubStatusDraft}`}>
            <span className={styles.pubDot} />
            <div className={styles.pubBody}>
              <p className={styles.pubTitle}>Email alerts aren&apos;t set up.</p>
              <p className={styles.pubSub}>
                You won&apos;t be emailed when a new order comes in — check Recent Activity below instead, or
                contact support to enable email.
              </p>
            </div>
          </div>
        )}

        {/* The onboarding interview - opens by itself for a business that has
            just registered. Gated on the same permission the action behind it
            checks (canManageSettings), so a cashier signing in is never asked
            to describe the whole business; the gate itself then decides
            dialog vs. card vs. nothing. */}
        {(isOwner || permissions.canManageSettings) && <InterviewGate businessId={session.tenantId} />}

        <DashboardNav current="home" {...workspaceContext} />
      </div>

      <div className={`consoleCanvas ${styles.homeCanvas}`}>
        <ConnectedHome
          model={{
            greeting: business?.name ?? "Your business",
            // No time-of-day greeting: this renders on the server, which has
            // no idea whether it is morning where the owner is standing.
            intro: "Here's what's happening — and what needs you.",
            signals,
            // NeedsAttention's list is now ConnectedHome's priorities, from the
            // same buildAttentionItems call — one source, rendered once.
            priorities: attentionItems.map(toPriority),
            storefrontHref: business?.slug ? `/store/${business.slug}` : undefined,
            storefrontEditorHref: "/dashboard/storefront",
            children: (
              <>
                {homeSections.showOrdersToday && ordersToday.total === 0 && (
                  <div className={`card ${styles.emptyState}`}>
                    <p>No orders yet today.</p>
                    {business?.slug && (
                      <Link href={`/store/${business.slug}`} className={styles.emptyStateLink}>
                        Share your store
                      </Link>
                    )}
                  </div>
                )}

                {homeSections.showBookingsToday && bookingsToday === 0 && upcomingAppointments.length === 0 && (
                  <div className={`card ${styles.emptyState}`}>
                    <p>No bookings today.</p>
                    {business?.slug && (
                      <Link href={`/store/${business.slug}`} className={styles.emptyStateLink}>
                        Share your booking link
                      </Link>
                    )}
                  </div>
                )}

                {members.length === 0 && (
                  <div className={`card ${styles.emptyState}`}>
                    <p>Your first customer will appear here.</p>
                    {business?.slug && (
                      <Link href={`/r/${business.slug}`} className={styles.emptyStateLink}>
                        Open customer signup
                      </Link>
                    )}
                  </div>
                )}

                {homeSections.showHappeningNow && happeningNowItems.length > 0 && (
                  <section className={styles.happeningNow}>
                    <h2 className={styles.attentionTitle}>Happening now</h2>
                    <ul className={styles.happeningNowList}>
                      {happeningNowItems.map((item) => (
                        <li key={item.id} className={styles.happeningNowItem}>
                          {item.label}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <QuickActions capabilities={capabilities} permissions={permissions} isOwner={isOwner} />

                {homeSections.showBookingsToday && <ComingUp appointments={upcomingAppointments} />}

                <RecentActivity items={recentNotifications} unreadCount={unreadNotificationCount} />

                {homeSections.showRetention && lapsedRegulars > 0 && (
                  <section className={styles.retention}>
                    <h2 className={styles.attentionTitle}>Customer retention</h2>
                    <Link href="/dashboard/customers?view=lapsed" className={styles.retentionCard}>
                      {lapsedRegulars} {lapsedRegulars === 1 ? "regular hasn't" : "regulars haven't"} returned in 30+ days
                    </Link>
                  </section>
                )}
              </>
            ),
          }}
        />
      </div>

      <div className="bottomBar">
        <div className="bottomBarInner">
          <Link href="/dashboard/customers" className="btn btnPrimary btnBlock">
            See your customers
          </Link>
        </div>
      </div>
    </div>
  );
}
