import type { AuditCategory, Prisma } from "@prisma/client";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { prisma } from "@/lib/prisma/client";
import { Badge, Filters, PageHeader, Section, Table, when } from "../ui";

export const dynamic = "force-dynamic";

const CATS = ["ALL", "ADMIN_ACTION", "SECURITY", "SYSTEM"] as const;
const RANGES: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 };
const clean = (v: string | undefined, max = 80) => (v ?? "").trim().slice(0, max) || undefined;

/**
 * The platform audit trail (append-only). Filters: category, action, actor,
 * resource, business, time. Metadata was redacted on write — no passwords,
 * codes, tokens, cookies, keys or bank numbers exist in it to show.
 */
export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await adminPage("audit.view");
  const sp = await searchParams;
  const cat = (CATS as readonly string[]).includes(sp.cat ?? "") ? (sp.cat as (typeof CATS)[number]) : "ALL";
  const range = sp.range && RANGES[sp.range] ? sp.range : "7d";
  const f = { action: clean(sp.action), actor: clean(sp.actor), resource: clean(sp.resource), business: /^[0-9a-f-]{36}$/i.test(sp.business ?? "") ? sp.business : undefined };
  const where: Prisma.PlatformAuditEventWhereInput = {
    createdAt: { gte: new Date(Date.now() - RANGES[range] * 24 * 60 * 60 * 1000) },
    ...(cat === "ALL" ? {} : { category: cat as AuditCategory }),
    ...(f.action ? { action: f.action } : {}),
    ...(f.actor ? { actorId: f.actor } : {}),
    ...(f.resource ? { OR: [{ resourceId: f.resource }, { resourceType: f.resource }] } : {}),
    ...(f.business ? { businessId: f.business } : {}),
  };
  const events = await prisma.platformAuditEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
  const keep = { range, action: f.action, actor: f.actor, resource: f.resource, business: f.business };

  return (
    <>
      <PageHeader title="Audit log" sub="Newest first, up to 200. Append-only — entries can't be edited or deleted." />
      <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <input type="hidden" name="cat" value={cat} />
        <input className="input" name="action" defaultValue={f.action} placeholder="Action (exact)" style={{ maxWidth: 200 }} />
        <input className="input" name="actor" defaultValue={f.actor} placeholder="Actor id" style={{ maxWidth: 260 }} />
        <input className="input" name="resource" defaultValue={f.resource} placeholder="Resource id or type" style={{ maxWidth: 220 }} />
        <input className="input" name="business" defaultValue={f.business} placeholder="Business id" style={{ maxWidth: 300 }} />
        <select className="input" name="range" defaultValue={range} style={{ maxWidth: 110 }}>
          {Object.keys(RANGES).map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button type="submit" className="btn">Filter</button>
      </form>
      <Filters base="/platform-admin/audit" param="cat" current={cat} keep={keep} options={CATS.map((c) => ({ value: c, label: c === "ALL" ? "All" : c.toLowerCase().replace("_", " ") }))} />
      <Section title={`${events.length} event(s)`}>
        <Table
          head={["When", "Category", "Action", "Outcome", "Actor", "Resource", "Business", "Reason", "Details", "Request"]}
          rows={events.map((e) => [
            when(e.createdAt),
            e.category.toLowerCase().replace("_", " "),
            e.action,
            <Badge key="o" tone={e.outcome === "SUCCESS" ? "ok" : "bad"}>{e.outcome.toLowerCase()}</Badge>,
            `${e.actorType}${e.actorId ? ` ${e.actorId.slice(0, 12)}` : ""}`,
            e.resourceType ? `${e.resourceType}${e.resourceId ? ` ${e.resourceId.slice(0, 14)}` : ""}` : "",
            e.businessId ? e.businessId.slice(0, 8) : "",
            e.reason ?? "",
            e.metadata ? <code key="m" style={{ fontSize: "0.78rem" }}>{JSON.stringify(e.metadata)}</code> : "",
            e.requestId ? e.requestId.slice(0, 8) : "",
          ])}
          empty="No events match."
        />
      </Section>
    </>
  );
}
