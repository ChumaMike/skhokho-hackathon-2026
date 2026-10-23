import Link from "next/link";
import { contentGate } from "../gate";
import ContentShell from "../ContentShell";
import { listCampaigns } from "@/modules/content/campaigns";
import { listProductsForOwner } from "@/modules/catalog/catalog.service";
import { listCategoriesForOwner } from "@/modules/catalog/menu-options.service";
import { createCampaignAction } from "../actions";
import styles from "../content.module.css";

export const dynamic = "force-dynamic";

/** Campaigns: a name, a goal, what they promote, when — and the drafts grouped under them. No ads, no accounts. */
export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const gate = await contentGate();
  const sp = await searchParams;
  const ready = gate.permitted && gate.entitled;
  const [campaigns, products, categories] = ready && gate.canCampaign ? await Promise.all([listCampaigns(gate.actor), listProductsForOwner(gate.actor.tenantId), listCategoriesForOwner(gate.actor.tenantId)]) : [[], [], []];
  const when = (d: Date | null) => (d ? d.toLocaleDateString("en-ZA", { dateStyle: "medium" }) : "—");

  return (
    <ContentShell gate={gate} current="campaigns" title="Campaigns" lede="A campaign groups a few posts around one goal and one week. Nothing is bought or posted for you.">
      {sp.ok && <div className="successBanner">{sp.ok}</div>}
      {sp.err && <div className="errorBanner" role="alert">{sp.err}</div>}
      {ready && !gate.canCampaign ? (
        <div className={`card ${styles.panel}`}>
          <p>Campaigns aren&apos;t included in your plan. Drafts and the brand profile still work.</p>
        </div>
      ) : ready ? (
        <>
          <div className={styles.list}>
            {campaigns.length === 0 && (
              <div className={`card ${styles.panel}`}>
                <p>No campaigns yet. Start with the form below — a weekend special is a good first one.</p>
              </div>
            )}
            {campaigns.map((c) => (
              <Link key={c.id} href={`/dashboard/content/campaigns/${c.id}`} className={`card ${styles.row}`} style={{ textDecoration: "none", color: "inherit" }}>
                <div className={styles.rowHead}>
                  <strong>{c.name}</strong>
                  <span className={`${styles.badge} ${c.status === "ACTIVE" ? styles.badgeOk : c.status === "PLANNED" ? styles.badgeWarn : ""}`}>{c.status.toLowerCase()}</span>
                </div>
                <p className={styles.muted}>
                  {when(c.startsAt)} – {when(c.endsAt)} · {c._count.drafts} piece{c._count.drafts === 1 ? "" : "s"}
                  {c.productIds.length ? ` · ${c.productIds.length} product${c.productIds.length === 1 ? "" : "s"}` : ""}
                </p>
                {c.goal && <p className={styles.preview}>{c.goal}</p>}
              </Link>
            ))}
          </div>

          <form action={createCampaignAction} className={`card ${styles.form}`}>
            <h2 className={styles.h2}>New campaign</h2>
            <label>
              Name
              <input name="name" className="input" maxLength={120} required placeholder="e.g. Weekend kota special" />
            </label>
            <label>
              Goal
              <input name="goal" className="input" maxLength={300} placeholder="e.g. more Saturday orders from Orlando" />
            </label>
            <label>
              Products it promotes
              <select name="productIds" multiple className="input" style={{ minHeight: 120 }}>
                {products.filter((p) => p.isActive).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            {categories.length > 0 && (
              <label>
                Categories
                <select name="categoryIds" multiple className="input" style={{ minHeight: 90 }}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Starts
              <input type="date" name="startsAt" className="input" />
            </label>
            <label>
              Ends
              <input type="date" name="endsAt" className="input" />
            </label>
            <label>
              Notes
              <textarea name="notes" className="input" maxLength={1000} style={{ minHeight: 70 }} />
            </label>
            <div className={styles.actions}>
              <button type="submit" className="btn btnPrimary">Create campaign</button>
            </div>
          </form>
        </>
      ) : null}
    </ContentShell>
  );
}
