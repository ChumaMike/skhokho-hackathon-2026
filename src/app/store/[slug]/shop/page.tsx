import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBusinessBySlug } from "@/modules/tenant/tenant.service";
import { resolveStorefrontVariant } from "@/modules/tenant/shopfront-eligibility";
import { renderSitePage, sitePageMetadata } from "../[page]/render";

export const dynamic = "force-dynamic";

interface Params {
  slug: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  return sitePageMetadata(slug, "shop");
}

/**
 * The product catalogue page — a page of the owner's page model
 * (storefront-spec/pages.ts, id CATALOGUE_PRODUCTS) so its title, place in
 * the nav and extra sections are theirs. Connected Shopfront only: a
 * business on the LEGACY design keeps its catalogue inline on Home and
 * 404s here, as before. A business without the PRODUCTS capability has no
 * such page and 404s too.
 */
export default async function StoreShopPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ collection?: string; sort?: string }> }) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();
  if (resolveStorefrontVariant(business) === "LEGACY") notFound();
  return renderSitePage(slug, "shop", await searchParams);
}
