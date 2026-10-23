"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Business, BusinessSubscription } from "@prisma/client";
import type { BusinessCatalog } from "@/modules/catalog/catalog.service";
import type { RatingSummary, listPublishedReviews } from "@/modules/reviews/review.service";
import type { BusinessCapability } from "@/modules/tenant/capabilities";
import type {
  StorefrontProfile,
  StorefrontThemeConfig,
  StorefrontPresetId,
  HeroMode,
  PrimaryCustomerAction,
  StorefrontVoiceTone,
} from "@/modules/tenant/storefront-theme";
import { STYLE_PRESETS } from "@/modules/tenant/storefront-presets";
import {
  type StorefrontContent,
  MAX_HEADLINE_LENGTH,
  MAX_SUBHEADLINE_LENGTH,
  MAX_ABOUT_BODY_LENGTH,
  MAX_HIGHLIGHT_ITEM_LENGTH,
  MAX_HIGHLIGHT_ITEMS,
} from "@/modules/tenant/storefront-content";
import {
  STOREFRONT_TEMPLATES,
  STOREFRONT_PAGE_LABELS,
  suggestTemplateForCategory,
  GENERATED_TEMPLATE_ID,
  type StorefrontTemplateId,
  type StorefrontPageId,
} from "@/modules/tenant/storefront-templates";
import StorefrontView from "@/components/StorefrontView";
import StorefrontPresetPreviewCard from "@/components/StorefrontPresetPreviewCard";
import {
  saveStorefrontDraft,
  saveStorefrontColors,
  saveStorefrontContent,
  saveStorefrontTemplate,
  generateStorefrontTemplate,
  acceptGeneratedStorefrontTemplate,
  generateStorefrontContentDraft,
  skipStorefrontInterview,
  uploadStorefrontCover,
} from "./actions";
import styles from "./wizard.module.css";

type StorefrontBusiness = Business & { subscription: BusinessSubscription | null };
type StorefrontReview = Awaited<ReturnType<typeof listPublishedReviews>>[number];

const GOAL_OPTIONS: { id: "ORDERS" | "BOOKINGS" | "WHATSAPP_LEADS" | "FOOT_TRAFFIC" | "BRAND_ONLY"; label: string; requires?: BusinessCapability[] }[] = [
  { id: "ORDERS", label: "Get more orders", requires: ["ORDERS"] },
  { id: "BOOKINGS", label: "Get more bookings", requires: ["BOOKINGS"] },
  { id: "WHATSAPP_LEADS", label: "Get more WhatsApp messages" },
  { id: "FOOT_TRAFFIC", label: "Get more visitors to my location" },
  { id: "BRAND_ONLY", label: "Just look professional online" },
];

const VOICE_OPTIONS: { id: StorefrontVoiceTone; label: string }[] = [
  { id: "FRIENDLY", label: "Friendly" },
  { id: "PROFESSIONAL", label: "Professional" },
  { id: "PLAYFUL", label: "Playful" },
  { id: "DIRECT", label: "Direct" },
];

const HERO_OPTIONS: { id: HeroMode; label: string }[] = [
  { id: "MINIMAL", label: "Simple — no banner" },
  { id: "COLOUR", label: "A bold colour band" },
  { id: "LOGO", label: "My logo, front and centre" },
  { id: "IMAGE", label: "A cover photo" },
];

function deriveAvailableActions(
  capabilities: Set<BusinessCapability>,
  business: { whatsapp: string | null; phone: string | null; address: string | null; suburb: string | null; city: string | null },
): PrimaryCustomerAction[] {
  const actions: PrimaryCustomerAction[] = [];
  if (capabilities.has("PRODUCTS") && capabilities.has("ORDERS")) actions.push("ORDER");
  if (capabilities.has("SERVICES") && capabilities.has("BOOKINGS")) actions.push("BOOK");
  if (business.whatsapp) actions.push("WHATSAPP");
  if (business.phone) actions.push("CALL");
  if (business.address || business.suburb || business.city) actions.push("VISIT");
  if (capabilities.has("LOYALTY")) actions.push("LOYALTY");
  actions.push("BROWSE");
  return actions;
}

const ACTION_LABELS: Record<PrimaryCustomerAction, string> = {
  ORDER: "Order",
  BOOK: "Book",
  ENQUIRE: "Send a request (quote, enquiry, pickup or callback)",
  WHATSAPP: "Message on WhatsApp",
  CALL: "Call",
  VISIT: "Visit us",
  BROWSE: "Just browse",
  LOYALTY: "Join for rewards",
};

const STEP_TITLES = [
  "What should customers do first?",
  "Which feels closest to your business?",
  "Which pages does your storefront need?",
  "Do you already have colours?",
  "Logo & cover photo",
  "What should customers notice first?",
  "How should we speak to your customers?",
  "What should customers know about you?",
  "Write your storefront's words",
  "Review your storefront",
];

/** The one place the content step's index lives — StorefrontDesignPage's `?focus=content` deep link reads this indirectly (via `initialFocus` below) rather than hardcoding the number itself, so reordering STEP_TITLES can never silently break that link. */
const CONTENT_STEP_INDEX = STEP_TITLES.indexOf("Write your storefront's words");

export default function StorefrontDesignWizard({
  business,
  capabilities: capabilitiesArray,
  catalog,
  rating,
  reviews,
  initialConfig,
  initialContent,
  initialTemplateId,
  initialGeneratedPages,
  initialFocus,
}: {
  business: StorefrontBusiness;
  capabilities: BusinessCapability[];
  catalog: BusinessCatalog;
  rating: RatingSummary;
  reviews: StorefrontReview[];
  initialConfig: { profile: StorefrontProfile; theme: StorefrontThemeConfig };
  initialContent: StorefrontContent;
  /** null means no BusinessProfile row exists yet (interview skipped/never started) — a real, valid state, not an error. */
  initialTemplateId: StorefrontTemplateId | null;
  /** Set when the business's active template is GENERATED and its generatedTemplate JSON validated — reopens the wizard showing that state instead of defaulting back to a suggested static card. */
  initialGeneratedPages: StorefrontPageId[] | null;
  /** Set by StorefrontDesignPage's `?focus=content` deep link (the Storefront Overview's "Storefront words" quick-access card) — opens the wizard straight on the content step instead of step 0, so editing copy doesn't require re-walking the whole flow every time. */
  initialFocus?: "content";
}) {
  const router = useRouter();
  const capabilities = new Set(capabilitiesArray);
  const availableActions = deriveAvailableActions(capabilities, business);

  const [step, setStep] = useState(initialFocus === "content" ? CONTENT_STEP_INDEX : 0);
  const [profile, setProfile] = useState<StorefrontProfile>(initialConfig.profile);
  const [theme, setTheme] = useState<StorefrontThemeConfig>(initialConfig.theme);
  const [content, setContent] = useState<StorefrontContent>(initialContent);
  // Bumped whenever a generation replaces `content` wholesale, forcing the
  // uncontrolled headline/subheadline/about inputs below (defaultValue, same
  // onBlur-commit pattern the rest of this wizard already uses) to remount
  // with the new text — defaultValue alone only applies on first mount, so
  // without this a successful generation would update state but leave the
  // visible fields showing the old (usually empty) values.
  const [contentVersion, setContentVersion] = useState(0);
  const [contentGenerating, setContentGenerating] = useState(false);
  const [contentGenerateError, setContentGenerateError] = useState<string | null>(null);
  const [contentSource, setContentSource] = useState<"rules" | "model" | null>(null);
  const [templateId, setTemplateId] = useState<StorefrontTemplateId>(
    initialTemplateId ?? suggestTemplateForCategory(business.category),
  );
  const [generatedPages, setGeneratedPages] = useState<StorefrontPageId[] | null>(initialGeneratedPages);
  const [generatedSource, setGeneratedSource] = useState<"rules" | "model">("rules");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [colors, setColors] = useState({
    primaryColor: business.primaryColor ?? "#E8A020",
    accentColor: business.accentColor ?? "#F59E0B",
  });
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState(business.bannerUrl);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const goalOptions = GOAL_OPTIONS.filter((g) => !g.requires || g.requires.every((c) => capabilities.has(c)));
  const emphasisOptions = [
    { id: "STORY" as const, label: "My story first" },
    { id: "CATALOGUE" as const, label: capabilities.has("SERVICES") && !capabilities.has("PRODUCTS") ? "My services first" : "My products first" },
  ];

  const previewBusiness: StorefrontBusiness = { ...business, primaryColor: colors.primaryColor, accentColor: colors.accentColor, bannerUrl };

  function next() {
    setStep((s) => Math.min(s + 1, STEP_TITLES.length - 1));
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }

  // The preset picker is the ONE "how should this look?" question — feeling
  // is derived from it, not asked separately (see storefront-theme.ts's own
  // comment: "the Feeling step's answer IS a preset id, one taxonomy, not a
  // second one that can drift"). Previously a separate text-list step asked
  // this exact question before the visual picker; merged away as redundant.
  function selectPreset(id: StorefrontPresetId) {
    setTheme((t) => ({ ...t, presetId: id }));
    setProfile((p) => ({ ...p, feeling: id }));
  }

  /** Picking a static card always overrides a previous generation — never both at once. */
  function selectTemplate(id: StorefrontTemplateId) {
    setTemplateId(id);
    setGeneratedPages(null);
    setGenerateError(null);
  }

  async function handleGenerateTemplate() {
    setGenerating(true);
    setGenerateError(null);
    const result = await generateStorefrontTemplate();
    setGenerating(false);
    if (!result.ok) {
      setGenerateError(result.error);
      return;
    }
    setGeneratedPages(result.pages);
    setGeneratedSource(result.source);
  }

  /**
   * "Write this for me" — generates a full draft and replaces `content`
   * wholesale, same review-before-save posture as handleGenerateTemplate:
   * nothing is persisted here, the owner still has to reach "Use this
   * design" (or edit individual fields first) before anything saves.
   */
  async function handleGenerateContent() {
    setContentGenerating(true);
    setContentGenerateError(null);
    const result = await generateStorefrontContentDraft();
    setContentGenerating(false);
    if (!result.ok) {
      setContentGenerateError(result.error);
      return;
    }
    setContent(result.content);
    setContentVersion((v) => v + 1);
    setContentSource(result.source);
  }

  async function handleCoverUpload(file: File) {
    setCoverUploading(true);
    setCoverError(null);
    const formData = new FormData();
    formData.set("cover", file);
    const result = await uploadStorefrontCover(formData);
    setCoverUploading(false);
    if (result.error) {
      setCoverError(result.error);
      return;
    }
    if (result.url) setBannerUrl(result.url);
  }

  async function handleUseThisDesign() {
    setSaving(true);
    setSaveError(null);

    const colorsChanged = colors.primaryColor !== (business.primaryColor ?? "#E8A020") || colors.accentColor !== (business.accentColor ?? "#F59E0B");
    if (colorsChanged) {
      const colorResult = await saveStorefrontColors(colors);
      if (!colorResult.ok) {
        setSaving(false);
        setSaveError(colorResult.error);
        return;
      }
    }

    if (generatedPages) {
      // Generated pages take priority over the static grid whenever present
      // — selecting a static card clears generatedPages (see selectTemplate
      // below), so this only fires when the owner actually generated and
      // kept a custom page set.
      const generatedResult = await acceptGeneratedStorefrontTemplate(generatedPages, generatedSource);
      if (!generatedResult.ok) {
        setSaving(false);
        setSaveError(generatedResult.error);
        return;
      }
    } else {
      const templateChanged = templateId !== (initialTemplateId ?? suggestTemplateForCategory(business.category));
      if (templateChanged) {
        const templateResult = await saveStorefrontTemplate(templateId);
        if (!templateResult.ok) {
          setSaving(false);
          setSaveError(templateResult.error);
          return;
        }
      }
    }

    const contentResult = await saveStorefrontContent({
      hero: content.hero,
      about: content.about,
      // Blank in-progress rows (from "+ Add a reason" not yet typed into)
      // never get persisted — setStorefrontContent's own sanitizer would
      // drop them anyway, but filtering here keeps the saved state honest
      // with what the preview actually showed.
      highlights: { items: content.highlights.items.filter((item) => item.trim()) },
    });
    if (!contentResult.ok) {
      setSaving(false);
      setSaveError(contentResult.error);
      return;
    }

    const result = await saveStorefrontDraft({
      profile: { ...profile, interviewCompletedAt: new Date().toISOString() },
      theme,
    });
    setSaving(false);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    router.push("/dashboard/storefront");
    router.refresh();
  }

  async function handleSkip() {
    await skipStorefrontInterview();
  }

  return (
    <div className={styles.wizard}>
      <div className={styles.progress}>
        Step {step + 1} of {STEP_TITLES.length}
      </div>
      <h1 className={styles.stepTitle}>{STEP_TITLES[step]}</h1>

      {step === 0 && (
        <div className={styles.optionGrid}>
          <p className={styles.hint}>
            This helps us tailor future suggestions — choose your main action for customers on the next screen.
          </p>
          {goalOptions.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`${styles.optionBtn} ${profile.goal === g.id ? styles.optionBtnSelected : ""}`}
              onClick={() => setProfile((p) => ({ ...p, goal: g.id }))}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}

      {step === 1 && (
        <div className={styles.previewGrid}>
          {(Object.keys(STYLE_PRESETS) as StorefrontPresetId[]).map((id) => (
            <StorefrontPresetPreviewCard
              key={id}
              presetId={id}
              businessName={business.name}
              primaryColor={colors.primaryColor}
              accentColor={colors.accentColor}
              selected={theme.presetId === id}
              onSelect={() => selectPreset(id)}
            />
          ))}
        </div>
      )}

      {step === 2 && (
        <div className={styles.optionGrid}>
          <p className={styles.hint}>
            Every storefront gets a Home page. Some businesses also want a Gallery, an About page, or a Contact page —
            pick whichever set fits yours.
          </p>
          {(Object.keys(STOREFRONT_TEMPLATES) as StorefrontTemplateId[]).map((id) => {
            const template = STOREFRONT_TEMPLATES[id];
            const isSuggested = id === suggestTemplateForCategory(business.category);
            return (
              <button
                key={id}
                type="button"
                className={`${styles.optionBtn} ${templateId === id && !generatedPages ? styles.optionBtnSelected : ""}`}
                onClick={() => selectTemplate(id)}
              >
                <span>
                  {template.label}
                  {isSuggested && <span className={styles.suggestedTag}> · Suggested for you</span>}
                </span>
                <span className={styles.optionBtnDescription}>{template.description}</span>
                <span className={styles.pageBadges}>
                  {template.pages.map((pageId) => (
                    <span key={pageId} className={styles.pageBadge}>
                      {STOREFRONT_PAGE_LABELS[pageId]}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}

          {generatedPages ? (
            <div className={`${styles.optionBtn} ${styles.optionBtnSelected}`}>
              <span>
                Custom (generated for you)
                {generatedSource === "rules" && (
                  <span className={styles.optionBtnDescription}> — built from your category, not a live AI call.</span>
                )}
              </span>
              <span className={styles.pageBadges}>
                {generatedPages.map((pageId) => (
                  <span key={pageId} className={styles.pageBadge}>
                    {STOREFRONT_PAGE_LABELS[pageId]}
                  </span>
                ))}
              </span>
              <button type="button" className={styles.linkBtn} onClick={handleGenerateTemplate} disabled={generating}>
                {generating ? "Generating…" : "Generate again"}
              </button>
            </div>
          ) : (
            <button type="button" className={styles.linkBtn} onClick={handleGenerateTemplate} disabled={generating}>
              {generating ? "Generating…" : "None of these fit — generate one for my business"}
            </button>
          )}
          {generateError && <div className="errorBanner">{generateError}</div>}
        </div>
      )}

      {step === 3 && (
        <div className={styles.colorRow}>
          <label className={styles.colorField}>
            Primary colour
            <input
              type="color"
              value={colors.primaryColor}
              onChange={(e) => setColors((c) => ({ ...c, primaryColor: e.target.value }))}
            />
          </label>
          <label className={styles.colorField}>
            Accent colour
            <input
              type="color"
              value={colors.accentColor}
              onChange={(e) => setColors((c) => ({ ...c, accentColor: e.target.value }))}
            />
          </label>
          <p className={styles.hint}>These are the same colours as your Settings page — changing them here updates both.</p>
        </div>
      )}

      {step === 4 && (
        <div>
          <p className={styles.hint}>
            {business.logoUrl ? "Your logo is already set." : "No logo yet — add one in Settings."}
          </p>
          <div className={styles.optionGrid}>
            {HERO_OPTIONS.map((h) => (
              <button
                key={h.id}
                type="button"
                className={`${styles.optionBtn} ${theme.heroMode === h.id ? styles.optionBtnSelected : ""}`}
                onClick={() => setTheme((t) => ({ ...t, heroMode: h.id }))}
              >
                {h.label}
              </button>
            ))}
          </div>
          {theme.heroMode === "IMAGE" && (
            <div className={styles.uploadRow}>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                disabled={coverUploading}
                onChange={(e) => e.target.files?.[0] && handleCoverUpload(e.target.files[0])}
              />
              {coverUploading && <span className={styles.hint}>Uploading…</span>}
              {coverError && <span className="errorBanner">{coverError}</span>}
              {bannerUrl && <span className={styles.hint}>Cover photo set.</span>}
            </div>
          )}
        </div>
      )}

      {step === 5 && (
        <div className={styles.optionGrid}>
          {emphasisOptions.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`${styles.optionBtn} ${
                (o.id === "STORY") === (profile.sectionEmphasis === "ABOUT") ? styles.optionBtnSelected : ""
              }`}
              onClick={() =>
                setProfile((p) => ({
                  ...p,
                  sectionEmphasis: o.id === "STORY" ? "ABOUT" : capabilities.has("PRODUCTS") ? "PRODUCTS" : "SERVICES",
                }))
              }
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      {step === 6 && (
        <div>
          <p className={styles.hint}>
            This helps us understand your brand for future suggestions — it doesn&apos;t rewrite your storefront text today.
          </p>
          <div className={styles.optionGrid}>
            {VOICE_OPTIONS.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`${styles.optionBtn} ${profile.voiceTone === v.id ? styles.optionBtnSelected : ""}`}
                onClick={() => setProfile((p) => ({ ...p, voiceTone: v.id }))}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 7 && (
        <div>
          <p className={styles.hint}>
            Optional — this is stored as context for you and Skhokho, not shown on your storefront yet.
          </p>
          <textarea
            className="input"
            rows={4}
            maxLength={280}
            placeholder="Optional — e.g. 'We're the only halaal-certified kota spot in the area.'"
            defaultValue={profile.differentiator ?? ""}
            onBlur={(e) => setProfile((p) => ({ ...p, differentiator: e.target.value.trim() || undefined }))}
          />
        </div>
      )}

      {step === CONTENT_STEP_INDEX && (
        <div>
          <p className={styles.hint}>
            Optional, but this is what actually shows on your live storefront — unlike the note on the previous
            screen. Leave anything blank to keep today&apos;s behaviour (your business name and description).
          </p>

          <button type="button" className={styles.linkBtn} onClick={handleGenerateContent} disabled={contentGenerating}>
            {contentGenerating ? "Writing…" : "Write this for me"}
          </button>
          {contentSource === "rules" && (
            <p className={styles.hint}>Written from your category — not a live AI call. Edit anything below.</p>
          )}
          {contentGenerateError && <div className="errorBanner">{contentGenerateError}</div>}

          <label className={styles.colorField}>
            Hero headline
            <input
              key={`headline-${contentVersion}`}
              type="text"
              className="input"
              maxLength={MAX_HEADLINE_LENGTH}
              placeholder="e.g. Johannesburg's favourite kota spot"
              defaultValue={content.hero.headline ?? ""}
              onBlur={(e) => setContent((c) => ({ ...c, hero: { ...c.hero, headline: e.target.value.trim() || undefined } }))}
            />
          </label>

          <label className={styles.colorField}>
            Hero subheading
            <textarea
              key={`subheadline-${contentVersion}`}
              className="input"
              rows={2}
              maxLength={MAX_SUBHEADLINE_LENGTH}
              placeholder="A punchy line under your name — replaces your short description in the banner only."
              defaultValue={content.hero.subheadline ?? ""}
              onBlur={(e) => setContent((c) => ({ ...c, hero: { ...c.hero, subheadline: e.target.value.trim() || undefined } }))}
            />
          </label>

          <label className={styles.colorField}>
            Your story (About page)
            <textarea
              key={`about-${contentVersion}`}
              className="input"
              rows={5}
              maxLength={MAX_ABOUT_BODY_LENGTH}
              placeholder="Tell customers who you are and what makes you different — a few real sentences."
              defaultValue={content.about.body ?? ""}
              onBlur={(e) => setContent((c) => ({ ...c, about: { ...c.about, body: e.target.value.trim() || undefined } }))}
            />
          </label>

          <div className={styles.optionGrid}>
            <p className={styles.hint}>
              Up to {MAX_HIGHLIGHT_ITEMS} real reasons customers choose you — never a number or claim you haven&apos;t
              actually told us.
            </p>
            {content.highlights.items.map((item, i) => (
              <div key={i} className={styles.colorRow}>
                <input
                  type="text"
                  className="input"
                  maxLength={MAX_HIGHLIGHT_ITEM_LENGTH}
                  value={item}
                  onChange={(e) =>
                    setContent((c) => ({
                      ...c,
                      highlights: { items: c.highlights.items.map((it, idx) => (idx === i ? e.target.value : it)) },
                    }))
                  }
                />
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() =>
                    setContent((c) => ({ ...c, highlights: { items: c.highlights.items.filter((_, idx) => idx !== i) } }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            {content.highlights.items.length < MAX_HIGHLIGHT_ITEMS && (
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => setContent((c) => ({ ...c, highlights: { items: [...c.highlights.items, ""] } }))}
              >
                + Add a reason
              </button>
            )}
          </div>
        </div>
      )}

      {step === CONTENT_STEP_INDEX + 1 && (
        <div>
          <div className={styles.previewFrame}>
            <StorefrontView
              business={previewBusiness}
              catalog={catalog}
              returnTo="/dashboard/storefront/design"
              rating={rating}
              reviews={reviews}
              themeOverride={{ version: 1, profile, theme }}
              colorOverride={colors}
              contentOverride={content}
              navPages={generatedPages ?? STOREFRONT_TEMPLATES[templateId].pages}
              basePath="/dashboard/storefront/design"
            />
          </div>
          {availableActions.length > 0 && (
            <p className={styles.hint}>
              Customers will be encouraged to: {theme.primaryAction ? ACTION_LABELS[theme.primaryAction] : "the best fit for your business"}.{" "}
              <button type="button" className={styles.linkBtn} onClick={() => router.push("/dashboard/storefront/actions")}>
                Change this
              </button>
            </p>
          )}
          <p className={styles.hint}>
            Your storefront will have:{" "}
            {(generatedPages ?? STOREFRONT_TEMPLATES[templateId].pages).map((pageId) => STOREFRONT_PAGE_LABELS[pageId]).join(", ")}.
          </p>
          {saveError && <div className="errorBanner">{saveError}</div>}
        </div>
      )}

      <div className={styles.navRow}>
        <button type="button" className={styles.skipBtn} onClick={handleSkip}>
          Skip for now
        </button>
        <div className={styles.navButtons}>
          {step > 0 && (
            <button type="button" className="btn btnSecondary" onClick={back}>
              Back
            </button>
          )}
          {step < STEP_TITLES.length - 1 ? (
            <button type="button" className="btn btnPrimary" onClick={next}>
              Next
            </button>
          ) : (
            <>
              <button type="button" className="btn btnSecondary" onClick={() => router.push("/dashboard/storefront")}>
                Do this later
              </button>
              <button type="button" className="btn btnPrimary" disabled={saving} onClick={handleUseThisDesign}>
                {saving ? "Saving…" : "Use this design"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
