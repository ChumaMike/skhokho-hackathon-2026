import Link from "next/link";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { businessMetrics, commerceMetrics, configStatus, databaseHealth, deliveryMetrics, securityMetrics, systemMetrics } from "@/modules/platform-admin/metrics";
import { evaluateAlerts } from "@/modules/platform-admin/alerts";
import { readinessSummary } from "@/modules/platform-admin/merchant-readiness";
import { orderAttentionCounts } from "@/modules/platform-admin/order-attention";
import { can } from "@/modules/platform-admin/permissions";
import { prisma } from "@/lib/prisma/client";
import { formatCents } from "@/lib/utils";
import { Badge, PageHeader, Section, Stats, Table } from "./ui";

export const dynamic = "force-dynamic";

/** Operational overview — real data, cheap time-bounded queries (metrics.ts). */
export default async function AdminOverviewPage() {
  const admin = await adminPage("overview");
  const [business, commerce, delivery, security, system, db, lastDaily, readiness, attention] = await Promise.all([
    businessMetrics(),
    commerceMetrics(),
    deliveryMetrics(),
    securityMetrics(),
    systemMetrics(),
    databaseHealth(),
    prisma.jobRun.findFirst({ where: { job: { startsWith: "daily." }, ok: true }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    readinessSummary(),
    orderAttentionCounts(),
  ]);
  const config = configStatus();
  const alerts = evaluateAlerts({ db, lastDailyRun: lastDaily?.startedAt ?? null, config, commerce, delivery, security, system, orders: attention });
  const showSecurity = can(admin.role, "security.view");
  const tone = (n: number) => (n > 0 ? ("warn" as const) : undefined);

  return (
    <>
      <PageHeader title="Overview" sub="Live figures. Today means since midnight (SAST)." />

      <Section title={`Alerts (${alerts.length})`}>
        <Table
          head={["Severity", "What", "First action", ""]}
          rows={alerts.map((a) => [<Badge key="s" tone={a.severity === "MEDIUM" ? "warn" : "bad"}>{a.severity}</Badge>, a.message, a.firstAction, <Link key="l" href={a.href}>Open →</Link>])}
          empty="No active alerts."
        />
        <p style={{ marginTop: 8, opacity: 0.75 }}>Thresholds and escalation: docs/alerts.md.</p>
      </Section>

      <Section title="Businesses">
        <Stats
          items={[
            { label: "Total", value: business.total },
            { label: "Active", value: business.byStatus.ACTIVE ?? 0 },
            { label: "Pending verification", value: business.byStatus.PENDING_VERIFICATION ?? 0 },
            { label: "Suspended", value: business.byStatus.SUSPENDED ?? 0, tone: tone(business.byStatus.SUSPENDED ?? 0) },
            { label: "Ready to trade", value: readiness.readyToTrade, tone: "ok" },
            { label: "Still setting up", value: readiness.notReady, tone: tone(readiness.notReady) },
            { label: "On trial", value: business.trials },
            { label: "Paid accounts", value: business.paid },
          ]}
        />
        <p style={{ opacity: 0.75 }}>
          Readiness is derived from each business&apos;s own settings and rows (products, hours, fulfilment, areas, payment connection) — see the Readiness column in{" "}
          <Link href="/platform-admin/businesses">Businesses</Link>.
        </p>
        <Table head={["Plan", "Businesses"]} rows={Object.entries(business.planDistribution).map(([k, v]) => [k, v])} empty="No subscriptions yet." />
      </Section>

      <Section title="Commerce">
        <Stats
          items={[
            { label: "Orders today", value: commerce.ordersToday },
            { label: "Completed today", value: commerce.completedToday },
            { label: "Cancelled today", value: commerce.cancelledToday, tone: tone(commerce.cancelledToday) },
            { label: "Awaiting merchant action", value: commerce.awaitingMerchant, tone: tone(commerce.awaitingMerchant) },
            { label: "Needing attention", value: attention.total, tone: tone(attention.total) },
            { label: "GMV today (paid)", value: formatCents(commerce.gmvTodayCents) },
            { label: "Average paid order", value: formatCents(commerce.averageOrderCents) },
            { label: "Payments OK (24h)", value: commerce.paymentsLast24h.succeeded, tone: "ok" },
            { label: "Payments failed (24h)", value: commerce.paymentsLast24h.failed, tone: tone(commerce.paymentsLast24h.failed) },
            { label: "Payment success (24h)", value: commerce.paymentsLast24h.successRate === null ? "—" : `${Math.round(commerce.paymentsLast24h.successRate * 100)}%` },
            { label: "Refund due (24h)", value: commerce.paymentsLast24h.refundDue, tone: tone(commerce.paymentsLast24h.refundDue) },
          ]}
        />
        <p style={{ opacity: 0.75 }}>
          <Link href="/platform-admin/orders?view=attention">Orders needing attention →</Link> (paid but unconfirmed, ready with no driver, stuck, very old)
        </p>
      </Section>

      <Section title="Skhokholetha">
        <Stats
          items={[
            { label: "Drivers to review", value: delivery.drivers.pending, tone: tone(delivery.drivers.pending) },
            { label: "Approved drivers", value: delivery.drivers.approved },
            { label: "Online", value: delivery.drivers.online, tone: "ok" },
            { label: "Busy", value: delivery.drivers.busy },
            { label: "Active deliveries", value: delivery.deliveries.active },
            { label: "Looking for a driver", value: delivery.deliveries.searching },
            { label: "Late (>90 min)", value: delivery.deliveries.late, tone: tone(delivery.deliveries.late) },
            { label: "Failed / returned (7d)", value: delivery.deliveries.failedLast7d, tone: tone(delivery.deliveries.failedLast7d) },
            { label: "Disputed", value: delivery.deliveries.disputed, tone: tone(delivery.deliveries.disputed) },
            { label: "Median to assign (24h)", value: delivery.latency.medianSecondsToAssignment === null ? "—" : `${Math.round(delivery.latency.medianSecondsToAssignment / 60)} min` },
          ]}
        />
        <p style={{ opacity: 0.75 }}>
          Switches: network {config.skhokholetha.network ? "on" : "off"} · sign-up {config.skhokholetha.driverSignup ? "on" : "off"} · requests{" "}
          {config.skhokholetha.deliveryRequests ? "on" : "off"} · approvals {config.skhokholetha.driverApprovals ? "on" : "off"} · legal documents{" "}
          {config.skhokholetha.legalConfigured ? "configured" : "NOT configured"}
        </p>
      </Section>

      <Section title="Platform health">
        <Stats
          items={[
            { label: "Database", value: db.up ? `up · ${db.ms} ms` : "DOWN", tone: db.up ? "ok" : "bad" },
            { label: "Last daily job", value: lastDaily ? lastDaily.startedAt.toLocaleString("en-ZA", { dateStyle: "short", timeStyle: "short" }) : "never", tone: lastDaily ? undefined : "warn" },
            { label: "Email", value: config.email ? "configured" : "off", tone: config.email ? "ok" : "warn" },
            { label: "Live payments", value: config.livePaymentVerification ? "on" : "off" },
            { label: "Job failures (24h)", value: system.jobFailures, tone: tone(system.jobFailures) },
            { label: "Email failures (24h)", value: system.emailFailures, tone: tone(system.emailFailures) },
            { label: "Dispatch failures (24h)", value: system.dispatchFailures, tone: tone(system.dispatchFailures) },
            { label: "Payment processing failures (24h)", value: system.paymentProcessingFailures, tone: tone(system.paymentProcessingFailures) },
          ]}
        />
        <Link href="/platform-admin/health">Full system health →</Link>
      </Section>

      {showSecurity && (
        <Section title="Security (24h)">
          <Stats
            items={[
              { label: "Failed admin logins", value: security.last24h.admin_login_failed ?? 0, tone: tone(security.last24h.admin_login_failed ?? 0) },
              { label: "Failed MFA", value: security.last24h.admin_mfa_failed ?? 0, tone: tone(security.last24h.admin_mfa_failed ?? 0) },
              { label: "Authorization denials", value: (security.last24h.admin_permission_denied ?? 0) + (security.last24h.staff_permission_denied ?? 0) + (security.last24h.session_type_mismatch ?? 0) },
              { label: "Rate-limit trips", value: security.last24h.rate_limit_triggered ?? 0 },
              { label: "Webhook rejections", value: security.last24h.payment_webhook_rejected ?? 0 },
              { label: "Privileged admin actions", value: security.adminActionsLast24h },
            ]}
          />
          <Link href="/platform-admin/security">Security log →</Link>
        </Section>
      )}
    </>
  );
}
