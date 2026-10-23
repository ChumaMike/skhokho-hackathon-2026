import Link from "next/link";
import { requireOwnerSession, getStaffWorkspaceContext } from "../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { capabilitySet, gatherStorefrontFacts } from "@/modules/storefront-spec/facts";
import { currentSite } from "@/modules/storefront-spec/planner";
import { getOpenDraft } from "@/modules/storefront-spec/revision.service";
import { pageContentFacts } from "@/modules/storefront-spec/validate";
import { pageHasContent, pageHref, pageIsServable, type SitePage } from "@/modules/storefront-spec/pages";
import DashboardNav from "@/components/DashboardNav";
import StorefrontPreviewFrames from "@/components/dashboard/StorefrontPreviewFrames";
import { addPageAction, discardPagesDraftAction, movePageAction, publishPagesAction, togglePageAction } from "./actions";
import styles from "./pages.module.css";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<SitePage["kind"], string> = {
  HOME: "Home",
  CATALOGUE: "Catalogue",
  ABOUT: "About",
  CONTACT: "Contact",
  GALLERY: "Gallery",
  REVIEWS: "Reviews",
  ACTION: "Request form",
  POLICY: "Policy",
  CUSTOM: "Your page",
};

/**
 * Dashboard › Storefront › Pages: every page of the business's website,
 * its address, whether it shows, where it sits in the menu and footer.
 * Changes are saved into the working draft (revision.service.ts) and go
 * live when the owner publishes — the draft bar at the top says so.
 */
export default async function StorefrontPagesPage({ searchParams }: { searchParams: Promise<{ err?: string; saved?: string; published?: string; discarded?: string }> }) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const sp = await searchParams;

  let permitted = true;
  try {
    await requireStaffPermission("canManageSettings");
  } catch {
    permitted = false;
  }

  const facts = await gatherStorefrontFacts(session.tenantId);
  const draft = permitted ? await getOpenDraft(session.tenantId) : null;
  const pages = draft?.spec.site?.pages ?? currentSite(facts).pages;
  const contentFacts = pageContentFacts(facts);
  const caps = capabilitySet(facts);
  const basePath = `/store/${facts.slug}`;
  const errors = draft?.validation.errors ?? [];

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Storefront</span>
        <h1 className={styles.title}>Your website pages</h1>
        <p className={styles.sub}>
          Switch pages on or off, put them in the right order and write your own policies. Built-in pages keep their address; your own pages can
          have any address that isn&apos;t taken.
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
            {sp.saved && <div className="successBanner">Saved to your draft. Publish when you&apos;re happy with it.</div>}
            {sp.published && <div className="successBanner">Published — your pages are live.</div>}

            {sp.discarded && <div className="successBanner">Draft discarded. Your live pages are unchanged.</div>}
            {draft ? (
              <>
                <div className={`card ${styles.draftBar}`}>
                  <p>
                    <strong>Draft v{draft.version}</strong> — changes here are not live yet. Check the preview below on phone and desktop, then publish.
                    {errors.length > 0 && " Fix the problems below before publishing."}
                  </p>
                  <div className={styles.draftActions}>
                    <Link className="btn" href={`/dashboard/storefront/ai/${draft.id}`}>
                      Words, style and design
                    </Link>
                    <form action={discardPagesDraftAction}>
                      <button type="submit" className="btn">
                        Discard draft
                      </button>
                    </form>
                    <form action={publishPagesAction}>
                      <button type="submit" className="btn btnPrimary" disabled={errors.length > 0}>
                        Publish
                      </button>
                    </form>
                  </div>
                  {errors.length > 0 && (
                    <ul className={styles.issueList}>
                      {errors.map((issue, i) => (
                        <li key={i}>{issue.fixHref ? <Link href={issue.fixHref}>{issue.message}</Link> : issue.message}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <section className={styles.section}>
                  <h2 className={styles.sectionTitle}>Preview of the draft home page</h2>
                  <StorefrontPreviewFrames src={`/preview/storefront/${draft.id}`} title="Home" />
                  <p className={styles.hint}>Tap a page in the preview&apos;s menu to see it as a customer would. Each page&apos;s editor has its own preview too.</p>
                </section>
              </>
            ) : (
              <p className={styles.sub}>These are your live pages. Any change you make starts a draft you can preview before publishing.</p>
            )}

            <ul className={styles.list}>
              {pages.map((page, index) => {
                const servable = pageIsServable(page, { capabilities: caps, workflows: facts.workflows });
                const hasContent = pageHasContent(page, contentFacts);
                const live = page.visible && servable && hasContent;
                return (
                  <li key={page.id} className={`card ${styles.row}`}>
                    <div>
                      <p className={styles.rowTitle}>
                        {page.title} <span className={styles.badge}>{KIND_LABEL[page.kind]}</span>
                      </p>
                      <p className={styles.rowMeta}>{pageHref(page, basePath)}</p>
                    </div>
                    <div className={styles.badges}>
                      <span className={`${styles.badge} ${live ? styles.badgeOn : styles.badgeOff}`}>
                        {!servable ? "Needs a capability" : !page.visible ? "Hidden" : !hasContent ? "Nothing to show yet" : "Showing"}
                      </span>
                      {page.kind !== "HOME" && <span className={styles.badge}>{page.inNav ? "In menu" : "Not in menu"}</span>}
                      {page.kind !== "HOME" && <span className={styles.badge}>{page.inFooter ? "In footer" : "Not in footer"}</span>}
                    </div>
                    <div className={styles.rowActions}>
                      {page.kind !== "HOME" && (
                        <>
                          <form action={movePageAction.bind(null, page.id, "up")}>
                            <button type="submit" className={`btn ${styles.iconBtn}`} disabled={index <= 1} aria-label={`Move ${page.title} up`}>
                              ↑
                            </button>
                          </form>
                          <form action={movePageAction.bind(null, page.id, "down")}>
                            <button type="submit" className={`btn ${styles.iconBtn}`} disabled={index >= pages.length - 1} aria-label={`Move ${page.title} down`}>
                              ↓
                            </button>
                          </form>
                          <form action={togglePageAction.bind(null, page.id, "visible")}>
                            <button type="submit" className={`btn ${styles.iconBtn}`}>
                              {page.visible ? "Hide" : "Show"}
                            </button>
                          </form>
                          <form action={togglePageAction.bind(null, page.id, "inNav")}>
                            <button type="submit" className={`btn ${styles.iconBtn}`}>
                              {page.inNav ? "Remove from menu" : "Add to menu"}
                            </button>
                          </form>
                        </>
                      )}
                      <Link className={`btn ${styles.iconBtn}`} href={page.kind === "HOME" ? "/dashboard/storefront/design" : `/dashboard/storefront/pages/${page.id}`}>
                        {page.kind === "HOME" ? "Design" : "Edit"}
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>

            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Add a page</h2>
              <form action={addPageAction} className={`card ${styles.form}`}>
                <div className={styles.inline}>
                  <div className="field">
                    <label className="label" htmlFor="title">Page name</label>
                    <input className="input" id="title" name="title" maxLength={40} placeholder="e.g. Our team" required />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor="slug">Web address (optional)</label>
                    <input className="input" id="slug" name="slug" maxLength={40} placeholder="our-team" pattern="[a-z0-9]+(-[a-z0-9]+)*" />
                  </div>
                </div>
                <p className={styles.hint}>New pages start hidden. Add your text, then show them.</p>
                <div>
                  <button type="submit" className="btn btnPrimary">
                    Add page
                  </button>
                </div>
              </form>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
