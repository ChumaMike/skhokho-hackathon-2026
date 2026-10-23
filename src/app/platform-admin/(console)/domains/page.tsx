import Link from "next/link";
import type { DomainStatus } from "@prisma/client";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { prisma } from "@/lib/prisma/client";
import { Badge, Filters, PageHeader, Section, Stats, Table, when } from "../ui";

export const dynamic = "force-dynamic";

const STATUSES = ["ALL", "PENDING", "VERIFYING", "ACTIVE", "FAILED", "REVOKED"] as const;

/** Custom domains across businesses — read-only (merchants manage their own; the daily job re-checks). Verification tokens are never shown. */
export default async function DomainsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await adminPage("domains.view");
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof STATUSES)[number]) : "ALL";
  const [domains, byStatus] = await Promise.all([
    prisma.businessDomain.findMany({
      where: status === "ALL" ? {} : { status: status as DomainStatus },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, hostname: true, status: true, dnsStatus: true, sslStatus: true, surface: true, isPrimary: true, failedChecks: true, createdAt: true, business: { select: { id: true, name: true } } },
    }),
    prisma.businessDomain.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const c = Object.fromEntries(byStatus.map((r) => [r.status, r._count._all]));
  return (
    <>
      <PageHeader title="Domains" sub="Merchant custom domains. Read-only." />
      <Stats items={Object.entries(c).map(([k, v]) => ({ label: k.toLowerCase(), value: v, tone: k === "FAILED" ? ("bad" as const) : k === "ACTIVE" ? ("ok" as const) : undefined }))} />
      <Filters base="/platform-admin/domains" param="status" current={status} options={STATUSES.map((s) => ({ value: s, label: s === "ALL" ? "All" : s.toLowerCase() }))} />
      <Section title={`${domains.length} shown`}>
        <Table
          head={["Host", "Business", "Status", "DNS", "SSL", "Surface", "Failed checks", "Added"]}
          rows={domains.map((d) => [
            d.hostname + (d.isPrimary ? " (primary)" : ""),
            <Link key="b" href={`/platform-admin/businesses/${d.business.id}`}>{d.business.name}</Link>,
            <Badge key="s" tone={d.status === "ACTIVE" ? "ok" : d.status === "FAILED" ? "bad" : "warn"}>{d.status.toLowerCase()}</Badge>,
            d.dnsStatus.toLowerCase(),
            d.sslStatus.toLowerCase(),
            d.surface.toLowerCase(),
            d.failedChecks,
            when(d.createdAt),
          ])}
        />
      </Section>
    </>
  );
}
