import type { Metadata } from "next";
import { openablePage } from "@/modules/storefront-spec/site";
import SitePageView from "@/components/storefront/site/SitePageView";
import { PreviewBanner, loadPreview } from "../preview";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Storefront preview",
  robots: { index: false, follow: false },
};

/**
 * Any page of a draft, at the preview's own address: /preview/storefront/
 * <id>/about, /returns, /quote … rendered through the same SitePageView the
 * live store uses, with the draft's pages, words and layouts. Addresses that
 * aren't pages of the website (a product, the basket, checkout) can't be
 * previewed from a draft — the owner is pointed at the live store instead.
 */
export default async function StorefrontRevisionPagePreview({ params }: { params: Promise<{ revisionId: string; rest: string[] }> }) {
  const { revisionId, rest } = await params;
  const { revision, business, previewBusiness, catalog, rating, reviews, basePath, site } = await loadPreview(revisionId);
  const liveBase = `/store/${business.slug}`;
  const slug = rest.length === 1 ? rest[0] : "";
  const page = slug ? openablePage(site, slug) : null;

  if (!page) {
    return (
      <>
        <PreviewBanner revision={revision} liveHref={liveBase} />
        <main style={{ padding: "48px 20px", textAlign: "center", fontFamily: "inherit" }}>
          <p style={{ maxWidth: 480, margin: "0 auto 12px" }}>This part of your store (products, basket and checkout) doesn&apos;t change with the draft, so it isn&apos;t shown in the preview.</p>
          <a href={`${liveBase}/${rest.join("/")}`}>Open it on your live store →</a>
        </main>
      </>
    );
  }

  return (
    <>
      <PreviewBanner revision={revision} liveHref={`${liveBase}/${page.slug}`} />
      <SitePageView business={previewBusiness} page={page} site={site} basePath={basePath} catalog={catalog} reviews={reviews} rating={rating} />
    </>
  );
}
