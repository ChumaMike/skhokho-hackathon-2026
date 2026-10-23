import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwnerSession, getStaffWorkspaceContext } from "../../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { gatherStorefrontFacts } from "@/modules/storefront-spec/facts";
import { currentSite } from "@/modules/storefront-spec/planner";
import { getOpenDraft } from "@/modules/storefront-spec/revision.service";
import { PAGE_LIMITS, PAGE_SECTION_LABELS, addableSectionTypes, coreSectionType, pageHref, sectionLayoutOptions, type PageSection } from "@/modules/storefront-spec/pages";
import { GALLERY_LAYOUT_LABELS, LAYOUT_LABELS } from "@/modules/storefront-spec/layouts";
import { WORKFLOWS, WORKFLOW_IDS } from "@/modules/storefront-workflows/workflows";

/** Labels for every page-section layout option (gallery, reviews, catalogue). */
const LAYOUT_OPTION_LABELS: Record<string, string> = { ...LAYOUT_LABELS, ...GALLERY_LAYOUT_LABELS };
import DashboardNav from "@/components/DashboardNav";
import StorefrontPreviewFrames from "@/components/dashboard/StorefrontPreviewFrames";
import { addSectionAction, deletePageAction, publishPagesAction, savePageAction } from "../actions";
import styles from "../pages.module.css";

export const dynamic = "force-dynamic";

function faqText(section: Extract<PageSection, { type: "FAQ" }>): string {
  return section.items.map((item) => `${item.q}\n${item.a}`).join("\n\n");
}

/**
 * One page's editor: name, address (policies and custom pages only),
 * where it shows, and its sections in order. Text sections are plain
 * words — blank lines make paragraphs; no HTML, no links. Saved into the
 * working draft; published from the pages list.
 */
export default async function StorefrontPageEditor({
  params,
  searchParams,
}: {
  params: Promise<{ pageId: string }>;
  searchParams: Promise<{ err?: string; saved?: string; published?: string }>;
}) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const { pageId } = await params;
  const sp = await searchParams;

  try {
    await requireStaffPermission("canManageSettings");
  } catch {
    notFound();
  }

  const facts = await gatherStorefrontFacts(session.tenantId);
  const draft = await getOpenDraft(session.tenantId);
  const pages = draft?.spec.site?.pages ?? currentSite(facts).pages;
  const page = pages.find((p) => p.id === pageId);
  if (!page || page.kind === "HOME") notFound();

  const slugEditable = page.kind === "POLICY" || page.kind === "CUSTOM";
  const core = coreSectionType(page.kind);
  const addable = addableSectionTypes(page.kind);
  const issues = (draft?.validation.warnings ?? []).concat(draft?.validation.errors ?? []).filter((i) => i.field === `site.${page.id}`);

  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Storefront · pages</span>
        <h1 className={styles.title}>{page.title}</h1>
        <p className={styles.sub}>
          <Link href="/dashboard/storefront/pages">← All pages</Link>
          {" · "}
          <span className={styles.rowMeta}>{pageHref(page, `/store/${facts.slug}`)}</span>
        </p>
        <DashboardNav current="storefront" {...workspaceContext} />

        {sp.err && <div className="errorBanner">{sp.err}</div>}
        {sp.saved && <div className="successBanner">Saved to your draft. Check the preview below, then publish when you&apos;re ready.</div>}
        {sp.published && <div className="successBanner">Published — this page is live.</div>}

        {draft && (
          <section className={styles.section}>
            <div className={`card ${styles.draftBar}`}>
              <p>
                <strong>Draft v{draft.version}</strong> — this page as customers would see it, on a phone and on a computer.
                {draft.validation.errors.length > 0 && " Fix the draft's problems before publishing."}
              </p>
              <div className={styles.draftActions}>
                <form action={publishPagesAction}>
                  <button type="submit" className="btn btnPrimary" disabled={draft.validation.errors.length > 0}>
                    Publish
                  </button>
                </form>
              </div>
            </div>
            <StorefrontPreviewFrames src={`/preview/storefront/${draft.id}/${page.slug}`} title={page.title} />
          </section>
        )}
        {issues.length > 0 && (
          <div className="card" style={{ padding: "12px 16px", marginBottom: 16 }}>
            <ul className={styles.issueList}>
              {issues.map((issue, i) => (
                <li key={i}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}

        <form action={savePageAction.bind(null, page.id)} className={`card ${styles.form}`}>
          <div className={styles.inline}>
            <div className="field">
              <label className="label" htmlFor="title">Page name</label>
              <input className="input" id="title" name="title" defaultValue={page.title} maxLength={PAGE_LIMITS.title} required />
            </div>
            <div className="field">
              <label className="label" htmlFor="slug">Web address</label>
              <input
                className="input"
                id="slug"
                name="slug"
                defaultValue={page.slug}
                maxLength={PAGE_LIMITS.slug}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                readOnly={!slugEditable}
                aria-describedby="slug-hint"
              />
              <span id="slug-hint" className={styles.hint}>
                {slugEditable ? "Lowercase letters, numbers and dashes." : "Built-in pages keep their address."}
              </span>
            </div>
          </div>

          <div className={styles.inline}>
            <div className="field">
              <label className="label" htmlFor="seoTitle">Search engine title (optional)</label>
              <input className="input" id="seoTitle" name="seoTitle" defaultValue={page.seo?.title ?? ""} maxLength={PAGE_LIMITS.seoTitle} placeholder={`${page.title} — ${facts.name}`} />
            </div>
            <div className="field">
              <label className="label" htmlFor="seoDescription">Search engine description (optional)</label>
              <input className="input" id="seoDescription" name="seoDescription" defaultValue={page.seo?.description ?? ""} maxLength={PAGE_LIMITS.seoDescription} placeholder="One or two plain sentences about this page." />
            </div>
          </div>

          <div className={styles.checks}>
            <label>
              <input type="checkbox" name="visible" defaultChecked={page.visible} /> Customers can open this page
            </label>
            <label>
              <input type="checkbox" name="inNav" defaultChecked={page.inNav} /> Show in the menu
            </label>
            <label>
              <input type="checkbox" name="inFooter" defaultChecked={page.inFooter} /> Show in the footer
            </label>
          </div>

          <h2 className={styles.sectionTitle}>Sections</h2>
          <input type="hidden" name="sectionCount" value={page.sections.length} />
          {page.sections.length === 0 && <p className={styles.hint}>Nothing on this page yet — add a section below.</p>}
          {page.sections.map((section, i) => (
            <div key={i} className={`card ${styles.sectionCard}`}>
              <input type="hidden" name={`section_${i}_type`} value={section.type} />
              <div className={styles.sectionHead}>
                <strong>{PAGE_SECTION_LABELS[section.type]}</strong>
                <div className={styles.sectionControls}>
                  <label>
                    Position <input className="input" type="number" name={`section_${i}_position`} defaultValue={i + 1} min={1} max={PAGE_LIMITS.sectionsPerPage} />
                  </label>
                  {section.type !== core && (
                    <label>
                      <input type="checkbox" name={`section_${i}_remove`} /> Remove
                    </label>
                  )}
                </div>
              </div>
              {section.type === "TEXT" && (
                <>
                  <div className="field">
                    <label className="label" htmlFor={`section_${i}_heading`}>Heading (optional)</label>
                    <input className="input" id={`section_${i}_heading`} name={`section_${i}_heading`} defaultValue={section.heading ?? ""} maxLength={PAGE_LIMITS.heading} />
                  </div>
                  <div className="field">
                    <label className="label" htmlFor={`section_${i}_body`}>Text</label>
                    <textarea className="input" id={`section_${i}_body`} name={`section_${i}_body`} rows={8} defaultValue={section.body} maxLength={PAGE_LIMITS.body} required />
                    <span className={styles.hint}>Leave a blank line between paragraphs. Links and formatting aren&apos;t allowed.</span>
                  </div>
                </>
              )}
              {section.type === "FAQ" && (
                <div className="field">
                  <label className="label" htmlFor={`section_${i}_faq`}>Questions and answers</label>
                  <textarea className="input" id={`section_${i}_faq`} name={`section_${i}_faq`} rows={8} defaultValue={faqText(section)} required />
                  <span className={styles.hint}>One question per block: the first line is the question, the lines under it are the answer. Leave a blank line between questions.</span>
                </div>
              )}
              {section.type === "ACTION" && <input type="hidden" name={`section_${i}_workflow`} value={section.workflow} />}
              {sectionLayoutOptions(section.type).length > 0 && (
                <div className="field">
                  <label className="label" htmlFor={`section_${i}_layout`}>Layout</label>
                  <select className="input" id={`section_${i}_layout`} name={`section_${i}_layout`} defaultValue={"layout" in section && section.layout ? section.layout : ""}>
                    <option value="">Default</option>
                    {sectionLayoutOptions(section.type).map((option) => (
                      <option key={option} value={option}>
                        {LAYOUT_OPTION_LABELS[option] ?? option}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {section.type !== "TEXT" && section.type !== "FAQ" && (
                <p className={styles.hint}>
                  {section.type === "ACTION" && `The ${WORKFLOWS[section.workflow].title.toLowerCase()} form. Requests land in Enquiries.`}
                  {section.type === "CATALOGUE" && "Shows your products or services from the catalogue."}
                  {section.type === "ABOUT" && "Shows your about story and highlights from Storefront words."}
                  {section.type === "HIGHLIGHTS" && "Shows your highlights from Storefront words."}
                  {section.type === "CONTACT" && "Shows your phone, WhatsApp, email and location from Business information."}
                  {section.type === "HOURS" && "Shows your opening hours from Settings."}
                  {section.type === "GALLERY" && "Shows the photos on your products and services."}
                  {section.type === "REVIEWS" && "Shows every published customer review."}
                  {section.type === "TRUST_BAR" && "Shows quick facts such as delivery, collection and booking."}
                  {section.type === "PRIVACY_POINTER" && "Links customers to Skhokho's privacy notice."}
                </p>
              )}
            </div>
          ))}

          <div className={styles.actions}>
            <button type="submit" className="btn btnPrimary">
              Save page
            </button>
            <Link className="btn" href="/dashboard/storefront/pages">
              Back
            </Link>
          </div>
        </form>

        {addable.length > 0 && page.sections.length < PAGE_LIMITS.sectionsPerPage && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Add a section</h2>
            <form action={addSectionAction.bind(null, page.id)} className={`card ${styles.form}`}>
              <div className="field">
                <label className="label" htmlFor="type">Kind of section</label>
                <select className="input" id="type" name="type" defaultValue={addable[0]}>
                  {addable.map((type) => (
                    <option key={type} value={type}>
                      {PAGE_SECTION_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label" htmlFor="heading">Heading (text sections, optional)</label>
                <input className="input" id="heading" name="heading" maxLength={PAGE_LIMITS.heading} />
              </div>
              <div className="field">
                <label className="label" htmlFor="body">Text (text sections)</label>
                <textarea className="input" id="body" name="body" rows={6} maxLength={PAGE_LIMITS.body} />
              </div>
              <div className="field">
                <label className="label" htmlFor="faq">Questions and answers (question sections)</label>
                <textarea className="input" id="faq" name="faq" rows={5} placeholder={"Do you deliver?\nYes, within 10 km of the shop.\n\nCan I pay with card?\nYes, card and cash."} />
              </div>
              {addable.includes("ACTION") && (
                <div className="field">
                  <label className="label" htmlFor="workflow">Which request form (request form sections)</label>
                  <select className="input" id="workflow" name="workflow" defaultValue={facts.workflows[0] ?? "QUOTE_REQUEST"}>
                    {WORKFLOW_IDS.map((id) => (
                      <option key={id} value={id}>
                        {WORKFLOWS[id].title}
                        {facts.workflows.includes(id) ? "" : " (not switched on or not in your plan)"}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <button type="submit" className="btn">
                  Add section
                </button>
              </div>
            </form>
          </section>
        )}

        {page.kind === "CUSTOM" && (
          <section className={styles.section}>
            <form action={deletePageAction.bind(null, page.id)}>
              <button type="submit" className={`btn ${styles.danger}`}>
                Delete this page
              </button>
            </form>
          </section>
        )}
      </div>
    </main>
  );
}
