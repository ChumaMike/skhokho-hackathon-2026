import { NextResponse } from "next/server";
import { getBusinessBySlug } from "@/modules/tenant/tenant.service";
import { storefrontBasePath } from "@/lib/tenant/storefront-request";
import { canonicalStorefrontUrl } from "@/modules/tenant/storefront-url";
import { buildRobotsTxt } from "@/modules/tenant/storefront-seo";

export const dynamic = "force-dynamic";

/**
 * robots.txt for one storefront: crawl everything except the personal
 * paths (basket, checkout, account, configure), and point at this
 * storefront's sitemap. Paths are relative to the host it was fetched on;
 * the sitemap address is canonical.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return new NextResponse("Not found", { status: 404 });
  const base = await storefrontBasePath(business.slug);
  const sitemap = canonicalStorefrontUrl(business.slug, "/sitemap.xml", business.domains?.[0]?.hostname);
  return new NextResponse(buildRobotsTxt(base, sitemap), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
