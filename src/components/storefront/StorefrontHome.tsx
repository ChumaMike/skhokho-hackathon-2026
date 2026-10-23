import type { Business, BusinessSubscription } from "@prisma/client";
import type { BusinessCatalog } from "@/modules/catalog/catalog.service";
import type { RatingSummary, listPublishedReviews } from "@/modules/reviews/review.service";
import type { StorefrontPageId } from "@/modules/tenant/storefront-templates";
import type { ResolvedSite } from "@/modules/storefront-spec/site";
import { resolveStorefrontVariant } from "@/modules/tenant/shopfront-eligibility";
import StorefrontView from "@/components/StorefrontView";
import ShopfrontHome from "@/components/storefront/shopfront/ShopfrontHome";
import ShopfrontBookingHome from "@/components/storefront/shopfront-booking/ShopfrontBookingHome";

type HomeBusiness = Business & { subscription: BusinessSubscription | null };

/**
 * The ONE storefront home renderer. The live /store/[slug] page and the
 * merchant's storefront preview both render through here, so a preview can
 * never show a different design from what customers get (it previously
 * rendered the legacy StorefrontView while live stores used the Shopfront).
 * Which variant renders is resolveStorefrontVariant's single decision.
 */
export default function StorefrontHome({
  business,
  catalog,
  rating,
  reviews,
  notice,
  basePath,
  navPages,
  site,
}: {
  business: HomeBusiness;
  catalog: BusinessCatalog;
  rating: RatingSummary;
  reviews: Awaited<ReturnType<typeof listPublishedReviews>>;
  notice?: { kind: "ok" | "err"; message: string; trackingHref?: string };
  basePath: string;
  /** Legacy design only: which pages its nav lists. */
  navPages: StorefrontPageId[];
  /** Shopfront designs: the owner's pages for nav and footer (storefront-spec/site.ts). */
  site: ResolvedSite;
}) {
  const variant = resolveStorefrontVariant(business);
  if (variant === "BOOKING") {
    return <ShopfrontBookingHome business={business} catalog={catalog} rating={rating} reviews={reviews} notice={notice} basePath={basePath} site={site} />;
  }
  if (variant === "PRODUCT") {
    return <ShopfrontHome business={business} catalog={catalog} rating={rating} reviews={reviews} notice={notice} basePath={basePath} site={site} />;
  }
  return (
    <StorefrontView
      business={business}
      catalog={catalog}
      returnTo={basePath || "/"}
      notice={notice}
      rating={rating}
      reviews={reviews}
      navPages={navPages}
      basePath={basePath}
    />
  );
}
