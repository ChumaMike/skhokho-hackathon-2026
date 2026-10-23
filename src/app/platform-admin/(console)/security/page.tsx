import Link from "next/link";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { prisma } from "@/lib/prisma/client";
import { SECURITY_ACTIONS, securityMetrics } from "@/modules/platform-admin/metrics";
import { Badge, PageHeader, Section, Stats, Table, when } from "../ui";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  admin_login_failed: "Failed admin logins",
  admin_mfa_failed: "Failed MFA",
  admin_mfa_rate_limited: "MFA rate-limited",
  admin_permission_denied: "Admin permission denied",
  staff_permission_denied: "Staff permission denied",
  session_type_mismatch: "Wrong session type",
  rate_limit_triggered: "Rate-limit trips",
  payment_webhook_rejected: "Rejected payment webhooks",
  delivery_code_locked: "Delivery codes locked",
};
const PRIVILEGED = ["driver_suspended", "driver_reinstated", "driver_approved", "payout_created", "payout_marked_paid", "payout_marked_failed", "ledger_adjustment_added", "admin_mfa_reset", "admin_role_changed", "business_suspended", "business_reactivated", "driver_document_downloaded", "delivery_cancelled_by_admin"];

/**
 * Security operations: counts for the last 24h and the latest events. Data
 * minimisation: IPs are hashed, subjects (emails, identifiers) appear only as
 * short one-way hashes; no request bodies.
 */
export default async function SecurityPage() {
  await adminPage("security.view");
  const [m, recent, privileged] = await Promise.all([
    securityMetrics(),
    prisma.platformAuditEvent.findMany({ where: { category: "SECURITY" }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, action: true, outcome: true, actorType: true, actorId: true, metadata: true, ipHash: true, createdAt: true } }),
    prisma.platformAuditEvent.findMany({ where: { category: "ADMIN_ACTION", action: { in: PRIVILEGED } }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, action: true, actorId: true, resourceType: true, resourceId: true, reason: true, createdAt: true } }),
  ]);
  return (
    <>
      <PageHeader title="Security" sub="Last 24 hours, plus the latest events. Full history: Audit log." />
      <Stats items={[...SECURITY_ACTIONS.map((a) => ({ label: LABELS[a] ?? a, value: m.last24h[a] ?? 0, tone: (m.last24h[a] ?? 0) > 0 ? ("warn" as const) : undefined })), { label: "Privileged admin actions", value: m.adminActionsLast24h }]} />
      <Section title="Latest security events">
        <Table
          head={["When", "Event", "Outcome", "Actor", "Details", "Source (hashed IP)"]}
          rows={recent.map((e) => [
            when(e.createdAt),
            LABELS[e.action] ?? e.action,
            <Badge key="o" tone={e.outcome === "SUCCESS" ? "ok" : "bad"}>{e.outcome.toLowerCase()}</Badge>,
            `${e.actorType}${e.actorId ? ` ${e.actorId.slice(0, 10)}` : ""}`,
            e.metadata ? <code key="m" style={{ fontSize: "0.78rem" }}>{JSON.stringify(e.metadata)}</code> : "",
            e.ipHash ? e.ipHash.slice(0, 10) : "",
          ])}
          empty="No security events."
        />
      </Section>
      <Section title="Privileged admin actions">
        <Table head={["When", "Action", "Admin", "Resource", "Reason"]} rows={privileged.map((e) => [when(e.createdAt), e.action, e.actorId?.slice(0, 10) ?? "", `${e.resourceType ?? ""} ${e.resourceId?.slice(0, 12) ?? ""}`, e.reason ?? ""])} empty="None." />
        <Link href="/platform-admin/audit?cat=ADMIN_ACTION">All admin actions →</Link>
      </Section>
    </>
  );
}
