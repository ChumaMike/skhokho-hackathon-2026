import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBusinessBySlug, getStorefrontTemplateSelection } from "@/modules/tenant/tenant.service";
import { resolveStorefrontTemplate } from "@/modules/tenant/storefront-templates";
import { getActiveCatalog } from "@/modules/catalog/catalog.service";
import { getRatingSummary, listPublishedReviews } from "@/modules/reviews/review.service";
import { buildStorefrontMetadata, buildLocalBusinessJsonLd, serializeJsonLd } from "@/modules/tenant/storefront-seo";
import { OK_MESSAGES } from "@/modules/tenant/storefront-notice";
import StorefrontHome from "@/components/storefront/StorefrontHome";
import { storefrontBasePath } from "@/lib/tenant/storefront-request";
import { getStorefrontLayout } from "@/modules/storefront-spec/layout";
import { loadSite } from "@/modules/storefront-spec/site";

export const dynamic = "force-dynamic";

interface Params {
  slug: string;
}

interface SearchParams {
  ok?: string;
  err?: string;
  orderId?: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return { title: "Business not found" };
  return buildStorefrontMetadata(business, "HOME", getStorefrontLayout(business)?.seo);
}

/**
 * Path-based storefront — works in any environment (no DNS/subdomain setup
 * needed), and is what /discover links to. The subdomain-based /tenant
 * route (via src/middleware.ts) renders the same underlying view once a
 * business's own domain resolves.
 */
export default async function StorePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const sp = await searchParams;

  const business = await getBusinessBySlug(slug);
  if (!business) notFound();
  const basePath = await storefrontBasePath(business.slug);

  const [catalog, rating, reviews, templateSelection] = await Promise.all([
    getActiveCatalog(business.id),
    getRatingSummary(business.id),
    listPublishedReviews(business.id),
    getStorefrontTemplateSelection(business.id),
  ]);
  const template = resolveStorefrontTemplate(templateSelection);
  // The owner's pages, for the nav and footer (storefront-spec/site.ts).
  const site = await loadSite(business, basePath, { catalog, reviewCount: rating.count });

  // trackingHref is a SEPARATE, fixed link — never interpolated into the
  // banner's message text itself, preserving storefront-notice.ts's own
  // injection-safety invariant (only fixed OK_MESSAGES keys are ever
  // rendered as the message). orderId is just a route param here.
  const notice = sp.ok
    ? {
        kind: "ok" as const,
        message: OK_MESSAGES[sp.ok as keyof typeof OK_MESSAGES] ?? OK_MESSAGES.order,
        trackingHref: sp.orderId && (sp.ok === "order-delivery" || sp.ok === "order") ? `/store/order/${sp.orderId}` : undefined,
      }
    : sp.err
      ? { kind: "err" as const, message: sp.err }
      : undefined;

  const jsonLd = buildLocalBusinessJsonLd(business, rating);

  return (
    <>
      {/* eslint-disable-next-line react/no-danger -- serializeJsonLd escapes `<` so a business's own name/description can never break out of this tag */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <StorefrontHome
        business={business}
        catalog={catalog}
        rating={rating}
        reviews={reviews}
        notice={notice}
        basePath={basePath}
        navPages={template.pages}
        site={site}
      />
    </>
  );
}
