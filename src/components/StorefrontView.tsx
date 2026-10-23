import { Fragment, type ReactNode, type CSSProperties } from "react";
import type { Business, BusinessSubscription } from "@prisma/client";
import { categoryLabel } from "@/lib/business-categories";
import type { BusinessCatalog } from "@/modules/catalog/catalog.service";
import type { RatingSummary } from "@/modules/reviews/review.service";
import { getBusinessCapabilities } from "@/modules/tenant/capabilities";
import { getBusinessExperience } from "@/modules/tenant/business-experience";
import {
  getStorefrontConfig,
  resolveHeroMode,
  resolveSectionOrder,
  resolveStorefrontTokens,
  resolvePrimaryAction,
  resolveActionEmphasis,
  type StorefrontSettings,
  type StorefrontSectionId,
  type PrimaryCustomerAction,
} from "@/modules/tenant/storefront-theme";
import type { StorefrontContent } from "@/modules/tenant/storefront-content";
import { getStorefrontContent, computeTrustBarFacts } from "@/modules/tenant/storefront-content";
import type { StorefrontPageId } from "@/modules/tenant/storefront-templates";
import StorefrontHero from "./StorefrontHero";
import ProductsSection from "./storefront/ProductsSection";
import ServicesSection from "./storefront/ServicesSection";
import AboutSection from "./storefront/AboutSection";
import TrustBarSection from "./storefront/TrustBarSection";
import BenefitsSection from "./storefront/BenefitsSection";
import ReviewsSection, { type StorefrontReview } from "./storefront/ReviewsSection";
import StorefrontFooter from "./storefront/StorefrontFooter";
import StorefrontNav from "./storefront/StorefrontNav";
import StarRow from "./storefront/StarRow";
import styles from "./StorefrontView.module.css";
import { whatsappLink } from "@/lib/utils";

type StorefrontBusiness = Business & { subscription: BusinessSubscription | null };

/**
 * Never itself an authorization check — purely presentational, same as
 * workspace-nav.ts's own nav being presentation-only. Never offers an
 * action the business's capabilities/contact info can't actually fulfil
 * (see getAvailablePrimaryActions/deriveDefaultPrimaryAction, the one
 * shared implementation of that rule). Renders nothing for BROWSE, since
 * "browse the catalogue" is the implicit default action of the page
 * itself, not something worth a dedicated button.
 */
function getPrimaryActionLink(
  action: PrimaryCustomerAction,
  business: { whatsapp: string | null; phone: string | null; slug: string },
): { href: string; label: string } | null {
  switch (action) {
    case "ORDER":
      return { href: "#storefront-products", label: "Order now" };
    case "BOOK":
      return { href: "#storefront-services", label: "Book now" };
    case "WHATSAPP":
      return whatsappLink(business.whatsapp)
        ? { href: whatsappLink(business.whatsapp)!, label: "Chat on WhatsApp" }
        : null;
    case "CALL":
      return business.phone ? { href: `tel:${business.phone}`, label: "Call us" } : null;
    case "VISIT":
      return { href: "#storefront-contact", label: "Find us" };
    case "LOYALTY":
      return { href: `/r/${business.slug}`, label: "Join for rewards" };
    case "BROWSE":
    default:
      return null;
  }
}

/**
 * The actual "click into a business and browse what they offer" experience
 * — this is the component both routes render:
 *   - src/app/store/[slug]/page.tsx   (path-based, works anywhere, no DNS)
 *   - src/app/tenant/page.tsx         (subdomain-based, via src/middleware.ts)
 * Same view either way; each route is responsible only for resolving which
 * business to pass in (URL param vs. x-tenant-* headers).
 *
 * `themeOverride`/`colorOverride` exist ONLY for the storefront-design
 * interview's live preview (a draft the owner hasn't saved yet) — the two
 * production routes never pass them, so their rendered output is governed
 * entirely by the business's own saved settings/columns, unchanged.
 */
export default function StorefrontView({
  business,
  catalog,
  returnTo,
  notice,
  rating,
  reviews,
  themeOverride,
  colorOverride,
  contentOverride,
  navPages,
  basePath,
}: {
  business: StorefrontBusiness;
  catalog: BusinessCatalog;
  /** Path this view is rendered at — order/book forms redirect back here. */
  returnTo: string;
  notice?: { kind: "ok" | "err"; message: string; trackingHref?: string };
  rating?: RatingSummary;
  reviews?: StorefrontReview[];
  themeOverride?: StorefrontSettings;
  colorOverride?: { primaryColor?: string; accentColor?: string };
  /** Same "draft the wizard hasn't saved yet" purpose as themeOverride/colorOverride — see that comment. */
  contentOverride?: StorefrontContent;
  /** The active template's page list (resolveStorefrontTemplate) — optional so the Design Wizard's preview can omit it, but both real production routes always pass it so HOME links to whichever of About/Gallery/Contact actually exist. */
  navPages?: StorefrontPageId[];
  /** `/store/${slug}` or `''` — see StorefrontNav's own comment. */
  basePath?: string;
}) {
  const hasCatalog = catalog.products.length > 0 || catalog.services.length > 0;
  const capabilities = getBusinessCapabilities(business);
  // Same registry the owner-facing dashboard/catalog editor already uses —
  // a Food business's customers see "Menu", not "Products", here too.
  const experience = getBusinessExperience(business.category);

  const storefrontConfig = themeOverride ?? getStorefrontConfig(business);
  const content = contentOverride ?? getStorefrontContent(business);
  const trustBarFacts = computeTrustBarFacts(capabilities, business);
  const effectiveColors = {
    primaryColor: colorOverride?.primaryColor ?? business.primaryColor,
    accentColor: colorOverride?.accentColor ?? business.accentColor,
  };
  const tokens = resolveStorefrontTokens(effectiveColors, storefrontConfig);
  const heroMode = resolveHeroMode(storefrontConfig.theme, business);
  const sectionOrder = resolveSectionOrder(storefrontConfig.profile);
  // The ONE place primaryAction is resolved — re-validates a saved choice
  // against current capabilities/contact info every render, so a business
  // whose configuration changed after saving can never render a dead CTA.
  const primaryAction = resolvePrimaryAction(storefrontConfig.theme, capabilities, business);
  const actionEmphasis = resolveActionEmphasis(primaryAction);
  const primaryActionLink = getPrimaryActionLink(primaryAction, business);
  // The top CTA IS the merchant's configured action, always styled PRIMARY —
  // never demoted, regardless of which domain (if any) it belongs to.
  const primaryActionCta = primaryActionLink && (
    <a href={primaryActionLink.href} className={`btn ${styles.storeActionPrimary}`}>
      {primaryActionLink.label}
    </a>
  );

  const logoFallbackInitial = business.name.charAt(0).toUpperCase();
  // Every non-MINIMAL hero already presents a strong identity block (name +
  // category/location, via StorefrontHero — see its own comment). The
  // header below must never repeat that text, or the page shows the
  // merchant's name/location twice in a row before any catalogue content.
  // MINIMAL is the one mode where the header IS the sole identity
  // presentation, so its name/meta text (and logo) must still render there.
  const heroShowsIdentity = heroMode !== "MINIMAL";
  // LOGO mode already shows the logo itself, big, in the hero — showing it
  // again immediately below would be the one part of "identity" that isn't
  // text. COLOUR/IMAGE modes never show a logo at all, so the header's copy
  // remains the ONLY place a logo mark appears for those two.
  const headerShowsLogo = heroMode !== "LOGO";
  const nameLenStyle = { "--hero-name-len": business.name.length } as CSSProperties;

  const sectionRenderers: Record<StorefrontSectionId, () => ReactNode> = {
    HERO: () => null, // rendered explicitly, fixed-first — never part of the reorderable map
    CONTACT: () => null, // rendered explicitly, fixed-last — never part of the reorderable map
    TRUST_BAR: () => <TrustBarSection facts={trustBarFacts} />,
    BENEFITS: () => <BenefitsSection items={content.highlights.items} />,
    ABOUT: () => <AboutSection description={business.description} body={content.about.body} />,
    // Products move product picking/quantity into the basket (see
    // ProductsSection — Add-to-basket + quantity stepper, no per-product
    // form, no repeated phone/email/consent/fulfilment). Services below
    // are UNTOUCHED — booking a service stays its own single-item Book
    // action; the basket is products-only this milestone.
    PRODUCTS: () =>
      catalog.products.length > 0 ? (
        <ProductsSection
          businessId={business.id}
          basePath={basePath ?? `/store/${business.slug}`}
          products={catalog.products}
          ordersEnabled={capabilities.has("ORDERS")}
          catalogLabel={experience.catalogLabel}
        />
      ) : null,
    SERVICES: () =>
      catalog.services.length > 0 ? (
        <ServicesSection
          businessId={business.id}
          services={catalog.services}
          returnTo={returnTo}
          bookEmphasis={actionEmphasis.book}
        />
      ) : null,
    REVIEWS: () => <ReviewsSection reviews={reviews} />,
  };

  const hasContactInfo = !!(business.phone || business.whatsapp || business.address || business.suburb || business.city);

  return (
    <main className="shell">
      <div className={`column wide ${styles.themeScope}`} style={tokens as CSSProperties}>
        {navPages && <StorefrontNav basePath={basePath ?? ""} pages={navPages} />}
        <StorefrontHero
          mode={heroMode}
          business={business}
          logoFallbackInitial={logoFallbackInitial}
          cta={primaryActionCta}
          headline={content.hero.headline}
          subheadline={content.hero.subheadline}
        />

        {(headerShowsLogo || !heroShowsIdentity || (rating && rating.count > 0)) && (
          <header className={styles.header}>
            {headerShowsLogo &&
              (business.logoUrl ? (
                // Business-supplied logo, not a bundled/optimised asset — plain img.
                // Decorative: the business's name is always presented as
                // real text elsewhere on this page (hero heading or, for
                // MINIMAL, the h1 right beside this same image) — an alt
                // here would just repeat that name a second time.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={business.logoUrl} alt="" className={styles.logo} />
              ) : (
                <div className={styles.logoFallback}>{logoFallbackInitial}</div>
              ))}
            <div>
              {!heroShowsIdentity && (
                <>
                  {content.hero.headline && <p className={styles.kicker}>{content.hero.headline}</p>}
                  <h1 className={styles.name} style={nameLenStyle}>{business.name}</h1>
                  <p className={styles.meta}>
                    {categoryLabel(business.category)}
                    {business.suburb ? ` · ${business.suburb}` : business.city ? ` · ${business.city}` : ""}
                  </p>
                  {content.hero.subheadline && <p className={styles.subheadline}>{content.hero.subheadline}</p>}
                </>
              )}
              {rating && rating.count > 0 && (
                <p className={styles.rating}>
                  <StarRow value={rating.average} />
                  <span className={styles.ratingValue}>{rating.average.toFixed(1)}</span>
                  <span className={styles.ratingCount}>
                    ({rating.count} {rating.count === 1 ? "review" : "reviews"})
                  </span>
                </p>
              )}
            </div>
          </header>
        )}

        {heroMode === "MINIMAL" && primaryActionCta && (
          <div className={styles.topCtaRow}>{primaryActionCta}</div>
        )}

        {notice && (
          <div className={notice.kind === "ok" ? "successBanner" : "errorBanner"}>
            {notice.message}
            {notice.trackingHref && (
              <>
                {" "}
                <a href={notice.trackingHref}>Track your delivery →</a>
              </>
            )}
          </div>
        )}

        {!hasCatalog && (
          <div className={styles.empty}>
            <p>This business is still setting up their catalogue.</p>
            {(business.phone || business.whatsapp) && (
              <p className={styles.emptyHint}>
                In the meantime, reach them on {business.whatsapp || business.phone}.
              </p>
            )}
          </div>
        )}

        {sectionOrder.map((sectionId) => (
          <Fragment key={sectionId}>{sectionRenderers[sectionId]()}</Fragment>
        ))}

        {hasContactInfo && (
          <section className={styles.section} id="storefront-contact">
            <h2 className={styles.sectionTitle}>Contact</h2>
            <ul className={styles.contactList}>
              {business.phone && <li>Phone: {business.phone}</li>}
              {business.whatsapp && <li>WhatsApp: {business.whatsapp}</li>}
              {(business.address || business.suburb || business.city) && (
                <li>
                  {[business.address, business.suburb, business.city].filter(Boolean).join(", ")}
                </li>
              )}
            </ul>
          </section>
        )}

        <StorefrontFooter business={business} />
      </div>
    </main>
  );
}
