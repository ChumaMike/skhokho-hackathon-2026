import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { listRevisions } from "@/modules/storefront-spec/revision.service";
import DashboardNav from "@/components/DashboardNav";
import { generateDraftAction } from "./actions";
import styles from "./ai.module.css";

export const dynamic = "force-dynamic";

const STATUS_LABEL = { DRAFT: "Draft", PUBLISHED: "Live", ARCHIVED: "Archived" } as const;
const SOURCE_LABEL = { AI_GENERATED: "Built by AI", AI_ASSISTED: "Improved by AI", RULES: "Built from your details" } as const;

export default async function StorefrontAiPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;

  let permitted = true;
  try {
    await requireStaffPermission("canManageSettings");
  } catch {
    permitted = false;
  }
  const revisions = permitted ? await listRevisions(session.tenantId) : [];

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Storefront</span>
        <h1 className={styles.title}>Build your storefront with AI</h1>
        <p className={styles.sub}>
          We look at what you sell, how customers reach you and what you can offer online, then design a storefront for you.
          Nothing goes live until you&apos;ve previewed it and pressed publish.
        </p>

        <DashboardNav current="storefront" {...workspaceContext} />
        <p className={styles.sub}>
          <Link href="/dashboard/storefront">← Back to storefront</Link>
        </p>

        {!permitted ? (
          <div className="errorBanner">Your role doesn&apos;t have permission to change the storefront — ask the business owner.</div>
        ) : (
          <>
            {sp.err && <div className="errorBanner">{sp.err}</div>}

            <div className={styles.choiceGrid}>
              <form action={generateDraftAction} className={`card ${styles.choice}`}>
                <input type="hidden" name="mode" value="GENERATE" />
                <h2 className={styles.choiceTitle}>Design it for me</h2>
                <p className={styles.choiceText}>The AI chooses the layout, sections, style, main button and all the words.</p>
                <button type="submit" className="btn btnPrimary">Create a new design</button>
              </form>
              <form action={generateDraftAction} className={`card ${styles.choice}`}>
                <input type="hidden" name="mode" value="ASSIST" />
                <h2 className={styles.choiceTitle}>Improve what I have</h2>
                <p className={styles.choiceText}>Keep your current layout and look. The AI only improves the words and search listing.</p>
                <button type="submit" className="btn">Improve my words</button>
              </form>
            </div>

            <h2 className={styles.sectionTitle}>Your drafts and versions</h2>
            {revisions.length === 0 ? (
              <p className={styles.sub}>No drafts yet.</p>
            ) : (
              <ul className={styles.revisionList}>
                {revisions.map((r) => (
                  <li key={r.id} className={`card ${styles.revision}`}>
                    <Link href={`/dashboard/storefront/ai/${r.id}`} className={styles.revisionLink}>
                      <span className={styles.revisionName}>
                        Version {r.version} · {STATUS_LABEL[r.status]}
                      </span>
                      <span className={styles.revisionMeta}>
                        {SOURCE_LABEL[r.source]} · {r.createdAt.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                        {r.validation.errors.length > 0 ? ` · ${r.validation.errors.length} to fix` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </main>
  );
}
