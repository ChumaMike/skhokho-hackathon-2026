import Link from "next/link";
import { notFound } from "next/navigation";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { businessDetail } from "@/modules/platform-admin/businesses.service";
import { ATTENTION_KINDS } from "@/modules/platform-admin/order-attention";
import { can } from "@/modules/platform-admin/permissions";
import { formatCents, formatZAR } from "@/lib/utils";
import { Badge, Banner, KV, PageHeader, ReasonField, Section, Stats, Table, when } from "../../ui";
import { businessStatusAction, changePlanAction, setOverrideAction } from "../actions";
import DataSubjectSection from "./DataSubjectSection";
import { FEATURE_KEYS, FEATURES } from "@/modules/billing/features";
import { formatUsdMicros } from "@/lib/ai/pricing";

export const dynamic = "force-dynamic";

const fmt = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => `${k.toLowerCase()} ${v}`).join(" · ") || "none";
const stateTone = (s: string) => (s === "READY" ? "ok" : s === "NEEDS_ACTION" ? "warn" : s === "BLOCKED" ? "bad" : undefined);

/**
 * One business, readable without touching the database: readiness, trading
 * configuration, catalogue, staff, payments, recent activity, incidents and
 * the audit trail. No customer identities anywhere on this page.
 */
export default async function BusinessDetailPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const admin = await adminPage("businesses.view");
  const { businessId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(businessId)) notFound();
  const d = await businessDetail(businessId);
  if (!d) notFound();
  const b = d.business;
  const r = d.readiness;
  const c = d.configuration;
  const attentionRows = ATTENTION_KINDS.filter((k) => d.attention[k.kind] > 0);

  return (
    <>
      <PageHeader title={b.name} sub={`/${b.slug} · ${b.category.toLowerCase()}${b.suburb ? ` · ${b.suburb}` : ""}${b.city ? ` · ${b.city}` : ""}`} />
      <Banner ok={sp.ok} err={sp.err} />

      {r && (
        <Section title="Readiness">
          <Stats
            items={[
              { label: "Overall", value: r.overall.replaceAll("_", " ").toLowerCase(), tone: r.overall === "READY_TO_TRADE" ? "ok" : r.overall === "BLOCKED" ? "bad" : "warn" },
              { label: "Trading now", value: r.trading.label, tone: r.trading.state === "OPEN" ? "ok" : undefined },
              { label: "Orders needing attention", value: d.attention.total, tone: d.attention.total ? "warn" : undefined },
            ]}
          />
          <Table head={["Check", "State", "Detail"]} rows={r.checks.map((x) => [x.label, <Badge key="s" tone={stateTone(x.state)}>{x.state.replaceAll("_", " ").toLowerCase()}</Badge>, x.detail])} />
          <p style={{ marginTop: 8, opacity: 0.75 }}>Derived from the business&apos;s own settings and rows on every load — nothing here is typed in by an admin.</p>
        </Section>
      )}

      <Section title="Account">
        <KV
          items={[
            ["Status", <Badge key="s" tone={b.status === "ACTIVE" ? "ok" : b.status === "SUSPENDED" ? "bad" : "warn"}>{b.status.toLowerCase()}</Badge>],
            ["Owner", b.owner ? `${b.owner.email}${b.owner.isActive ? "" : " (deactivated)"} · last sign-in ${when(b.owner.lastLoginAt)}` : "—"],
            ["Plan", `${b.subscription?.planRef?.name ?? "Default"} · ${b.subscription?.status.toLowerCase() ?? "no subscription"}${b.subscription?.currentPeriodEnd ? ` · period ends ${when(b.subscription.currentPeriodEnd)}` : ""}`],
            ["Joined", when(b.createdAt)],
          ]}
        />
      </Section>

      <Section title="Storefront">
        <KV
          items={[
            ["Public URL", b.status === "ACTIVE" ? <Link key="u" href={`/store/${b.slug}`} target="_blank">/store/{b.slug}</Link> : `/store/${b.slug} (not published)`],
            ["Custom domain", b.domains.find((x) => x.surface === "STOREFRONT" && x.isPrimary)?.hostname ?? "none"],
            ["Branding", `logo ${c.branding.logo ? "yes" : "no"} · banner ${c.branding.banner ? "yes" : "no"} · description ${c.branding.description ? "yes" : "no"} · address pinned ${c.branding.pinned ? "yes" : "no"}`],
            ["Contact", `${b.phone ? "phone" : ""}${b.phone && b.whatsapp ? " + " : ""}${b.whatsapp ? "WhatsApp" : ""}` || "none"],
          ]}
        />
      </Section>

      <Section title="Catalogue">
        <Stats
          items={[
            { label: "Categories", value: d.counts.categories },
            { label: "Active products", value: d.counts.products },
            { label: "Hidden products", value: d.counts.productsHidden },
            { label: "Active services", value: d.counts.services },
          ]}
        />
      </Section>

      <Section title="Staff">
        <Table
          head={["Name", "Role", "State", "Last sign-in"]}
          rows={d.staff.map((s) => [s.name, s.role.toLowerCase(), <Badge key="s" tone={s.state === "active" ? "ok" : s.state === "invited" ? "warn" : undefined}>{s.state}</Badge>, when(s.lastLoginAt)])}
          empty="No staff."
        />
      </Section>

      <Section title="Trading">
        <KV
          items={[
            ["Now", r?.trading.label ?? "—"],
            ["Paused until", c.pausedUntil ? when(c.pausedUntil) : "not paused"],
            ["Hours", c.hours.length ? c.hours.map((h) => `${h.day.slice(0, 3)} ${h.label}`).join(" · ") : "not set (shown as always open)"],
            ["Collection", c.collection ? "on" : "off"],
            ["Minimum order", c.minOrderCents ? formatCents(c.minOrderCents) : "none"],
          ]}
        />
      </Section>

      <Section title="Delivery">
        {c.delivery ? (
          <>
            <KV
              items={[
                ["Mode", c.delivery.mode === "ZONE" ? "zones (one exact fee per area)" : c.delivery.mode === "PER_KM" ? "distance" : "flat fee"],
                [
                  "Pricing",
                  c.delivery.mode === "FLAT"
                    ? formatCents(c.delivery.feeCents)
                    : c.delivery.mode === "PER_KM"
                      ? `${formatCents(c.delivery.baseFeeCents)} + ${formatCents(c.delivery.perKmFeeCents)}/km · min ${formatCents(c.delivery.minFeeCents)}${c.delivery.maxDistanceKm ? ` · up to ${c.delivery.maxDistanceKm} km` : ""}`
                      : `${c.zones.filter((z) => z.active).length} active area(s)`,
                ],
                ["Drivers", c.delivery.sources === "OWN" ? "own drivers only" : c.delivery.sources === "NETWORK" ? "Skhokholetha only" : "own drivers, Skhokholetha as overflow"],
              ]}
            />
            {c.delivery.mode === "ZONE" && (
              <Table
                head={["Area", "Match", "Fee", "Min basket", "Active"]}
                rows={c.zones.map((z) => [z.name, z.matchKind.toLowerCase().replace("_", " "), formatCents(z.feeCents), z.minOrderCents ? formatCents(z.minOrderCents) : "—", z.active ? "yes" : "no"])}
                empty="No delivery areas."
              />
            )}
          </>
        ) : (
          <p>Delivery is switched off.</p>
        )}
      </Section>

      <Section title="Payments">
        <KV
          items={[
            ["Owner's choice", c.onlinePaymentWanted ? "card payments on" : "pay in person only"],
            ["Can take card payments now", c.connections.some((x) => x.environment === "LIVE" && x.status === "VERIFIED") && c.onlinePaymentWanted ? <Badge key="y" tone="ok">yes</Badge> : <Badge key="n" tone="warn">no — customers pay in person</Badge>],
            ["Refunds owed", d.refundDue ? <Badge key="r" tone="bad">{d.refundDue}</Badge> : "0"],
            ["Payments (30d)", fmt(d.payments30)],
          ]}
        />
        <Table
          head={["Environment", "Status", "Verified", "Last error", "Updated"]}
          rows={c.connections.map((x) => [x.environment.toLowerCase(), <Badge key="s" tone={x.status === "VERIFIED" ? "ok" : x.status === "INVALID" ? "bad" : "warn"}>{x.status.toLowerCase().replace("_", " ")}</Badge>, when(x.verifiedAt), x.lastError ?? "—", when(x.updatedAt)])}
          empty="No PayFast connection."
        />
        <p style={{ marginTop: 8, opacity: 0.75 }}>Read-only. Amounts, provider ids and settlement state are never edited here; refunds are made in the merchant&apos;s own PayFast account.</p>
      </Section>

      <Section title="Operations (last 30 days)">
        <Stats
          items={[
            { label: "Orders (30d)", value: d.counts.orders30 },
            { label: "Orders (all time)", value: d.counts.ordersAll },
            { label: "GMV paid (30d)", value: formatCents(d.gmv30Cents) },
            { label: "Paid orders (30d)", value: d.paidOrders30 },
            { label: "Own-driver deliveries (30d)", value: d.inHouseDeliveries30 },
          ]}
        />
        <KV
          items={[
            ["Skhokholetha (30d)", fmt(d.networkDeliveries30)],
            ["AI", `${d.ai.conversations} buddy conversations · ${d.ai.buddyActions30} buddy actions (30d) · ${d.ai.storefrontRevisions} storefront revisions`],
          ]}
        />
        {attentionRows.length > 0 && (
          <Table head={["Orders needing attention", "Count", "Why"]} rows={attentionRows.map((k) => [<Link key="k" href={`/platform-admin/orders?view=${k.kind}&business=${b.id}`}>{k.label}</Link>, d.attention[k.kind], k.why])} />
        )}
        <Table
          head={["Order", "Status", "Payment", "Total", "Fulfilment", "Placed"]}
          rows={d.recent.orders.map((o) => [<Link key="o" href={`/platform-admin/orders/${o.id}`}>{o.orderNumber}</Link>, o.status.toLowerCase(), o.paymentStatus.toLowerCase(), formatZAR(o.total), o.fulfilmentMethod.toLowerCase(), when(o.createdAt)])}
          empty="No orders yet."
        />
        <p style={{ marginTop: 8 }}>
          <Link href={`/platform-admin/orders?business=${b.id}`}>All orders →</Link> · <Link href={`/platform-admin/payments?business=${b.id}`}>Payments →</Link> ·{" "}
          <Link href={`/platform-admin/deliveries?business=${b.id}`}>Deliveries →</Link>
        </p>
      </Section>

      <Section title="Plan & entitlements">
        <KV
          items={[
            ["Effective plan", `${d.plan.entitlements.planName ?? "none"} · ${d.plan.entitlements.state.toLowerCase().replace("_", " ")}${d.plan.entitlements.accessUntil ? ` · until ${when(d.plan.entitlements.accessUntil)}` : ""}`],
            ["Content studio", d.plan.entitlements.features.content_studio.enabled ? "included" : "not included"],
            ["AI writing", d.plan.entitlements.features.content_generation.enabled ? "included" : "not included"],
            ["Campaigns", d.plan.entitlements.features.content_campaigns.enabled ? `included · ${d.plan.entitlements.features.content_campaigns_monthly.limit ?? "unlimited"} / month` : "not included"],
            ["Calendar", d.plan.entitlements.features.content_calendar.enabled ? "included" : "not included"],
            ["Ask Skhokho", d.plan.entitlements.features.ai_business_buddy.enabled ? "included" : "not included"],
            ["AI generations / month", d.plan.entitlements.features.ai_generations_monthly.enabled ? String(d.plan.entitlements.features.ai_generations_monthly.limit ?? "unlimited") : "0"],
          ]}
        />
        <Table
          head={["Override", "Grant", "Limit", "Expires", "Reason", "Since"]}
          rows={d.plan.overrides.map((o) => [o.featureKey, o.enabled ? "yes" : "denied", o.limitValue ?? "—", when(o.expiresAt), o.reason, when(o.createdAt)])}
          empty="No per-business overrides — the plan alone applies."
        />
        {can(admin.role, "businesses.manage") && (
          <>
            <form action={changePlanAction.bind(null, b.id)} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <select name="planCode" className="input" aria-label="Plan" defaultValue={d.plan.entitlements.planCode ?? ""}>
                {d.plan.plans.map((p) => (
                  <option key={p.code} value={p.code}>{p.name}</option>
                ))}
              </select>
              <ReasonField placeholder="Why change the plan? (recorded in the audit log)" />
              <button type="submit" className="btn">Change plan</button>
            </form>
            <form action={setOverrideAction.bind(null, b.id)} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <select name="featureKey" className="input" aria-label="Feature">
                {FEATURE_KEYS.map((k) => (
                  <option key={k} value={k}>{k} — {FEATURES[k].label}</option>
                ))}
              </select>
              <select name="mode" className="input" aria-label="Grant, deny or clear">
                <option value="grant">grant</option>
                <option value="deny">deny</option>
                <option value="clear">clear override</option>
              </select>
              <input name="limitValue" className="input" aria-label="Limit (limit features only)" placeholder="limit (blank = unlimited)" inputMode="numeric" />
              <input name="expiresAt" type="date" className="input" aria-label="Expires" />
              <ReasonField placeholder="Why? (pilot, comp, support fix)" />
              <button type="submit" className="btn">Apply override</button>
            </form>
          </>
        )}
      </Section>

      <Section title="Content & AI (this month)">
        <Stats
          items={[
            { label: "AI generations", value: d.content.usage.generationsLimit === null ? `${d.content.usage.generationsUsed} (unlimited)` : `${d.content.usage.generationsUsed} / ${d.content.usage.generationsLimit}`, tone: d.content.usage.generationsLimit && d.content.usage.generationsUsed >= Math.ceil(d.content.usage.generationsLimit * 0.8) ? "warn" : undefined },
            { label: "Tokens", value: d.content.usage.tokensUsed },
            { label: "Est. provider cost", value: formatUsdMicros(d.content.usage.estimatedCostUsdMicros) },
            { label: "Failed / rejected", value: d.content.usage.failures, tone: d.content.usage.failures ? "warn" : undefined },
            { label: "Refused (plan / allowance / rate)", value: d.content.usage.blocked, tone: d.content.usage.blocked ? "warn" : undefined },
            { label: "Drafts", value: `${d.content.drafts.DRAFT ?? 0} draft · ${d.content.drafts.READY ?? 0} ready · ${d.content.drafts.PUBLISHED_MANUALLY ?? 0} posted` },
            { label: "Campaigns", value: d.content.campaigns },
          ]}
        />
        <Table head={["Capability", "Calls"]} rows={d.content.usage.byCapability.map((c) => [c.capability, c.calls])} empty="No AI calls this month." />
        <p style={{ marginTop: 8, opacity: 0.75 }}>Counts and cost estimates only. Draft and campaign text is the merchant&apos;s and is never shown here.</p>
      </Section>

      <Section title="Domains">
        <Table head={["Host", "Surface", "Status", "SSL", "Primary"]} rows={b.domains.map((x) => [x.hostname, x.surface.toLowerCase(), x.status.toLowerCase(), x.sslStatus.toLowerCase(), x.isPrimary ? "yes" : ""])} empty="No custom domains." />
      </Section>

      <Section title="Incidents">
        <Table
          head={["Delivery", "Status", "Reason", "When"]}
          rows={d.networkIncidents.map((x) => [<Link key="d" href={`/platform-admin/deliveries/${x.id}`}>{x.id.slice(0, 10)}…</Link>, x.status.toLowerCase(), x.endReason ?? "—", when(x.updatedAt)])}
          empty="No failed, returned or disputed deliveries."
        />
      </Section>

      <Section title="Audit & security events">
        <Table
          head={["When", "Category", "Action", "Outcome", "Actor", "Reason"]}
          rows={d.events.map((e) => [when(e.createdAt), e.category.toLowerCase(), e.action, e.outcome.toLowerCase(), e.actorType, e.reason ?? ""])}
          empty="No events for this business."
        />
      </Section>

      <DataSubjectSection businessId={b.id} status={b.status} />
      {can(admin.role, "businesses.manage") && (
        <Section title="Commands">
          {b.status === "SUSPENDED" ? (
            <form action={businessStatusAction.bind(null, b.id, "REACTIVATE")} className="inline" style={{ display: "flex", gap: 8 }}>
              <ReasonField />
              <button type="submit" className="btn btnPrimary">Reactivate business</button>
            </form>
          ) : (
            <form action={businessStatusAction.bind(null, b.id, "SUSPEND")} style={{ display: "flex", gap: 8 }}>
              <ReasonField placeholder="Why suspend? (the storefront goes offline; data is kept)" />
              <button type="submit" className="btn">Suspend business</button>
            </form>
          )}
        </Section>
      )}
    </>
  );
}
