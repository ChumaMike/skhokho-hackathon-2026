import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwnerSession, getStaffWorkspaceContext } from "../../../session";
import { requireStaffPermission } from "@/lib/auth/guards";
import { getRevision } from "@/modules/storefront-spec/revision.service";
import { gatherStorefrontFacts } from "@/modules/storefront-spec/facts";
import { allowedActions, planStorefront } from "@/modules/storefront-spec/planner";
import { getTemplate, type TemplateId } from "@/modules/storefront-spec/templates";
import { HOME_SECTIONS, SPEC_PRESETS, SPEC_LIMITS, defaultCtaLabel } from "@/modules/storefront-spec/spec";
import { LAYOUT_LABELS, allowedLayouts } from "@/modules/storefront-spec/layouts";
import { STOREFRONT_PRESET_LABELS } from "@/modules/tenant/storefront-presets";
import DashboardNav from "@/components/DashboardNav";
import { saveDraftAction, publishDraftAction, discardDraftAction } from "../actions";
import styles from "../ai.module.css";

export const dynamic = "force-dynamic";

const SECTION_LABEL = { TRUST_BAR: "Quick facts bar", CATALOGUE: "Products / services", ABOUT: "About you", REVIEWS: "Customer reviews" } as const;
const ACTION_LABEL = {
  ORDER: "Order online",
  BOOK: "Book an appointment",
  ENQUIRE: "Send a request (quote, enquiry, pickup or callback)",
  WHATSAPP: "Chat on WhatsApp",
  CALL: "Call you",
  VISIT: "Visit you",
  BROWSE: "Browse",
  LOYALTY: "Join your rewards",
} as const;

export default async function StorefrontDraftPage({
  params,
  searchParams,
}: {
  params: Promise<{ revisionId: string }>;
  searchParams: Promise<{ err?: string; saved?: string; published?: string }>;
}) {
  const session = await requireOwnerSession();
  const workspaceContext = await getStaffWorkspaceContext(session);
  const { revisionId } = await params;
  const sp = await searchParams;

  try {
    await requireStaffPermission("canManageSettings");
  } catch {
    notFound();
  }
  const revision = await getRevision(session.tenantId, revisionId);
  if (!revision) notFound();

  const facts = await gatherStorefrontFacts(session.tenantId);
  const { spec, validation } = revision;
  // The only actions this business can offer today on this draft's design — the form never lists others.
  const actions = allowedActions(facts, spec.template, spec.templateId ?? null);
  if (!actions.includes(spec.cta.action)) actions.unshift(spec.cta.action);
  // Designs this business fits today (plus the draft's own, so it stays selectable).
  const available: TemplateId[] = planStorefront(facts, "GENERATE").availableTemplateIds;
  const designs: (TemplateId | null)[] = [null, ...available];
  if (spec.templateId && !available.includes(spec.templateId)) designs.push(spec.templateId);
  const current = spec.templateId ? getTemplate(spec.templateId) : null;
  const editable = revision.status === "DRAFT";
  const restorable = revision.status === "ARCHIVED" && revision.publishedAt !== null;
  const previewSrc = `/preview/storefront/${revision.id}`;

  return (
    <main className="shell">
      <div className="column wide">
        <span className="eyebrow">Storefront · version {revision.version}</span>
        <h1 className={styles.title}>{editable ? "Review your storefront draft" : revision.status === "PUBLISHED" ? "Your live storefront" : "An earlier version"}</h1>
        <DashboardNav current="storefront" {...workspaceContext} />
        <p className={styles.sub}>
          <Link href="/dashboard/storefront/ai">← All drafts</Link>
        </p>

        {sp.err && <div className="errorBanner">{sp.err}</div>}
        {sp.saved && <div className="successBanner">Changes saved. Check the preview, then publish when you&apos;re happy.</div>}
        {sp.published && <div className="successBanner">Published — this is now your live storefront.</div>}
        {revision.aiNote && <div className={`card ${styles.note}`}>{revision.aiNote}</div>}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Why it looks like this</h2>
          <p className={styles.sub}>{spec.strategy.rationale}</p>
          {spec.strategy.audience && <p className={styles.sub}>Made for: {spec.strategy.audience}</p>}
          <div className={`card ${styles.note}`}>
            <strong>Design: {current ? current.name : "Classic shopfront"}</strong>
            <p className={styles.sub} style={{ margin: "4px 0 0" }}>
              {current ? current.summary : "A general shopfront with your featured items, story and contact details."}
            </p>
            {current && (
              <ul className={styles.designFacts}>
                <li>Cover photo: {current.imagery.hero}</li>
                <li>Item photos: {current.imagery.items}</li>
                <li>On phones: {current.responsive.mobile}</li>
                <li>On computers: {current.responsive.desktop}</li>
              </ul>
            )}
          </div>
          {spec.strategy.suggestions && spec.strategy.suggestions.length > 0 && (
            <div className={`card ${styles.note}`}>
              <strong>Suggestions to make it better</strong>
              <ul className={styles.designFacts}>
                {spec.strategy.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {(validation.errors.length > 0 || validation.warnings.length > 0 || validation.missing.length > 0) && (
          <section className={styles.section}>
            {validation.errors.length > 0 && (
              <div className={`card ${styles.issues} ${styles.issuesError}`}>
                <h3 className={styles.issuesTitle}>Fix before publishing</h3>
                <ul>
                  {validation.errors.map((issue, i) => (
                    <li key={`e${i}`}>{issue.fixHref ? <Link href={issue.fixHref}>{issue.message}</Link> : issue.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {validation.warnings.length > 0 && (
              <div className={`card ${styles.issues}`}>
                <h3 className={styles.issuesTitle}>Worth a look</h3>
                <ul>
                  {validation.warnings.map((issue, i) => (
                    <li key={`w${i}`}>{issue.fixHref ? <Link href={issue.fixHref}>{issue.message}</Link> : issue.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {validation.missing.length > 0 && (
              <div className={`card ${styles.issues}`}>
                <h3 className={styles.issuesTitle}>Make it even better</h3>
                <ul>
                  {validation.missing.map((issue, i) => (
                    <li key={`m${i}`}>{issue.fixHref ? <Link href={issue.fixHref}>{issue.message}</Link> : issue.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Preview</h2>
          <div className={styles.previews}>
            <figure className={styles.previewPhone}>
              <iframe src={previewSrc} title="Phone preview" className={styles.framePhone} loading="lazy" />
              <figcaption>Phone</figcaption>
            </figure>
            <figure className={styles.previewDesktop}>
              <div className={styles.desktopViewport}>
                <iframe src={previewSrc} title="Desktop preview" className={styles.frameDesktop} loading="lazy" />
              </div>
              <figcaption>Desktop</figcaption>
            </figure>
          </div>
          <p className={styles.sub}>
            <a href={previewSrc} target="_blank" rel="noopener noreferrer">Open the preview full screen ↗</a>
            {" · "}
            Other pages of this draft:{" "}
            {(spec.site?.pages ?? [])
              .filter((p) => p.kind !== "HOME" && p.visible)
              .map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ", "}
                  <a href={`${previewSrc}/${p.slug}`} target="_blank" rel="noopener noreferrer">
                    {p.title}
                  </a>
                </span>
              ))}
          </p>
        </section>

        {editable && (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Edit</h2>
            <form action={saveDraftAction.bind(null, revision.id)} className={`card ${styles.form}`}>
              <div className="field">
                <label className="label" htmlFor="templateId">Design</label>
                <select className="input" id="templateId" name="templateId" defaultValue={spec.templateId ?? "CLASSIC"}>
                  {designs.map((id) => (
                    <option key={id ?? "CLASSIC"} value={id ?? "CLASSIC"}>
                      {id ? getTemplate(id).name : "Classic shopfront"}
                      {id && !available.includes(id) ? " (no longer fits your business)" : ""}
                    </option>
                  ))}
                </select>
                <span className={styles.hint}>Changing the design resets the layout, style and main button to suit it — your words are kept.</span>
              </div>
              <div className="field">
                <label className="label" htmlFor="heroHeadline">Headline</label>
                <input className="input" id="heroHeadline" name="heroHeadline" defaultValue={spec.content.heroHeadline} maxLength={SPEC_LIMITS.headline} required />
              </div>
              <div className="field">
                <label className="label" htmlFor="heroSubline">Line under the headline</label>
                <input className="input" id="heroSubline" name="heroSubline" defaultValue={spec.content.heroSubline ?? ""} maxLength={SPEC_LIMITS.subline} />
              </div>
              <div className="field">
                <label className="label" htmlFor="aboutBody">About you</label>
                <textarea className="input" id="aboutBody" name="aboutBody" rows={4} defaultValue={spec.content.aboutBody ?? ""} maxLength={SPEC_LIMITS.about} />
              </div>
              <div className="field">
                <label className="label" htmlFor="highlights">Highlights (one per line, up to {SPEC_LIMITS.highlights})</label>
                <textarea className="input" id="highlights" name="highlights" rows={3} defaultValue={spec.content.highlights.join("\n")} />
              </div>
              <div className="field">
                <label className="label" htmlFor="process">How it works (one step per line as &quot;Step: what happens&quot;, up to {SPEC_LIMITS.processSteps})</label>
                <textarea
                  className="input"
                  id="process"
                  name="process"
                  rows={3}
                  defaultValue={(spec.content.process ?? []).map((s) => `${s.title}: ${s.body}`).join("\n")}
                  placeholder={"Tell us what you need: send a photo and a few words.\nWe quote: usually the same day.\nWe do the work: you approve first."}
                />
                <span className={styles.hint}>Shown by the portfolio design. Leave empty to show nothing.</span>
              </div>

              <div className={styles.row}>
                <div className="field">
                  <label className="label" htmlFor="ctaAction">Main button lets customers…</label>
                  <select className="input" id="ctaAction" name="ctaAction" defaultValue={spec.cta.action}>
                    {actions.map((a) => (
                      <option key={a} value={a}>{ACTION_LABEL[a]}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="ctaLabel">Button words</label>
                  <input className="input" id="ctaLabel" name="ctaLabel" defaultValue={spec.cta.label} maxLength={SPEC_LIMITS.ctaLabel} placeholder={defaultCtaLabel(spec.cta.action, spec.template)} required />
                </div>
              </div>

              <div className={styles.row}>
                <div className="field">
                  <label className="label" htmlFor="presetId">Style</label>
                  <select className="input" id="presetId" name="presetId" defaultValue={spec.theme.presetId}>
                    {SPEC_PRESETS.map((p) => (
                      <option key={p} value={p}>{STOREFRONT_PRESET_LABELS[p]}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="label" htmlFor="primaryColor">Main colour</label>
                  <input className="input" id="primaryColor" name="primaryColor" type="color" defaultValue={spec.theme.primaryColor} />
                </div>
                <div className="field">
                  <label className="label" htmlFor="accentColor">Second colour</label>
                  <input className="input" id="accentColor" name="accentColor" type="color" defaultValue={spec.theme.accentColor} />
                </div>
              </div>

              <fieldset className={styles.sections}>
                <legend className="label">Home page sections (the top banner always comes first, contact always last)</legend>
                {spec.home.sections.map((section, index) => (
                  <div key={section.id} className={styles.sectionRow}>
                    <input
                      className={`input ${styles.position}`}
                      type="number"
                      min={1}
                      max={HOME_SECTIONS.length}
                      name={`order_${section.id}`}
                      defaultValue={index + 1}
                      aria-label={`Position of ${SECTION_LABEL[section.id]}`}
                    />
                    <label>
                      <input type="checkbox" name={`visible_${section.id}`} defaultChecked={section.visible} /> {SECTION_LABEL[section.id]}
                    </label>
                    <select className="input" name={`layout_${section.id}`} defaultValue={section.layout ?? ""} aria-label={`Layout of ${SECTION_LABEL[section.id]}`}>
                      <option value="">Design default</option>
                      {allowedLayouts(section.id, spec.template).map((layout) => (
                        <option key={layout} value={layout}>
                          {LAYOUT_LABELS[layout]}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </fieldset>

              <div className="field">
                <label className="label" htmlFor="seoTitle">Search engine title</label>
                <input className="input" id="seoTitle" name="seoTitle" defaultValue={spec.seo.title} maxLength={SPEC_LIMITS.seoTitle} required />
              </div>
              <div className="field">
                <label className="label" htmlFor="seoDescription">Search engine description</label>
                <textarea className="input" id="seoDescription" name="seoDescription" rows={2} defaultValue={spec.seo.description} maxLength={SPEC_LIMITS.seoDescription} required />
              </div>

              <button type="submit" className="btn">Save changes</button>
            </form>
          </section>
        )}

        {(editable || restorable) && (
          <section className={styles.section}>
            <div className={styles.actions}>
              <form action={publishDraftAction.bind(null, revision.id)}>
                <button type="submit" className="btn btnPrimary" disabled={validation.errors.length > 0}>
                  {restorable ? "Restore this version" : "Approve and publish"}
                </button>
              </form>
              {editable && (
                <form action={discardDraftAction.bind(null, revision.id)}>
                  <button type="submit" className="btn">Discard draft</button>
                </form>
              )}
            </div>
            {validation.errors.length > 0 && <p className={styles.sub}>Fix the items above to publish.</p>}
          </section>
        )}
      </div>
    </main>
  );
}
