import type { Business, BusinessSubscription } from "@prisma/client";
import type { BusinessCatalog } from "@/modules/catalog/catalog.service";
import { getBusinessCapabilities } from "@/modules/tenant/capabilities";
import { getBusinessExperience } from "@/modules/tenant/business-experience";
import { getStorefrontContent, computeTrustBarFacts } from "@/modules/tenant/storefront-content";
import { resolveShopfrontTokens } from "@/modules/tenant/shopfront-tokens";
import ShopfrontNav from "./ShopfrontNav";
import ShopfrontHero from "./ShopfrontHero";
import ShopfrontTradingBar from "./ShopfrontTradingBar";
import ShopfrontTrustBar from "./ShopfrontTrustBar";
import ShopfrontFeaturedProducts from "./ShopfrontFeaturedProducts";
import ShopfrontMenu from "./ShopfrontMenu";
import ShopfrontCollections from "./ShopfrontCollections";
import RewardsCard from "@/components/storefront/account/RewardsCard";
import { ReviewsList } from "@/components/storefront/site/sections";
import ShopfrontAbout from "./ShopfrontAbout";
import ShopfrontQuote, { type ShopfrontReview } from "./ShopfrontQuote";
import ShopfrontContact from "./ShopfrontContact";
import ShopfrontFooter from "./ShopfrontFooter";
import EctaInformation from "@/components/storefront/EctaInformation";
import shared from "./Shopfront.module.css";
import styles from "./ShopfrontHome.module.css";
import { Fragment, type CSSProperties, type ReactNode } from "react";
import { resolveHomeLayout } from "@/modules/storefront-spec/layout";
import type { HomeSectionId } from "@/modules/storefront-spec/spec";
import type { ResolvedSite } from "@/modules/storefront-spec/site";

type ShopfrontBusiness = Business & { subscription: BusinessSubscription | null };

/**
 * Connected Shopfront's Home page — the new design's equivalent of
 * StorefrontView.tsx, for Phase-1 (product-catalogue) businesses only (see
 * shopfront-eligibility.ts). Reuses every real data source StorefrontView
 * already does (capabilities, business experience, content, trust facts,
 * catalog) — only the markup differs.
 */
export default function ShopfrontHome({
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
  const hasCatalog = catalog.products.length > 0;
  // Section order/visibility and the hero call to action come from the
  // business's published storefront spec, if any — otherwise the original
  // fixed layout, unchanged (see storefront-spec/layout.ts).
  const layout = resolveHomeLayout(business, capabilities, "PRODUCT", basePath, undefined, site.workflows);
  // How each section is composed: the owner's layout choice, else the
  // library template's composition, else the classic look (layouts.ts).
  const catalogueProps = {
    products: catalog.products,
    businessId: business.id,
    basePath,
    ordersEnabled: capabilities.has("ORDERS"),
    catalogLabel: experience.catalogLabel,
  };
  const catalogueLayout = layout.layouts.CATALOGUE;
  const sections: Record<HomeSectionId, ReactNode> = {
    TRUST_BAR: <ShopfrontTrustBar facts={trustBarFacts} layout={layout.layouts.TRUST_BAR === "TILES" ? "TILES" : "BAR"} />,
    CATALOGUE:
      catalogueLayout === "MENU" ? (
        <ShopfrontMenu {...catalogueProps} />
      ) : catalogueLayout === "LIST" ? (
        <ShopfrontMenu {...catalogueProps} grouped={false} />
      ) : catalogueLayout === "COLLECTIONS" ? (
        <ShopfrontCollections {...catalogueProps} />
      ) : (
        <ShopfrontFeaturedProducts {...catalogueProps} />
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
      <ShopfrontNav businessId={business.id} businessName={business.name} basePath={basePath} items={site.nav} />
      <ShopfrontHero
        business={business}
        headline={content.hero.headline}
        subheadline={content.hero.subheadline}
        basePath={basePath}
        rating={rating}
        primaryAction={layout.heroAction}
        size={layout.template?.composition.hero === "COMPACT" ? "compact" : "default"}
      />

      {capabilities.has("ORDERS") && <ShopfrontTradingBar business={business} />}
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

      {!hasCatalog && (
        <div className={`${shared.container} ${styles.empty}`}>
          <p>This business is still setting up their catalogue.</p>
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
