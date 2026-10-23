import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBusinessBySlug, getStorefrontTemplateSelection } from "@/modules/tenant/tenant.service";
import { resolveStorefrontTemplate } from "@/modules/tenant/storefront-templates";
import { resolveStorefrontPageTokens } from "@/modules/tenant/storefront-theme";
import { getStorefrontContent } from "@/modules/tenant/storefront-content";
import { buildStorefrontMetadata } from "@/modules/tenant/storefront-seo";
import { resolveStorefrontVariant } from "@/modules/tenant/shopfront-eligibility";
import StorefrontPageShell from "@/components/storefront/StorefrontPageShell";
import AboutSection from "@/components/storefront/AboutSection";
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
  if (resolveStorefrontVariant(business) !== "LEGACY") return sitePageMetadata(slug, "about");
  return buildStorefrontMetadata(business, "ABOUT");
}

/**
 * Shopfront businesses render About from the owner's page model
 * (storefront-spec/pages.ts) — title, visibility and sections are theirs.
 * The LEGACY design keeps the old behaviour: only reachable when its active
 * template includes an ABOUT page.
 */
export default async function StoreAboutPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();
  if (resolveStorefrontVariant(business) !== "LEGACY") return renderSitePage(slug, "about");

  const basePath = await storefrontBasePath(business.slug);
  const { activeTemplateId, generatedTemplate } = await getStorefrontTemplateSelection(business.id);
  const template = resolveStorefrontTemplate({ activeTemplateId, generatedTemplate });
  if (!template.pages.includes("ABOUT")) notFound();

  const tokens = resolveStorefrontPageTokens(business);
  const content = getStorefrontContent(business);

  return (
    <StorefrontPageShell tokens={tokens} footerBusiness={business} nav={template.pages} basePath={basePath}>
      <AboutSection description={business.description} body={content.about.body} />
    </StorefrontPageShell>
  );
}
