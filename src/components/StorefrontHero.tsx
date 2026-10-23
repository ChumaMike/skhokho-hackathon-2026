import type { CSSProperties, ReactNode } from "react";
import { categoryLabel } from "@/lib/business-categories";
import type { BusinessCategory } from "@prisma/client";
import type { HeroMode } from "@/modules/tenant/storefront-theme";
import styles from "./StorefrontHero.module.css";

/**
 * Private subcomponent — only ever imported by StorefrontView, so "one
 * component renders the storefront" holds. Rendered ABOVE the existing
 * compact header, never replacing it. MINIMAL (the back-compat default)
 * renders nothing at all — zero new DOM, zero visual change for every
 * business that hasn't chosen a hero. resolveHeroMode has already
 * resolved IMAGE-with-no-banner down to COLOUR before this ever renders,
 * so `bannerUrl` here is only ever read when it's actually usable.
 *
 * The name heading here is the page's ONLY <h1> whenever this renders —
 * StorefrontView suppresses its own header's name/meta text for every
 * non-MINIMAL mode (see StorefrontView.tsx), so there is always exactly
 * one strong identity presentation before catalogue content, never two.
 *
 * `--hero-name-len` (the business name's character count) drives a
 * length-aware clamp() in the CSS: a normal-length name renders at the
 * same size as before, a long real name (10-12+ words) shrinks toward a
 * smaller floor so it doesn't consume most of the first viewport. Pure
 * CSS, no JS measurement, no truncation/ellipsis of the merchant's name.
 *
 * `headline`/`subheadline` (StorefrontContent.hero — see storefront-content.ts)
 * are both optional and purely additive: `headline` renders as a small
 * kicker line above the business name (never replacing the name, which stays
 * the page's one real identity heading), `subheadline` replaces
 * `description` in the paragraph slot when set. A business with neither set
 * renders byte-identical to before this prop existed.
 */
export default function StorefrontHero({
  mode,
  business,
  logoFallbackInitial,
  cta,
  headline,
  subheadline,
}: {
  mode: HeroMode;
  business: {
    name: string;
    logoUrl: string | null;
    bannerUrl: string | null;
    description: string | null;
    category: BusinessCategory;
    suburb: string | null;
    city: string | null;
  };
  logoFallbackInitial: string;
  cta?: ReactNode;
  headline?: string;
  subheadline?: string;
}) {
  if (mode === "MINIMAL") return null;

  const locationLine = `${categoryLabel(business.category)}${
    business.suburb ? ` · ${business.suburb}` : business.city ? ` · ${business.city}` : ""
  }`;
  const nameLenStyle = { "--hero-name-len": business.name.length } as CSSProperties;
  const description = subheadline || business.description;

  if (mode === "IMAGE" && business.bannerUrl) {
    return (
      <div
        className={styles.hero}
        style={{ backgroundImage: `url(${business.bannerUrl})` }}
      >
        <div className={styles.scrim}>
          {headline && <p className={styles.heroKicker}>{headline}</p>}
          <h1 className={styles.heroName} style={nameLenStyle}>{business.name}</h1>
          <p className={styles.heroMeta}>{locationLine}</p>
          {description && <p className={styles.heroDescription}>{description}</p>}
          {cta && <div className={styles.heroCta}>{cta}</div>}
        </div>
      </div>
    );
  }

  if (mode === "LOGO") {
    return (
      <div className={styles.heroLogoBand}>
        {business.logoUrl ? (
          // Business-supplied logo, not a bundled asset — plain img.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={business.logoUrl} alt="" className={styles.heroLogoImage} />
        ) : (
          <div className={styles.heroLogoFallback}>{logoFallbackInitial}</div>
        )}
        {headline && <p className={styles.heroKicker}>{headline}</p>}
        <h1 className={styles.heroNameOnSurface} style={nameLenStyle}>{business.name}</h1>
        {description && <p className={styles.heroDescription}>{description}</p>}
        {cta && <div className={styles.heroCta}>{cta}</div>}
      </div>
    );
  }

  // COLOUR
  return (
    <div className={styles.heroColourBand}>
      {headline && <p className={styles.heroKicker}>{headline}</p>}
      <h1 className={styles.heroNameOnPrimary} style={nameLenStyle}>{business.name}</h1>
      <p className={styles.heroMetaOnPrimary}>{locationLine}</p>
      {description && <p className={styles.heroDescriptionOnPrimary}>{description}</p>}
      {cta && <div className={styles.heroCta}>{cta}</div>}
    </div>
  );
}
