import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBusinessBySlug, getStorefrontTemplateSelection } from "@/modules/tenant/tenant.service";
import { getActiveCatalog } from "@/modules/catalog/catalog.service";
import { resolveStorefrontTemplate } from "@/modules/tenant/storefront-templates";
import { resolveStorefrontPageTokens } from "@/modules/tenant/storefront-theme";
import { buildStorefrontMetadata } from "@/modules/tenant/storefront-seo";
import { resolveStorefrontVariant } from "@/modules/tenant/shopfront-eligibility";
import StorefrontPageShell from "@/components/storefront/StorefrontPageShell";
import GallerySection from "@/components/storefront/GallerySection";
import { storefrontBasePath } from "@/lib/tenant/storefront-request";
import { renderSitePage, sitePageMetadata } from "../[page]/render";

export const dynamic = "force-dynamic";

interface Params {
  slug: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return { title: "Business not found" };
  if (resolveStorefrontVariant(business) !== "LEGACY") return sitePageMetadata(slug, "gallery");
  return buildStorefrontMetadata(business, "GALLERY");
}

/**
 * Shopfront businesses get a real Gallery page from the owner's page model
 * (storefront-spec/pages.ts) — it opens as soon as the catalogue has a
 * photo and stays hidden until then. The LEGACY design keeps the old
 * behaviour: only reachable when its active template includes GALLERY.
 */
export default async function StoreGalleryPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();
  if (resolveStorefrontVariant(business) !== "LEGACY") return renderSitePage(slug, "gallery");

  const basePath = await storefrontBasePath(business.slug);
  const { activeTemplateId, generatedTemplate } = await getStorefrontTemplateSelection(business.id);
  const template = resolveStorefrontTemplate({ activeTemplateId, generatedTemplate });
  if (!template.pages.includes("GALLERY")) notFound();

  const catalog = await getActiveCatalog(business.id);
  const tokens = resolveStorefrontPageTokens(business);

  return (
    <StorefrontPageShell tokens={tokens} footerBusiness={business} nav={template.pages} basePath={basePath}>
      <GallerySection products={catalog.products} />
    </StorefrontPageShell>
  );
}
