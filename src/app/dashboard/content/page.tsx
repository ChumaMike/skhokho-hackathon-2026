import Link from "next/link";
import { contentGate } from "./gate";
import ContentShell from "./ContentShell";
import { getContentOverview } from "@/modules/content/overview";
import { usageLine } from "@/modules/content/usage";
import styles from "./content.module.css";

export const dynamic = "force-dynamic";

/** Content & Marketing overview: what exists, this month's AI usage, a few grounded suggestions. */
export default async function ContentOverviewPage() {
  const gate = await contentGate();
  const overview = gate.permitted && gate.entitled ? await getContentOverview(gate.actor) : null;

  return (
    <ContentShell gate={gate} current="overview" title="Content & Marketing" lede="Write it here, copy it out, post it yourself. Nothing is posted for you.">
      {overview && (
        <>
          <div className={styles.grid}>
            <div className={`card ${styles.tile}`}>
              <p className={styles.tileNumber}>{overview.counts.drafts}</p>
              <p className={styles.tileLabel}>drafts</p>
            </div>
            <div className={`card ${styles.tile}`}>
              <p className={styles.tileNumber}>{overview.counts.ready}</p>
              <p className={styles.tileLabel}>ready to post</p>
            </div>
            <div className={`card ${styles.tile}`}>
              <p className={styles.tileNumber}>{overview.counts.published}</p>
              <p className={styles.tileLabel}>posted</p>
            </div>
            <div className={`card ${styles.tile}`}>
              <p className={styles.tileNumber}>{overview.counts.activeCampaigns}</p>
              <p className={styles.tileLabel}>active campaign{overview.counts.activeCampaigns === 1 ? "" : "s"}</p>
            </div>
          </div>

          <div className={`card ${styles.panel}`}>
            <h2 className={styles.h2}>AI usage</h2>
            <p>{usageLine(overview.usage)}</p>
            {overview.usage.generationsLimit ? (
              <div className={styles.usageBar} role="meter" aria-valuemin={0} aria-valuemax={overview.usage.generationsLimit} aria-valuenow={overview.usage.generationsUsed} aria-label="AI generations used this month">
                <div className={styles.usageFill} style={{ width: `${Math.min(100, Math.round((overview.usage.generationsUsed / overview.usage.generationsLimit) * 100))}%` }} />
              </div>
            ) : null}
            <p className={styles.muted}>
              {overview.usage.generationsRemaining !== null ? `${overview.usage.generationsRemaining} remaining this month. ` : ""}
              Every draft, caption or campaign version the AI writes counts as one generation. Hand-written drafts are free.
              {!overview.canGenerate ? " AI writing is not included in your plan — you can still write and plan content by hand." : ""}
            </p>
          </div>

          <h2 className={styles.h2}>Suggestions</h2>
          <div className={styles.list}>
            {overview.suggestions.map((s) => (
              <div key={s.kind} className={`card ${styles.suggestion}`}>
                <div className={styles.rowHead}>
                  <strong>{s.title}</strong>
                  <span className={`${styles.badge} ${s.evidenceBased ? styles.badgeOk : ""}`}>{s.evidenceBased ? "from your sales data" : "an idea"}</span>
                </div>
                <p>{s.detail}</p>
                <Link href={s.href} className="btn">Start</Link>
              </div>
            ))}
          </div>

          <p className={styles.actions} style={{ marginTop: 16 }}>
            <Link href="/dashboard/content/create" className="btn btnPrimary">Create content</Link>
            <Link href="/dashboard/content/drafts" className="btn">Drafts</Link>
            {overview.canCampaign && <Link href="/dashboard/content/campaigns" className="btn">Campaigns</Link>}
            <Link href="/dashboard/content/brand" className="btn">Brand</Link>
          </p>
        </>
      )}
    </ContentShell>
  );
}
