import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBusinessBySlug } from "@/modules/tenant/tenant.service";
import { getActiveProductForConfigurator } from "@/modules/catalog/catalog.service";
import { getActiveOptionGroupsForProduct } from "@/modules/catalog/menu-options.service";
import CheckoutShell from "@/components/storefront/CheckoutShell";
import ConfiguratorView from "@/components/storefront/ConfiguratorView";
import { storefrontBasePath } from "@/lib/tenant/storefront-request";

export const dynamic = "force-dynamic";

interface Params {
  slug: string;
  productId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  return { title: business ? `Customise — ${business.name}` : "Business not found" };
}

/**
 * Food Menu Domain Foundation §10 — a dedicated, accessible route rather
 * than an inline modal on the product card, per the milestone's own
 * guidance ("if there is no robust dialog primitive, prefer a dedicated
 * configuration page"). Reads are the same tenant/active-scoped functions
 * the authoritative quote resolver uses (getActiveOptionGroupsForProduct);
 * this page NEVER writes an order — it only lets the customer choose,
 * client-side, before the real price is (re)computed by
 * resolveStorefrontCartQuote at Basket/Checkout time.
 */
export default async function ConfigureProductPage({ params }: { params: Promise<Params> }) {
  const { slug, productId } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();
  const basePath = await storefrontBasePath(business.slug);

  const product = await getActiveProductForConfigurator(business.id, productId);
  if (!product) notFound();

  const optionGroups = await getActiveOptionGroupsForProduct(business.id, productId);

  return (
    <CheckoutShell business={business} basePath={basePath} pageTitle={product.name}>
      <ConfiguratorView businessId={business.id} basePath={basePath} product={product} optionGroups={optionGroups} />
    </CheckoutShell>
  );
}
