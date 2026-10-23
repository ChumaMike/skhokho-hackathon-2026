import { randomUUID } from "node:crypto";
import { contentGate } from "../gate";
import ContentShell from "../ContentShell";
import { listProductsForOwner } from "@/modules/catalog/catalog.service";
import { listCategoriesForOwner } from "@/modules/catalog/menu-options.service";
import { listCampaigns } from "@/modules/content/campaigns";
import { CONTENT_TYPES, CHANNELS, TONES, TYPE_LABELS, CHANNEL_LABELS, PRODUCT_TOOLS } from "@/modules/content/generation";
import { getUsageSummary, usageLine } from "@/modules/content/usage";
import { createManualDraftAction, generateAction, productToolAction } from "../actions";
import styles from "../content.module.css";

export const dynamic = "force-dynamic";

const SOURCES = [
  { value: "BUSINESS", label: "The business as a whole" },
  { value: "PRODUCT", label: "One product" },
  { value: "CATEGORY", label: "A category" },
  { value: "OFFER", label: "A special / offer" },
  { value: "CUSTOM", label: "My own idea" },
  { value: "INSIGHT", label: "What has been selling" },
] as const;

const TOOL_LABELS: Record<keyof typeof PRODUCT_TOOLS, string> = {
  improve_description: "Improve description",
  social_post: "Social post",
  promo_caption: "Promo caption",
  improve_title: "Suggest a better title",
};

/** Create: generate from real business context, or write by hand. */
export default async function CreateContentPage({ searchParams }: { searchParams: Promise<{ err?: string; sourceType?: string; productId?: string; type?: string; channel?: string; source?: string; manual?: string; campaignId?: string }> }) {
  const gate = await contentGate();
  const sp = await searchParams;
  if (!gate.permitted || !gate.entitled) {
    return (
      <ContentShell gate={gate} current="create" title="Create content">
        <></>
      </ContentShell>
    );
  }
  const [products, categories, campaigns, usage] = await Promise.all([
    listProductsForOwner(gate.actor.tenantId),
    listCategoriesForOwner(gate.actor.tenantId),
    gate.canCampaign ? listCampaigns(gate.actor) : Promise.resolve([]),
    getUsageSummary(gate.actor.tenantId, { entitlements: gate.entitlements }),
  ]);
  const activeProducts = products.filter((p) => p.isActive);
  const sourceType = sp.sourceType ?? sp.source ?? (sp.productId ? "PRODUCT" : "BUSINESS");
  const selectedProduct = sp.productId ? activeProducts.find((p) => p.id === sp.productId) : undefined;
  const requestKey = randomUUID();
  const outOfAllowance = usage.generationsRemaining === 0;

  return (
    <ContentShell gate={gate} current="create" title="Create content" lede="Pick what it's about, what kind of piece, and where it will go. The AI only uses what's in your catalogue and brand profile.">
      {sp.err && <div className="errorBanner" role="alert">{sp.err}</div>}
      <p className={styles.muted}>{usageLine(usage)}{usage.generationsRemaining !== null ? ` · ${usage.generationsRemaining} left` : ""}</p>

      {selectedProduct && gate.canGenerate && (
        <div className={`card ${styles.panel}`}>
          <h2 className={styles.h2}>Quick tools for {selectedProduct.name}</h2>
          <div className={styles.actions}>
            {(Object.keys(PRODUCT_TOOLS) as (keyof typeof PRODUCT_TOOLS)[]).map((tool) => (
              <form key={tool} action={productToolAction}>
                <input type="hidden" name="productId" value={selectedProduct.id} />
                <input type="hidden" name="tool" value={tool} />
                <input type="hidden" name="requestKey" value={`${requestKey}:${tool}`} />
                <button type="submit" className="btn" disabled={outOfAllowance}>{TOOL_LABELS[tool]}</button>
              </form>
            ))}
          </div>
          <p className={styles.muted}>Each tool writes a draft for you to review. A new description or title is only applied to the product after you preview and confirm it.</p>
        </div>
      )}

      {gate.canGenerate ? (
        <form action={generateAction} className={`card ${styles.form}`}>
          <h2 className={styles.h2}>Write it with AI</h2>
          <input type="hidden" name="requestKey" value={requestKey} />
          <label>
            About
            <select name="sourceType" defaultValue={sourceType} className="input">
              {SOURCES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </label>
          <label>
            Product (when &ldquo;One product&rdquo;)
            <select name="productId" defaultValue={selectedProduct?.id ?? ""} className="input">
              <option value="">Choose a product…</option>
              {activeProducts.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
          <label>
            Category (when &ldquo;A category&rdquo;)
            <select name="categoryId" defaultValue="" className="input">
              <option value="">Choose a category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label>
            The offer or idea, in your words (when &ldquo;A special&rdquo; or &ldquo;My own idea&rdquo;)
            <textarea name="text" className="input" maxLength={400} placeholder="e.g. Two kotas for R60 on Fridays" style={{ minHeight: 70 }} />
          </label>
          <label>
            Kind of piece
            <select name="type" defaultValue={sp.type ?? "SOCIAL_POST"} className="input">
              {CONTENT_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
          </label>
          <label>
            Where it will go
            <select name="channel" defaultValue={sp.channel ?? "GENERAL"} className="input">
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
              ))}
            </select>
          </label>
          <label>
            Tone
            <select name="tone" defaultValue="" className="input">
              <option value="">Use my brand profile</option>
              {TONES.map((t) => (
                <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>
              ))}
            </select>
          </label>
          <label>
            Goal (optional)
            <input name="goal" className="input" maxLength={200} placeholder="e.g. get people in on Saturday morning" />
          </label>
          <label>
            Extra instructions (optional)
            <input name="instructions" className="input" maxLength={500} placeholder="e.g. mention we deliver in Orlando" />
          </label>
          {campaigns.length > 0 && (
            <label>
              Campaign (optional)
              <select name="campaignId" defaultValue={sp.campaignId ?? ""} className="input">
                <option value="">None</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
          <div className={styles.actions}>
            <button type="submit" className="btn btnPrimary" disabled={outOfAllowance}>{outOfAllowance ? "No generations left this month" : "Write it"}</button>
          </div>
          <p className={styles.muted}>Uses one AI generation. The AI never sees customer names, numbers, addresses or payments — only your business, catalogue and brand profile.</p>
        </form>
      ) : (
        <div className={`card ${styles.panel}`}>
          <p>AI writing isn&apos;t included in your plan. You can still write and plan content by hand below.</p>
        </div>
      )}

      <form action={createManualDraftAction} className={`card ${styles.form}`}>
        <h2 className={styles.h2}>Write it yourself</h2>
        <label>
          Title (for your own list)
          <input name="title" className="input" maxLength={80} required />
        </label>
        <label>
          Kind
          <select name="type" defaultValue="SOCIAL_POST" className="input">
            {CONTENT_TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>
        <label>
          Where it will go
          <select name="channel" defaultValue="GENERAL" className="input">
            {CHANNELS.map((c) => (
              <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
            ))}
          </select>
        </label>
        <label>
          Text
          <textarea name="content" className="input" maxLength={2000} required />
        </label>
        {campaigns.length > 0 && (
          <label>
            Campaign (optional)
            <select name="campaignId" defaultValue={sp.campaignId ?? ""} className="input">
              <option value="">None</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
        )}
        <label>
          Planned for (optional)
          <input type="datetime-local" name="plannedFor" className="input" />
        </label>
        <div className={styles.actions}>
          <button type="submit" className="btn">Save draft</button>
        </div>
      </form>
    </ContentShell>
  );
}
