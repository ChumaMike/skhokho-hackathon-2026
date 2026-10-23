import Link from "next/link";
import type { ContentDraftStatus } from "@prisma/client";
import { contentGate } from "../gate";
import ContentShell from "../ContentShell";
import { listDrafts } from "@/modules/content/drafts";
import { TYPE_LABELS, CHANNEL_LABELS } from "@/modules/content/generation";
import styles from "../content.module.css";

export const dynamic = "force-dynamic";

const FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All open" },
  { value: "DRAFT", label: "Drafts" },
  { value: "READY", label: "Ready" },
  { value: "PUBLISHED_MANUALLY", label: "Posted" },
  { value: "ARCHIVED", label: "Archived" },
];

const STATUS_LABELS: Record<ContentDraftStatus, string> = { DRAFT: "draft", READY: "ready", PUBLISHED_MANUALLY: "posted", ARCHIVED: "archived" };

export default async function DraftsPage({ searchParams }: { searchParams: Promise<{ status?: string; ok?: string }> }) {
  const gate = await contentGate();
  const sp = await searchParams;
  const status = (["DRAFT", "READY", "PUBLISHED_MANUALLY", "ARCHIVED"] as const).find((s) => s === sp.status);
  const drafts = gate.permitted && gate.entitled ? await listDrafts(gate.actor, { status }) : [];
  const when = (d: Date | null) => (d ? d.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" }) : null);

  return (
    <ContentShell gate={gate} current="drafts" title="Drafts" lede="Everything written, by you or with AI. Open one to edit, mark it ready, or copy it out.">
      {sp.ok && <div className="successBanner">{sp.ok}</div>}
      <nav className={styles.subnav} aria-label="Filter drafts">
        {FILTERS.map((f) => (
          <Link key={f.value} href={f.value ? `/dashboard/content/drafts?status=${f.value}` : "/dashboard/content/drafts"} className={(sp.status ?? "") === f.value ? styles.subnavActive : styles.subnavLink} aria-current={(sp.status ?? "") === f.value ? "page" : undefined}>
            {f.label}
          </Link>
        ))}
      </nav>
      {drafts.length === 0 ? (
        <div className={`card ${styles.panel}`}>
          <p>Nothing here yet. <Link href="/dashboard/content/create">Create something</Link>.</p>
        </div>
      ) : (
        <div className={styles.list}>
          {drafts.map((d) => (
            <Link key={d.id} href={`/dashboard/content/drafts/${d.id}`} className={`card ${styles.row}`} style={{ textDecoration: "none", color: "inherit" }}>
              <div className={styles.rowHead}>
                <strong>{d.title}</strong>
                <span className={`${styles.badge} ${d.status === "READY" ? styles.badgeOk : d.status === "DRAFT" ? styles.badgeWarn : ""}`}>{STATUS_LABELS[d.status]}</span>
              </div>
              <p className={styles.muted}>
                {TYPE_LABELS[d.type]} · {CHANNEL_LABELS[d.channel]}
                {d.aiUsageEventId ? " · written with AI" : " · written by hand"}
                {d.plannedFor ? ` · planned ${when(d.plannedFor)}` : ""}
              </p>
              <p className={styles.preview}>{d.content.length > 160 ? `${d.content.slice(0, 160)}…` : d.content}</p>
            </Link>
          ))}
        </div>
      )}
    </ContentShell>
  );
}
