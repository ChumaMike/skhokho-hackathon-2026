import type { Business, BusinessSubscription } from "@prisma/client";
import type { BusinessCatalog } from "@/modules/catalog/catalog.service";
import { getBusinessCapabilities } from "@/modules/tenant/capabilities";
import { getBusinessExperience } from "@/modules/tenant/business-experience";
import { getStorefrontContent, computeTrustBarFacts } from "@/modules/tenant/storefront-content";
import { resolveShopfrontTokens } from "@/modules/tenant/shopfront-tokens";
import ShopfrontNavCentered from "./ShopfrontNavCentered";
import ShopfrontServicesSection from "./ShopfrontServicesSection";
import ShopfrontEnquiryServices from "./ShopfrontEnquiryServices";
import ShopfrontPortfolio from "./ShopfrontPortfolio";
import ShopfrontServicesList from "./ShopfrontServicesList";
import RewardsCard from "@/components/storefront/account/RewardsCard";
import { ReviewsList } from "@/components/storefront/site/sections";
import { getWorkflow, primaryWorkflow } from "@/modules/storefront-workflows/workflows";
import ShopfrontHero from "@/components/storefront/shopfront/ShopfrontHero";
import ShopfrontTrustBar from "@/components/storefront/shopfront/ShopfrontTrustBar";
import ShopfrontAbout from "@/components/storefront/shopfront/ShopfrontAbout";
import ShopfrontQuote, { type ShopfrontReview } from "@/components/storefront/shopfront/ShopfrontQuote";
import ShopfrontContact from "@/components/storefront/shopfront/ShopfrontContact";
import ShopfrontFooter from "@/components/storefront/shopfront/ShopfrontFooter";
import EctaInformation from "@/components/storefront/EctaInformation";
import shared from "@/components/storefront/shopfront/Shopfront.module.css";
import styles from "@/components/storefront/shopfront/ShopfrontHome.module.css";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { resolveHomeLayout } from "@/modules/storefront-spec/layout";
import type { HomeSectionId } from "@/modules/storefront-spec/spec";
import type { ResolvedSite } from "@/modules/storefront-spec/site";

type ShopfrontBusiness = Business & { subscription: BusinessSubscription | null };

/**
 * Connected Shopfront's Home page for Phase 2 (services/booking)
 * businesses — see shopfront-eligibility.ts's isShopfrontBookingCategory.
 * Same real data sources as ShopfrontHome (Phase 1), same hero/trust-bar/
 * about/quote/contact/footer components reused unchanged — the only
 * differences are the nav (centered, ShopfrontNavCentered) and swapping
 * the product grid for the booking-forward services list.
 */
export default function ShopfrontBookingHome({
  business,
  catalog,
  rating,
  reviews,
  notice,
  basePath,
  site,
}: {
  business: ShopfrontBusiness;
  catalog: BusinessCatalog;
  rating?: { average: number; count: number };
  reviews?: ShopfrontReview[];
  notice?: { kind: "ok" | "err"; message: string; trackingHref?: string };
  basePath: string;
  /** The owner's pages (storefront-spec/site.ts) — nav and footer links. */
  site: ResolvedSite;
}) {
  const capabilities = getBusinessCapabilities(business);
  const experience = getBusinessExperience(business.category);
  const content = getStorefrontContent(business);
  const trustBarFacts = computeTrustBarFacts(capabilities, business);
  const tokens = resolveShopfrontTokens(business);
  const hasShop = capabilities.has("PRODUCTS");
  const hasServices = catalog.services.length > 0;
  // See ShopfrontHome: published spec layout if any, else the original
  // fixed layout with the original "Book now" call to action.
  const layout = resolveHomeLayout(
    business,
    capabilities,
    "BOOKING",
    basePath,
    {
      label: "Book now",
      href: `${basePath}#services`,
    },
    site.workflows,
  );
  // SERVICES_LEAD (or no online booking): enquiry cards instead of booking forms.
  const enquiries = layout.template?.composition.catalogue === "SERVICE_ENQUIRY" || !capabilities.has("BOOKINGS");
  // The storefront's primary request form, when a workflow is live (storefront-workflows).
  const primary = primaryWorkflow(site.workflows);
  const enquiry = primary ? { href: `${basePath}/${getWorkflow(primary).slug}`, label: getWorkflow(primary).ctaLabel } : null;
  const catalogueLayout = layout.layouts.CATALOGUE;
  const sections: Record<HomeSectionId, ReactNode> = {
    TRUST_BAR: <ShopfrontTrustBar facts={trustBarFacts} layout={layout.layouts.TRUST_BAR === "TILES" ? "TILES" : "BAR"} />,
    CATALOGUE:
      catalogueLayout === "PORTFOLIO" ? (
        <ShopfrontPortfolio
          services={catalog.services}
          business={business}
          basePath={basePath}
          serviceCatalogLabel={experience.serviceCatalogLabel}
          process={content.process}
          enquiry={enquiry}
          galleryLayout={site.galleryLayout}
        />
      ) : catalogueLayout === "LIST" ? (
        <ShopfrontServicesList services={catalog.services} basePath={basePath} serviceCatalogLabel={experience.serviceCatalogLabel} actionLabel={enquiries ? "Ask about a service" : "Book a service"} />
      ) : enquiries ? (
        <ShopfrontEnquiryServices services={catalog.services} business={business} basePath={basePath} serviceCatalogLabel={experience.serviceCatalogLabel} />
      ) : (
        <ShopfrontServicesSection businessId={business.id} services={catalog.services} returnTo={basePath || "/"} serviceCatalogLabel={experience.serviceCatalogLabel} />
      ),
    ABOUT: (
      <ShopfrontAbout
        businessName={business.name}
        description={business.description}
        body={content.about.body}
        logoUrl={business.logoUrl}
        highlights={content.highlights}
        layout={layout.layouts.ABOUT === "STACKED" ? "STACKED" : "SPLIT"}
      />
    ),
    REVIEWS: reviews ? layout.layouts.REVIEWS === "LIST" ? <ReviewsList reviews={reviews} rating={rating} /> : <ShopfrontQuote reviews={reviews} /> : null,
  };

  return (
    <main className={shared.scope} style={tokens as CSSProperties}>
      <ShopfrontNavCentered
        businessId={business.id}
        businessName={business.name}
        basePath={basePath}
        hasShop={hasShop}
        action={layout.heroAction}
        items={site.nav}
      />
      <ShopfrontHero
        business={business}
        headline={content.hero.headline}
        subheadline={content.hero.subheadline}
        basePath={basePath}
        rating={rating}
        primaryAction={layout.heroAction}
      />
      <RewardsCard business={{ id: business.id, name: business.name }} basePath={basePath} />

      {notice && (
        <div className={`${shared.container} ${styles.noticeWrap}`}>
          <div className={notice.kind === "ok" ? "successBanner" : "errorBanner"}>
            {notice.message}
            {notice.trackingHref && (
              <>
                {" "}
                <a href={notice.trackingHref}>Track your delivery →</a>
              </>
            )}
          </div>
        </div>
      )}

      {!hasServices && (
        <div className={`${shared.container} ${styles.empty}`}>
          <p>This business is still setting up their booking page.</p>
          {(business.phone || business.whatsapp) && <p>In the meantime, reach them on {business.whatsapp || business.phone}.</p>}
        </div>
      )}

      {layout.sections.map((id) => (
        <Fragment key={id}>{sections[id]}</Fragment>
      ))}
      <ShopfrontContact business={business} />
      <ShopfrontFooter business={business} links={site.footer} legal={<EctaInformation business={business} tone="dark" />} />
    </main>
  );
}
