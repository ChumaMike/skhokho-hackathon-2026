import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBusinessBySlug } from "@/modules/tenant/tenant.service";
import { getActiveCatalog } from "@/modules/catalog/catalog.service";
import { getBusinessCapabilities } from "@/modules/tenant/capabilities";
import { getBusinessExperience } from "@/modules/tenant/business-experience";
import { resolveStorefrontVariant } from "@/modules/tenant/shopfront-eligibility";
import ShopfrontPageShell from "@/components/storefront/shopfront/ShopfrontPageShell";
import ShopfrontBookingPageShell from "@/components/storefront/shopfront-booking/ShopfrontBookingPageShell";
import ShopfrontProductCard from "@/components/storefront/shopfront/ShopfrontProductCard";
import ShopfrontStickyBar from "@/components/storefront/shopfront/ShopfrontStickyBar";
import { storefrontBasePath } from "@/lib/tenant/storefront-request";
import { loadSite } from "@/modules/storefront-spec/site";
import { buildPageMetadata, buildProductListJsonLd, serializeJsonLd } from "@/modules/tenant/storefront-seo";
import { productsWithTag, tagPagePath } from "@/lib/storefront/share";
import shared from "@/components/storefront/shopfront/Shopfront.module.css";
import grid from "@/components/storefront/shopfront/ShopfrontFeaturedProducts.module.css";

export const dynamic = "force-dynamic";

interface Params {
  slug: string;
  tag: string;
}

/**
 * Title, description, canonical and Open Graph for a tag page. Indexable on
 * purpose: "#kota at Kota-Tainment" is a page worth finding. A tag nobody
 * uses is a 404 with noindex, never an empty page.
 */
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug, tag } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) return { title: "Business not found" };
  const catalog = await getActiveCatalog(business.id);
  const match = productsWithTag(catalog.products, decodeURIComponent(tag));
  if (!match) return { title: "Nothing here", robots: { index: false, follow: false } };
  const n = match.products.length;
  return buildPageMetadata(business, {
    title: `#${match.tag}`,
    path: tagPagePath(match.tag),
    description: `${n} ${n === 1 ? "item" : "items"} tagged #${match.tag} at ${business.name}.`,
    image: match.products.find((p) => p.imageUrl)?.imageUrl ?? null,
  });
}

/**
 * Social products (Tab 7): one shop's products that carry a hashtag, at
 * /tag/<tag> under that shop — the page a hashtag in a share or on a product
 * links to. Same real catalogue read and the same cards as the Shop page;
 * the tag is matched by the stored rule (share.ts), so "#Kota" and "kota"
 * are the same page. Hashtags never cross shops here: a tag page is this
 * shop's own, which keeps every count and every link inside the tenant.
 */
export default async function StoreTagPage({ params }: { params: Promise<Params> }) {
  const { slug, tag } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();
  const variant = resolveStorefrontVariant(business);
  if (variant === "LEGACY") notFound();
  const capabilities = getBusinessCapabilities(business);
  if (!capabilities.has("PRODUCTS")) notFound();

  const basePath = await storefrontBasePath(business.slug);
  const catalog = await getActiveCatalog(business.id);
  const match = productsWithTag(catalog.products, decodeURIComponent(tag));
  if (!match) notFound();

  const site = await loadSite(business, basePath, { catalog });
  const experience = getBusinessExperience(business.category);
  const ordersEnabled = capabilities.has("ORDERS");
  const priceById = new Map(match.products.map((p) => [p.id, Number(p.price)]));
  const count = match.products.length;

  const content = (
    <>
      {/* serializeJsonLd escapes `<` so a product name can never break out of this tag. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildProductListJsonLd(business, match.products)) }} />
      <div className={shared.pageHero}>
        <div className={shared.container}>
          <p className={shared.eyebrow}>{business.name}</p>
          <h1 className={shared.pageHeroHeading}>#{match.tag}</h1>
          <p>
            {count} {count === 1 ? "item" : "items"} · <Link href={`${basePath}/shop`}>All {experience.catalogLabel.toLowerCase()} →</Link>
          </p>
        </div>
      </div>
      <section className={shared.section} data-sf-section="CATALOGUE">
        <div className={shared.container}>
          <div className={grid.grid}>
            {match.products.map((product) => (
              <ShopfrontProductCard key={product.id} product={product} businessId={business.id} basePath={basePath} ordersEnabled={ordersEnabled} />
            ))}
          </div>
        </div>
      </section>
      {ordersEnabled && <ShopfrontStickyBar businessId={business.id} basePath={basePath} priceById={priceById} />}
    </>
  );

  if (variant === "BOOKING") {
    return (
      <ShopfrontBookingPageShell business={business} basePath={basePath} site={site}>
        {content}
      </ShopfrontBookingPageShell>
    );
  }
  return (
    <ShopfrontPageShell business={business} basePath={basePath} site={site}>
      {content}
    </ShopfrontPageShell>
  );
}
