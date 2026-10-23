import { NextResponse } from "next/server";
import { getBusinessBySlug } from "@/modules/tenant/tenant.service";
import { getActiveCatalog } from "@/modules/catalog/catalog.service";
import { loadSite } from "@/modules/storefront-spec/site";
import { pageHasContent } from "@/modules/storefront-spec/pages";
import { canonicalStorefrontUrl } from "@/modules/tenant/storefront-url";
import { buildSitemapXml, type SitemapEntry } from "@/modules/tenant/storefront-seo";
import { tagPagePath, uniqueHashtags } from "@/lib/storefront/share";

export const dynamic = "force-dynamic";

/**
 * One sitemap per storefront: home, every page that can open right now
 * (the same rule the nav uses — hidden or empty pages are not listed),
 * every active product, and every hashtag page (Tab 7). Addresses are canonical (the business's own
 * domain when it has one), whichever host the sitemap was fetched from.
 * On a merchant's host the middleware rewrites /sitemap.xml here.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return new NextResponse("Not found", { status: 404 });

  const host = business.domains?.[0]?.hostname;
  const catalog = await getActiveCatalog(business.id);
  const site = await loadSite(business, "", { catalog });

  const entries: SitemapEntry[] = [{ loc: canonicalStorefrontUrl(business.slug, "", host), lastmod: business.updatedAt }];
  for (const page of site.pages) {
    if (page.kind === "HOME" || !page.visible || !pageHasContent(page, site.facts)) continue;
    entries.push({ loc: canonicalStorefrontUrl(business.slug, `/${page.slug}`, host), lastmod: business.updatedAt });
  }
  for (const product of catalog.products) {
    entries.push({ loc: canonicalStorefrontUrl(business.slug, `/product/${product.id}`, host) });
  }
  for (const tag of uniqueHashtags(catalog.products)) {
    entries.push({ loc: canonicalStorefrontUrl(business.slug, tagPagePath(tag), host) });
  }

  return new NextResponse(buildSitemapXml(entries), {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
