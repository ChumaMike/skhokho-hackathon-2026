import { adminPage } from "@/modules/platform-admin/page-guard";
import { aiEditSummary, listPatternCandidates } from "@/modules/storefront-learning/patterns";
import { reviewPatternAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * INTERNAL platform review of learned storefront patterns. Platform super
 * admins only — merchants never see this; anyone else gets a plain 404.
 * Evidence is aggregate across businesses; no business is named here.
 */
export default async function StorefrontPatternsPage() {
  await adminPage("ai.view");

  const [candidates, edits] = await Promise.all([listPatternCandidates(), aiEditSummary()]);

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Platform</span>
        <h1>Storefront patterns</h1>
        <p>
          Structures that performed better than their vertical across several businesses. Nothing here is used for new
          storefronts until it is approved.
        </p>

        {candidates.length === 0 ? (
          <div className="card">
            <p>No candidate patterns yet.</p>
          </div>
        ) : (
          candidates.map((c) => {
            const pattern = c.pattern as { sections?: string[]; ctaAction?: string };
            const evidence = c.evidence as { businesses?: number; visits?: number; conversionRate?: number; baselineRate?: number; lift?: number; windowDays?: number };
            return (
              <div key={c.id} className="card" style={{ display: "grid", gap: 8 }}>
                <p>
                  <strong>{c.vertical}</strong> · {c.templateId || "CLASSIC"} · <em>{c.status}</em>
                </p>
                <p>
                  Sections: {pattern.sections?.join(" → ")} · Main action: {pattern.ctaAction}
                </p>
                <p>
                  {evidence.businesses} businesses · {evidence.visits} home visits · conversion {((evidence.conversionRate ?? 0) * 100).toFixed(1)}% vs{" "}
                  {((evidence.baselineRate ?? 0) * 100).toFixed(1)}% for the vertical ({Math.round((evidence.lift ?? 0) * 100)}% lift, last {evidence.windowDays} days)
                </p>
                {c.reviewedAt && (
                  <p>
                    Reviewed {c.reviewedAt.toISOString().slice(0, 10)}
                    {c.reviewNote ? ` — ${c.reviewNote}` : ""}
                  </p>
                )}
                <form action={reviewPatternAction} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <input type="hidden" name="id" value={c.id} />
                  <input name="note" maxLength={500} placeholder="Review note (optional)" aria-label="Review note" />
                  {c.status !== "APPROVED" && (
                    <button type="submit" name="decision" value="APPROVED">
                      Approve
                    </button>
                  )}
                  {c.status === "CANDIDATE" && (
                    <button type="submit" name="decision" value="REJECTED">
                      Reject
                    </button>
                  )}
                  {c.status === "APPROVED" && (
                    <button type="submit" name="decision" value="RETIRED">
                      Retire
                    </button>
                  )}
                </form>
              </div>
            );
          })
        )}

        <h2>How merchants edit AI drafts (last 90 days)</h2>
        {edits.length === 0 ? (
          <p>No published AI drafts yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Vertical</th>
                <th>Published drafts</th>
                <th>Changed template</th>
                <th>Changed sections</th>
                <th>Changed main action</th>
                <th>Rewrote copy</th>
              </tr>
            </thead>
            <tbody>
              {edits.map((e) => (
                <tr key={e.vertical}>
                  <td>{e.vertical}</td>
                  <td>{e.drafts}</td>
                  <td>{e.templateChanged}</td>
                  <td>{e.sectionsChanged}</td>
                  <td>{e.ctaChanged}</td>
                  <td>{e.copyChanged}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
