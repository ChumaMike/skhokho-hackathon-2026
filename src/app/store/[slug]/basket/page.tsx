import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBusinessBySlug } from "@/modules/tenant/tenant.service";
import CheckoutShell from "@/components/storefront/CheckoutShell";
import BasketView from "@/components/storefront/BasketView";
import { storefrontBasePath } from "@/lib/tenant/storefront-request";
import { noindexMetadata } from "@/modules/tenant/storefront-seo";

export const dynamic = "force-dynamic";

interface Params {
  slug: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  // A basket is personal, never a page to index (storefront-seo.ts NOINDEX_PATHS).
  return noindexMetadata(business ? `Basket — ${business.name}` : "Business not found");
}

/**
 * ORDER REVIEW only — line items, quantities, subtotal, Continue. No
 * customer information/Terms/marketing/delivery address here (that's the
 * checkout page, once). Cart lines live client-side (localStorage,
 * businessId-namespaced); this page's server half only resolves which
 * business is being shopped and its theme.
 */
export default async function BasketPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();
  const basePath = await storefrontBasePath(business.slug);

  return (
    <CheckoutShell business={business} basePath={basePath} pageTitle="Your basket">
      <BasketView businessId={business.id} basePath={basePath} />
    </CheckoutShell>
  );
}
