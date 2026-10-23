import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { contentGate } from "../../gate";
import ContentShell from "../../ContentShell";
import { getCampaign } from "@/modules/content/campaigns";
import { ContentError } from "@/modules/content/context";
import { listProductsForOwner } from "@/modules/catalog/catalog.service";
import { listCategoriesForOwner } from "@/modules/catalog/menu-options.service";
import { TYPE_LABELS, CHANNEL_LABELS } from "@/modules/content/generation";
import { getUsageSummary } from "@/modules/content/usage";
import { generateCampaignSetAction, setCampaignStatusAction, updateCampaignAction } from "../../actions";
import styles from "../../content.module.css";

export const dynamic = "force-dynamic";

const toDateInput = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ campaignId: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const gate = await contentGate();
  const { campaignId } = await params;
  const sp = await searchParams;
  if (!gate.permitted || !gate.entitled || !gate.canCampaign) {
    return (
      <ContentShell gate={gate} current="campaigns" title="Campaign">
        <></>
      </ContentShell>
    );
  }
  let campaign;
  try {
    campaign = await getCampaign(gate.actor, campaignId);
  } catch (e) {
    if (e instanceof ContentError) notFound();
    throw e;
  }
  const [products, categories, usage] = await Promise.all([listProductsForOwner(gate.actor.tenantId), listCategoriesForOwner(gate.actor.tenantId), getUsageSummary(gate.actor.tenantId, { entitlements: gate.entitlements })]);
  const requestKey = randomUUID();

  return (
    <ContentShell gate={gate} current="campaigns" title={campaign.name} lede={`${campaign.status.toLowerCase()} · ${campaign._count.drafts} piece${campaign._count.drafts === 1 ? "" : "s"}`}>
      {sp.ok && <div className="successBanner">{sp.ok}</div>}
      {sp.err && <div className="errorBanner" role="alert">{sp.err}</div>}

      <div className={`card ${styles.panel}`}>
        <div className={styles.actions}>
          {campaign.status === "PLANNED" && (
            <form action={setCampaignStatusAction.bind(null, campaign.id, "ACTIVE")}>
              <button type="submit" className="btn btnPrimary">Start campaign</button>
            </form>
          )}
          {campaign.status === "ACTIVE" && (
            <form action={setCampaignStatusAction.bind(null, campaign.id, "COMPLETED")}>
              <button type="submit" className="btn btnPrimary">Mark complete</button>
            </form>
          )}
          {campaign.status !== "ARCHIVED" ? (
            <form action={setCampaignStatusAction.bind(null, campaign.id, "ARCHIVED")}>
              <button type="submit" className="btn">Archive</button>
            </form>
          ) : (
            <form action={setCampaignStatusAction.bind(null, campaign.id, "PLANNED")}>
              <button type="submit" className="btn">Restore</button>
            </form>
          )}
          {gate.canGenerate && campaign.status !== "ARCHIVED" && (
            <form action={generateCampaignSetAction.bind(null, campaign.id)}>
              <input type="hidden" name="requestKey" value={requestKey} />
              <button type="submit" className="btn" disabled={usage.generationsRemaining === 0}>Write the set (Instagram, Facebook, WhatsApp, caption)</button>
            </form>
          )}
          <Link href={`/dashboard/content/create?campaignId=${campaign.id}${campaign.productIds[0] ? `&sourceType=PRODUCT&productId=${campaign.productIds[0]}` : ""}`} className="btn">Add one piece</Link>
        </div>
        <p className={styles.muted}>Writing the set uses up to four AI generations{usage.generationsRemaining !== null ? ` (${usage.generationsRemaining} left this month)` : ""}. It stops early if the allowance runs out.</p>
      </div>

      <h2 className={styles.h2}>Pieces</h2>
      <div className={styles.list}>
        {campaign.drafts.length === 0 && (
          <div className={`card ${styles.panel}`}>
            <p>No pieces yet.</p>
          </div>
        )}
        {campaign.drafts.map((d) => (
          <Link key={d.id} href={`/dashboard/content/drafts/${d.id}`} className={`card ${styles.row}`} style={{ textDecoration: "none", color: "inherit" }}>
            <div className={styles.rowHead}>
              <strong>{d.title}</strong>
              <span className={`${styles.badge} ${d.status === "READY" ? styles.badgeOk : d.status === "DRAFT" ? styles.badgeWarn : ""}`}>{d.status.toLowerCase().replace("_", " ")}</span>
            </div>
            <p className={styles.muted}>{TYPE_LABELS[d.type]} · {CHANNEL_LABELS[d.channel]}{d.plannedFor ? ` · planned ${d.plannedFor.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}` : ""}</p>
            <p className={styles.preview}>{d.content.length > 160 ? `${d.content.slice(0, 160)}…` : d.content}</p>
          </Link>
        ))}
      </div>

      {campaign.status !== "ARCHIVED" && (
        <form action={updateCampaignAction.bind(null, campaign.id)} className={`card ${styles.form}`}>
          <h2 className={styles.h2}>Edit campaign</h2>
          <label>
            Name
            <input name="name" className="input" defaultValue={campaign.name} maxLength={120} required />
          </label>
          <label>
            Goal
            <input name="goal" className="input" defaultValue={campaign.goal ?? ""} maxLength={300} />
          </label>
          <label>
            Products
            <select name="productIds" multiple className="input" style={{ minHeight: 120 }} defaultValue={campaign.productIds}>
              {products.filter((p) => p.isActive).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          {categories.length > 0 && (
            <label>
              Categories
              <select name="categoryIds" multiple className="input" style={{ minHeight: 90 }} defaultValue={campaign.categoryIds}>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Starts
            <input type="date" name="startsAt" className="input" defaultValue={toDateInput(campaign.startsAt)} />
          </label>
          <label>
            Ends
            <input type="date" name="endsAt" className="input" defaultValue={toDateInput(campaign.endsAt)} />
          </label>
          <label>
            Notes
            <textarea name="notes" className="input" defaultValue={campaign.notes ?? ""} maxLength={1000} style={{ minHeight: 70 }} />
          </label>
          <div className={styles.actions}>
            <button type="submit" className="btn btnPrimary">Save</button>
            <Link href="/dashboard/content/campaigns" className="btn">All campaigns</Link>
          </div>
        </form>
      )}
    </ContentShell>
  );
}
