import Link from "next/link";
import type { BusinessStatus } from "@prisma/client";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { listBusinesses } from "@/modules/platform-admin/businesses.service";
import { loadMerchantReadiness } from "@/modules/platform-admin/merchant-readiness";
import { Badge, Filters, PageHeader, Section, Table, when } from "../ui";

export const dynamic = "force-dynamic";

const STATUSES = ["ALL", "ACTIVE", "PENDING_VERIFICATION", "SUSPENDED", "DEACTIVATED"] as const;

/** Businesses — in this platform each business is one shop/storefront. */
export default async function BusinessesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  await adminPage("businesses.view");
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as (typeof STATUSES)[number]) : "ALL";
  const q = (sp.q ?? "").trim().slice(0, 80);
  const rows = await listBusinesses({ status: status === "ALL" ? undefined : (status as BusinessStatus), q: q || undefined });
  const readiness = await loadMerchantReadiness(rows.map((b) => b.id));
  const readinessBadge = (id: string) => {
    const r = readiness.get(id);
    if (!r) return "—";
    const open = r.checks.filter((c) => c.state === "NEEDS_ACTION" || c.state === "BLOCKED").length;
    return (
      <Badge tone={r.overall === "READY_TO_TRADE" ? "ok" : r.overall === "BLOCKED" ? "bad" : "warn"}>
        {r.overall === "READY_TO_TRADE" ? "ready to trade" : r.overall === "BLOCKED" ? "blocked" : `${open} to fix`}
      </Badge>
    );
  };

  return (
    <>
      <PageHeader title="Businesses & shops" sub="Each business runs one shop (storefront). Newest first, 50 at a time." />
      <form method="get" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input className="input" name="q" defaultValue={q} placeholder="Search name or slug" />
        <input type="hidden" name="status" value={status} />
        <button type="submit" className="btn">Search</button>
      </form>
      <Filters base="/platform-admin/businesses" param="status" current={status} keep={{ q: q || undefined }} options={STATUSES.map((s) => ({ value: s, label: s === "ALL" ? "All" : s.replace("_", " ").toLowerCase() }))} />
      <Section title={`${rows.length} shown`}>
        <Table
          head={["Business", "Status", "Readiness", "Owner", "Plan", "Orders", "Staff", "Joined"]}
          rows={rows.map((b) => [
            <Link key="n" href={`/platform-admin/businesses/${b.id}`}>{b.name}</Link>,
            <Badge key="s" tone={b.status === "ACTIVE" ? "ok" : b.status === "SUSPENDED" ? "bad" : "warn"}>{b.status.toLowerCase()}</Badge>,
            readinessBadge(b.id),
            b.owner?.email ?? "—",
            `${b.subscription?.planRef?.name ?? "Default"}${b.subscription?.status === "TRIALING" ? " (trial)" : ""}`,
            b._count.orders,
            b._count.staff,
            when(b.createdAt),
          ])}
        />
      </Section>
    </>
  );
}
