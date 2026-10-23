import Link from "next/link";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { prisma } from "@/lib/prisma/client";
import { commerceMetrics, configStatus, databaseHealth, deliveryMetrics, securityMetrics, systemMetrics } from "@/modules/platform-admin/metrics";
import { jobHealth } from "@/modules/platform-admin/jobs";
import { evaluateAlerts } from "@/modules/platform-admin/alerts";
import { Badge, KV, PageHeader, Section, Stats, Table, when } from "../ui";

export const dynamic = "force-dynamic";

/** System health. Configuration is shown as present/absent only — never a value. */
export default async function HealthPage() {
  await adminPage("health");
  const [db, jobs, system, delivery, commerce, security, recentFailures] = await Promise.all([
    databaseHealth(),
    jobHealth(),
    systemMetrics(),
    deliveryMetrics(),
    commerceMetrics(),
    securityMetrics(),
    prisma.platformAuditEvent.findMany({ where: { category: "SYSTEM", outcome: "FAILURE" }, orderBy: { createdAt: "desc" }, take: 30, select: { action: true, resourceId: true, metadata: true, createdAt: true } }),
  ]);
  const config = configStatus();
  const lastDaily = jobs.latest.filter((j) => j.job.startsWith("daily.") && j.ok).map((j) => j.started_at).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const alerts = evaluateAlerts({ db, lastDailyRun: lastDaily, config, commerce, delivery, security, system });
  const yes = (b: boolean) => <Badge tone={b ? "ok" : "warn"}>{b ? "yes" : "no"}</Badge>;

  return (
    <>
      <PageHeader title="System health" sub="Liveness: /api/health · readiness: /api/health/ready (both report up/down only)." />
      <Stats
        items={[
          { label: "Database", value: db.up ? `up · ${db.ms} ms` : "DOWN", tone: db.up ? "ok" : "bad" },
          { label: "Active alerts", value: alerts.length, tone: alerts.some((a) => a.severity === "CRITICAL") ? "bad" : alerts.length ? "warn" : "ok" },
          { label: "Job failures (24h)", value: jobs.failuresLast24h, tone: jobs.failuresLast24h ? "bad" : undefined },
          { label: "Email failures (24h)", value: system.emailFailures },
          { label: "Notification failures (24h)", value: system.notificationFailures },
          { label: "Webhook rejections (24h)", value: system.webhookRejections },
          { label: "Dispatch tick failures (24h)", value: system.dispatchFailures, tone: system.dispatchFailures ? "bad" : undefined },
          { label: "Payment processing failures (24h)", value: system.paymentProcessingFailures, tone: system.paymentProcessingFailures ? "bad" : undefined },
          { label: "Median to first offer (24h)", value: delivery.latency.medianSecondsToFirstOffer === null ? "—" : `${delivery.latency.medianSecondsToFirstOffer}s` },
          { label: "Median to assignment (24h)", value: delivery.latency.medianSecondsToAssignment === null ? "—" : `${delivery.latency.medianSecondsToAssignment}s` },
        ]}
      />
      <Section title="Alerts">
        <Table head={["Severity", "What", "First action", ""]} rows={alerts.map((a) => [<Badge key="s" tone={a.severity === "MEDIUM" ? "warn" : "bad"}>{a.severity}</Badge>, a.message, a.firstAction, <Link key="l" href={a.href}>Open →</Link>])} empty="No active alerts." />
      </Section>
      <Section title="Background jobs (latest run of each)">
        <Table
          head={["Job", "Last started", "Result", "Duration", "Error"]}
          rows={jobs.latest.map((j) => [j.job, when(j.started_at), j.ok === null ? <Badge key="r" tone="warn">running / unknown</Badge> : <Badge key="r" tone={j.ok ? "ok" : "bad"}>{j.ok ? "ok" : "failed"}</Badge>, j.duration_ms === null ? "—" : `${j.duration_ms} ms`, j.error ?? ""])}
          empty="No job has run yet (the daily cron records runs here)."
        />
      </Section>
      <Section title="Providers & configuration (present / absent)">
        <KV
          items={[
            ["Email (Resend)", yes(config.email)],
            ["Cron secret", yes(config.cronSecret)],
            ["Encryption key (payments, MFA, payouts)", yes(config.paymentsEncryptionKey)],
            ["Live payment verification", yes(config.livePaymentVerification)],
            ["Live merchant payment connections", system.paymentConnectionsLive],
            ["Platform billing (PayFast)", yes(config.platformBilling)],
            ["External AI", yes(config.externalAi)],
            ["Skhokholetha network / sign-up / requests / approvals", `${config.skhokholetha.network ? "on" : "off"} / ${config.skhokholetha.driverSignup ? "on" : "off"} / ${config.skhokholetha.deliveryRequests ? "on" : "off"} / ${config.skhokholetha.driverApprovals ? "on" : "off"}`],
            ["Driver legal documents", yes(config.skhokholetha.legalConfigured)],
          ]}
        />
      </Section>
      <Section title="Recent system failures">
        <Table head={["When", "What", "Subject", "Details"]} rows={recentFailures.map((f) => [when(f.createdAt), f.action, f.resourceId ?? "", f.metadata ? <code key="m" style={{ fontSize: "0.78rem" }}>{JSON.stringify(f.metadata)}</code> : ""])} empty="None recorded." />
      </Section>
    </>
  );
}
