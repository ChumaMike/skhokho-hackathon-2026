import type { Business, BusinessSubscription } from "@prisma/client";
import type { BusinessCatalog } from "@/modules/catalog/catalog.service";
import { getBusinessExperience } from "@/modules/tenant/business-experience";
import { getStorefrontContent, computeTrustBarFacts } from "@/modules/tenant/storefront-content";
import { resolveStorefrontVariant } from "@/modules/tenant/shopfront-eligibility";
import { resolveHomeLayout } from "@/modules/storefront-spec/layout";
import { pageHref, type SitePage } from "@/modules/storefront-spec/pages";
import type { ResolvedSite } from "@/modules/storefront-spec/site";
import WorkflowForm from "./WorkflowForm";
import styles from "./SitePage.module.css";
import { buildProductListJsonLd, buildServiceListJsonLd, serializeJsonLd } from "@/modules/tenant/storefront-seo";
import ShopfrontPageShell from "@/components/storefront/shopfront/ShopfrontPageShell";
import ShopfrontBookingPageShell from "@/components/storefront/shopfront-booking/ShopfrontBookingPageShell";
import ShopfrontAbout from "@/components/storefront/shopfront/ShopfrontAbout";
import ShopfrontContact from "@/components/storefront/shopfront/ShopfrontContact";
import ShopfrontTrustBar from "@/components/storefront/shopfront/ShopfrontTrustBar";
import ShopfrontShopGrid from "@/components/storefront/shopfront/ShopfrontShopGrid";
import ShopfrontMenu from "@/components/storefront/shopfront/ShopfrontMenu";
import ShopfrontQuote from "@/components/storefront/shopfront/ShopfrontQuote";
import ShopfrontServicesSection from "@/components/storefront/shopfront-booking/ShopfrontServicesSection";
import ShopfrontEnquiryServices from "@/components/storefront/shopfront-booking/ShopfrontEnquiryServices";
import shared from "@/components/storefront/shopfront/Shopfront.module.css";
import { FaqSection, GalleryGrid, HighlightsBlock, HoursBlock, PrivacyPointer, ReviewsList, TextSection, galleryImages, type ReviewRow } from "./sections";

type PageBusiness = Business & { subscription: BusinessSubscription | null };

/**
 * Renders one owner-controlled page (storefront-spec/pages.ts) inside the
 * right Shopfront shell for the business's variant. Sections are rendered
 * in the owner's order from a closed set; each real section component
 * decides for itself whether it has anything to show.
 *
 * The Home page is NOT rendered here — it keeps its own composition
 * (ShopfrontHome / ShopfrontBookingHome, spec.home.sections).
 */
export default function SitePageView({
  business,
  page,
  site,
  basePath,
  catalog,
  reviews,
  rating,
  notice,
  collection,
}: {
  business: PageBusiness;
  page: SitePage;
  site: ResolvedSite;
  basePath: string;
  catalog: BusinessCatalog;
  reviews: ReviewRow[];
  rating?: { average: number; count: number };
  /** The fixed-key success banner or a plain error after a form post (storefront-notice.ts). */
  notice?: { kind: "ok" | "err"; message: string };
  /** ?collection= — a collection tile on Home opens the Shop page filtered to it. */
  collection?: string;
}) {
  const variant = resolveStorefrontVariant(business);
  const experience = getBusinessExperience(business.category);
  const content = getStorefrontContent(business);
  const capabilities = site.capabilities;
  const hasAboutSection = page.sections.some((s) => s.type === "ABOUT");
  const pageUrl = pageHref(page, basePath);
  const serviceNames = catalog.services.map((s) => s.name);

  // Structured data for what the business sells, on the page that lists it.
  const jsonLd =
    page.id === "CATALOGUE_PRODUCTS" && catalog.products.length > 0
      ? buildProductListJsonLd(business, catalog.products)
      : page.id === "CATALOGUE_SERVICES" && catalog.services.length > 0
        ? buildServiceListJsonLd(business, catalog.services)
        : null;

  const body = (
    <>
      {jsonLd && (
        // serializeJsonLd escapes `<` so a catalogue name can never break out of this tag.
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      )}
      <div className={shared.pageHero}>
        <div className={shared.container}>
          <p className={shared.eyebrow}>{business.name}</p>
          <h1 className={shared.pageHeroHeading}>{page.title}</h1>
        </div>
      </div>
      {notice && (
        <div className={`${shared.container} ${styles.notice}`}>
          <div className={notice.kind === "ok" ? "successBanner" : "errorBanner"}>{notice.message}</div>
        </div>
      )}
      {page.sections.map((section, index) => {
        const key = `${section.type}-${index}`;
        switch (section.type) {
          case "TEXT":
            return <TextSection key={key} section={section} />;
          case "ACTION":
            if (!site.workflows.includes(section.workflow)) return null;
            return (
              <WorkflowForm
                key={key}
                workflow={section.workflow}
                businessId={business.id}
                category={business.category}
                returnTo={pageUrl}
                pageSlug={page.slug}
                services={serviceNames}
              />
            );
          case "FAQ":
            return <FaqSection key={key} section={section} />;
          case "ABOUT":
            return (
              <ShopfrontAbout
                key={key}
                businessName={business.name}
                description={business.description}
                body={content.about.body}
                logoUrl={business.logoUrl}
                highlights={content.highlights}
              />
            );
          case "HIGHLIGHTS":
            // ShopfrontAbout already lists the highlights; don't show them twice on one page.
            return hasAboutSection ? null : <HighlightsBlock key={key} items={content.highlights.items} />;
          case "CONTACT":
            return <ShopfrontContact key={key} business={business} />;
          case "HOURS":
            return <HoursBlock key={key} operatingHours={business.operatingHours} />;
          case "GALLERY":
            return <GalleryGrid key={key} images={galleryImages(catalog)} layout={section.layout ?? "GRID"} />;
          case "REVIEWS":
            return section.layout === "QUOTE" ? <ShopfrontQuote key={key} reviews={reviews} /> : <ReviewsList key={key} reviews={reviews} rating={rating} />;
          case "TRUST_BAR":
            return <ShopfrontTrustBar key={key} facts={computeTrustBarFacts(capabilities, business)} />;
          case "PRIVACY_POINTER":
            return <PrivacyPointer key={key} businessName={business.name} />;
          case "CATALOGUE": {
            if (page.id === "CATALOGUE_SERVICES") {
              const layout = resolveHomeLayout(business, capabilities, "BOOKING", basePath, undefined, site.workflows);
              const enquiries = layout.template?.composition.catalogue === "SERVICE_ENQUIRY" || !capabilities.has("BOOKINGS");
              return enquiries ? (
                <ShopfrontEnquiryServices key={key} services={catalog.services} business={business} basePath={basePath} serviceCatalogLabel={experience.serviceCatalogLabel} />
              ) : (
                <ShopfrontServicesSection key={key} businessId={business.id} services={catalog.services} returnTo={basePath || "/"} serviceCatalogLabel={experience.serviceCatalogLabel} />
              );
            }
            if (section.layout === "LIST") {
              return (
                <ShopfrontMenu key={key} products={catalog.products} businessId={business.id} basePath={basePath} ordersEnabled={capabilities.has("ORDERS")} catalogLabel={experience.catalogLabel} />
              );
            }
            return (
              <ShopfrontShopGrid
                key={key}
                products={catalog.products}
                businessId={business.id}
                basePath={basePath}
                ordersEnabled={capabilities.has("ORDERS")}
                catalogLabel={experience.catalogLabel}
                initialCategory={collection}
              />
            );
          }
        }
      })}
    </>
  );

  if (variant === "BOOKING") {
    return (
      <ShopfrontBookingPageShell business={business} basePath={basePath} site={site}>
        {body}
      </ShopfrontBookingPageShell>
    );
  }
  return (
    <ShopfrontPageShell business={business} basePath={basePath} site={site}>
      {body}
    </ShopfrontPageShell>
  );
}
