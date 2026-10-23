import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBusinessBySlug } from "@/modules/tenant/tenant.service";
import { getActiveCatalog } from "@/modules/catalog/catalog.service";
import { getBusinessCapabilities } from "@/modules/tenant/capabilities";
import { resolveStorefrontVariant } from "@/modules/tenant/shopfront-eligibility";
import ShopfrontPageShell from "@/components/storefront/shopfront/ShopfrontPageShell";
import ShopfrontProductDetail from "@/components/storefront/shopfront/ShopfrontProductDetail";
import ShopfrontBookingPageShell from "@/components/storefront/shopfront-booking/ShopfrontBookingPageShell";
import { storefrontBasePath } from "@/lib/tenant/storefront-request";
import { loadSite } from "@/modules/storefront-spec/site";
import { buildPageMetadata, buildProductJsonLd, serializeJsonLd } from "@/modules/tenant/storefront-seo";
import { canonicalStorefrontUrl } from "@/modules/tenant/storefront-url";
import { shareImagePath, shareImageVersion } from "@/lib/storefront/share";

export const dynamic = "force-dynamic";

interface Params {
  slug: string;
  productId: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug, productId } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return { title: "Business not found" };
  const catalog = await getActiveCatalog(business.id);
  const product = catalog.products.find((p) => p.id === productId);
  if (!product) return { title: "Product not found", robots: { index: false, follow: false } };
  // The share image is the composed card (photo, name, price, shop logo — share-image/route.tsx),
  // at its canonical address with a version token so an edit replaces the cached card.
  const version = shareImageVersion({ name: product.name, price: product.price, imageUrl: product.imageUrl ?? product.images[0] ?? null, businessName: business.name, logoUrl: business.logoUrl });
  return buildPageMetadata(business, {
    title: product.name,
    path: `/product/${product.id}`,
    description: product.description ?? `${product.name} from ${business.name}.`,
    image: canonicalStorefrontUrl(business.slug, shareImagePath(product.id, version), business.domains?.[0]?.hostname),
  });
}

/**
 * Finds the product within the same real getActiveCatalog() result every
 * other storefront surface uses — not a second, narrower fetch — so this
 * page can never disagree with the Shop grid about which products exist or
 * whether one has options.
 */
export default async function StoreProductPage({ params }: { params: Promise<Params> }) {
  const { slug, productId } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();
  const basePath = await storefrontBasePath(business.slug);

  const isBooking = resolveStorefrontVariant(business) === "BOOKING";
  if (!isBooking && resolveStorefrontVariant(business) !== "PRODUCT") notFound();

  const catalog = await getActiveCatalog(business.id);
  const product = catalog.products.find((p) => p.id === productId);
  if (!product) notFound();

  const capabilities = getBusinessCapabilities(business);
  if (isBooking && !capabilities.has("PRODUCTS")) notFound();
  const site = await loadSite(business, basePath, { catalog });

  const detail = (
    <>
      {/* serializeJsonLd escapes `<` so a product's own name/description can never break out of this tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildProductJsonLd(business, product)) }} />
      <ShopfrontProductDetail
        product={product}
        businessId={business.id}
        basePath={basePath}
        ordersEnabled={capabilities.has("ORDERS")}
        shareUrl={canonicalStorefrontUrl(business.slug, `/product/${product.id}`, business.domains?.[0]?.hostname)}
      />
    </>
  );

  if (isBooking) {
    return (
      <ShopfrontBookingPageShell business={business} basePath={basePath} site={site}>
        {detail}
      </ShopfrontBookingPageShell>
    );
  }

  return (
    <ShopfrontPageShell business={business} basePath={basePath} site={site}>
      {detail}
    </ShopfrontPageShell>
  );
}
