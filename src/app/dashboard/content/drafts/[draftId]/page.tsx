import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma/client";
import { contentGate } from "../../gate";
import ContentShell from "../../ContentShell";
import { getDraft } from "@/modules/content/drafts";
import { listCampaigns } from "@/modules/content/campaigns";
import { CHANNELS, CHANNEL_LABELS, TYPE_LABELS } from "@/modules/content/generation";
import { ContentError } from "@/modules/content/context";
import { cancelApplyProductTextAction, confirmApplyProductTextAction, prepareApplyProductTextAction, setDraftStatusAction, updateDraftAction } from "../../actions";
import CopyButton from "./CopyButton";
import styles from "../../content.module.css";

export const dynamic = "force-dynamic";

const toLocalInput = (d: Date | null) => (d ? new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "");

/** One draft: edit, mark ready / posted, copy out, and (product texts) preview → confirm → apply. */
export default async function DraftPage({ params, searchParams }: { params: Promise<{ draftId: string }>; searchParams: Promise<{ ok?: string; err?: string; apply?: string }> }) {
  const gate = await contentGate();
  const { draftId } = await params;
  const sp = await searchParams;
  if (!gate.permitted || !gate.entitled) {
    return (
      <ContentShell gate={gate} current="drafts" title="Draft">
        <></>
      </ContentShell>
    );
  }
  let draft;
  try {
    draft = await getDraft(gate.actor, draftId);
  } catch (e) {
    if (e instanceof ContentError) notFound();
    throw e;
  }
  const campaigns = gate.canCampaign ? await listCampaigns(gate.actor) : [];
  const isProductText = (draft.type === "PRODUCT_DESCRIPTION" || draft.type === "PRODUCT_TITLE") && draft.sourceType === "PRODUCT" && !!draft.sourceId;
  // A prepared apply action, shown as a preview the person must confirm (same business, same person — buddy-actions enforces it).
  const pending = sp.apply
    ? await prisma.buddyAction.findFirst({ where: { id: sp.apply, businessId: gate.actor.tenantId, actorId: gate.actor.staffId, status: "PREPARED", kind: "APPLY_PRODUCT_TEXT" }, select: { id: true, preview: true, expiresAt: true } })
    : null;
  const preview = pending?.preview as { title: string; summary: string; changes: { label: string; before: string; after: string }[]; note?: string } | null;

  return (
    <ContentShell gate={gate} current="drafts" title={draft.title} lede={`${TYPE_LABELS[draft.type]} · ${CHANNEL_LABELS[draft.channel]} · ${draft.status.toLowerCase().replace("_", " ")}`}>
      {sp.ok && <div className="successBanner">{sp.ok}</div>}
      {sp.err && <div className="errorBanner" role="alert">{sp.err}</div>}

      {pending && preview && (
        <div className={`card ${styles.panel}`} role="region" aria-label="Confirm this change">
          <h2 className={styles.h2}>{preview.title}</h2>
          <p>{preview.summary}</p>
          {preview.changes.map((c) => (
            <div key={c.label} className={styles.diff}>
              <div>
                <p className={styles.muted}>Before</p>
                <p className={styles.preview}>{c.before}</p>
              </div>
              <div>
                <p className={styles.muted}>After</p>
                <p className={styles.preview}>{c.after}</p>
              </div>
            </div>
          ))}
          {preview.note && <p className={styles.muted}>{preview.note}</p>}
          <div className={styles.actions}>
            <form action={confirmApplyProductTextAction.bind(null, draft.id, pending.id)}>
              <button type="submit" className="btn btnPrimary">Yes, apply it</button>
            </form>
            <form action={cancelApplyProductTextAction.bind(null, draft.id, pending.id)}>
              <button type="submit" className="btn">Not now</button>
            </form>
          </div>
        </div>
      )}

      <div className={`card ${styles.panel}`}>
        <p className={styles.preview}>{draft.content}</p>
        <div className={styles.actions} style={{ marginTop: 12 }}>
          <CopyButton text={draft.content} />
          {draft.status === "DRAFT" && (
            <form action={setDraftStatusAction.bind(null, draft.id, "READY")}>
              <button type="submit" className="btn btnPrimary">Mark ready</button>
            </form>
          )}
          {draft.status === "READY" && (
            <>
              <form action={setDraftStatusAction.bind(null, draft.id, "PUBLISHED_MANUALLY")}>
                <button type="submit" className="btn btnPrimary">I&apos;ve posted it</button>
              </form>
              <form action={setDraftStatusAction.bind(null, draft.id, "DRAFT")}>
                <button type="submit" className="btn">Back to draft</button>
              </form>
            </>
          )}
          {isProductText && draft.status !== "PUBLISHED_MANUALLY" && !pending && (
            <form action={prepareApplyProductTextAction.bind(null, draft.id)}>
              <button type="submit" className="btn">Preview on the product…</button>
            </form>
          )}
          {draft.status !== "ARCHIVED" ? (
            <form action={setDraftStatusAction.bind(null, draft.id, "ARCHIVED")}>
              <button type="submit" className="btn">Archive</button>
            </form>
          ) : (
            <form action={setDraftStatusAction.bind(null, draft.id, "DRAFT")}>
              <button type="submit" className="btn">Restore</button>
            </form>
          )}
        </div>
        <p className={styles.muted} style={{ marginTop: 8 }}>
          {draft.aiUsageEventId ? "Written with AI from your catalogue and brand profile — read it before you post it." : "Written by hand."}
          {draft.publishedAt ? ` Marked posted ${draft.publishedAt.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}.` : ""}
        </p>
      </div>

      {draft.status !== "ARCHIVED" && (
        <form action={updateDraftAction.bind(null, draft.id)} className={`card ${styles.form}`}>
          <h2 className={styles.h2}>Edit</h2>
          <label>
            Title
            <input name="title" className="input" defaultValue={draft.title} maxLength={80} required />
          </label>
          <label>
            Text
            <textarea name="content" className="input" defaultValue={draft.content} maxLength={2000} required />
          </label>
          <label>
            Where it will go
            <select name="channel" defaultValue={draft.channel} className="input">
              {CHANNELS.map((c) => (
                <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>
              ))}
            </select>
          </label>
          {campaigns.length > 0 && (
            <label>
              Campaign
              <select name="campaignId" defaultValue={draft.campaignId ?? ""} className="input">
                <option value="">None</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
          <label>
            Planned for
            <input type="datetime-local" name="plannedFor" className="input" defaultValue={toLocalInput(draft.plannedFor)} />
          </label>
          <div className={styles.actions}>
            <button type="submit" className="btn btnPrimary">Save</button>
            <Link href="/dashboard/content/drafts" className="btn">Back to drafts</Link>
          </div>
        </form>
      )}
    </ContentShell>
  );
}
