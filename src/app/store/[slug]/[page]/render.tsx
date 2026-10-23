import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBusinessBySlug } from "@/modules/tenant/tenant.service";
import { getActiveCatalog } from "@/modules/catalog/catalog.service";
import { getRatingSummary, listPublishedReviews } from "@/modules/reviews/review.service";
import { loadSite, openablePage } from "@/modules/storefront-spec/site";
import { buildPageMetadata } from "@/modules/tenant/storefront-seo";
import { OK_MESSAGES } from "@/modules/tenant/storefront-notice";
import type { SitePage } from "@/modules/storefront-spec/pages";
import SitePageView from "@/components/storefront/site/SitePageView";
import { storefrontBasePath } from "@/lib/tenant/storefront-request";

/**
 * One implementation behind every non-home storefront page: the built-in
 * routes (/shop, /about, /contact, /gallery) and the catch-all [page] route
 * all call this, so a page's title, visibility and sections come from the
 * owner's page model (storefront-spec/pages.ts) no matter which URL
 * reached it. A page that is hidden, that the business can't serve, or
 * that would render empty is a 404 — never a blank page with a heading.
 */
export async function renderSitePage(slug: string, pageSlug: string, searchParams: { ok?: string; err?: string; collection?: string } = {}) {
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();
  const basePath = await storefrontBasePath(business.slug);

  const [catalog, rating, reviews] = await Promise.all([getActiveCatalog(business.id), getRatingSummary(business.id), listPublishedReviews(business.id, { limit: 50 })]);
  const site = await loadSite(business, basePath, { catalog, reviewCount: rating.count });
  const page = openablePage(site, pageSlug);
  if (!page) notFound();

  // Same rule as Home: `ok` only ever selects a fixed message; `err` is the API's own plain sentence.
  const notice = searchParams.ok
    ? { kind: "ok" as const, message: OK_MESSAGES[searchParams.ok as keyof typeof OK_MESSAGES] ?? OK_MESSAGES.lead }
    : searchParams.err
      ? { kind: "err" as const, message: searchParams.err }
      : undefined;

  const collection = typeof searchParams.collection === "string" ? searchParams.collection.slice(0, 80) : undefined;
  return <SitePageView business={business} page={page} site={site} basePath={basePath} catalog={catalog} reviews={reviews} rating={rating} notice={notice} collection={collection} />;
}

/** What a page is about when the owner hasn't written a search description: a plain sentence per kind, never marketing. */
function pageDescription(page: SitePage, businessName: string): string | null {
  switch (page.kind) {
    case "ABOUT":
      return null; // falls back to the business's own description
    case "CONTACT":
      return `How to reach ${businessName}: phone, WhatsApp, where to find us and when we're open.`;
    case "GALLERY":
      return `Photos from ${businessName}.`;
    case "REVIEWS":
      return `What customers say about ${businessName}.`;
    case "CATALOGUE":
      return `${page.title} from ${businessName}.`;
    case "ACTION":
      return `${page.title} from ${businessName} — send your details and we'll come back to you.`;
    default: {
      const text = page.sections.find((s) => s.type === "TEXT");
      return text && text.type === "TEXT" ? text.body.split(/\n+/)[0].slice(0, 160) : null;
    }
  }
}

/** Title, description, canonical and Open Graph for a storefront page by slug — the owner's own search listing first (pages.ts `seo`). */
export async function sitePageMetadata(slug: string, pageSlug: string): Promise<Metadata> {
  const business = await getBusinessBySlug(slug);
  if (!business) return { title: "Business not found" };
  const site = await loadSite(business, "");
  const page = openablePage(site, pageSlug);
  if (!page) return { title: "Page not found", robots: { index: false, follow: false } };
  return buildPageMetadata(business, { title: page.title, path: `/${page.slug}`, description: pageDescription(page, business.name), seo: page.seo ?? null });
}
