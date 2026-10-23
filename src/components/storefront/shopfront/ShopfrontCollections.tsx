import Link from "next/link";
import type { StorefrontProduct } from "@/components/storefront/ProductsSection";
import { groupByCategory } from "@/lib/storefront/catalog-groups";
import ShopfrontProductCard from "./ShopfrontProductCard";
import ShopfrontStickyBar from "./ShopfrontStickyBar";
import shared from "./Shopfront.module.css";
import styles from "./ShopfrontCollections.module.css";

const FEATURED = 4;
const MAX_COLLECTIONS = 8;

/**
 * The RETAIL_GRID composition's catalogue (COLLECTIONS layout): the range by
 * collection as tiles — a category name, how many pieces, the first photo in
 * it — each opening the Shop page already filtered, then a featured row.
 * Collections are the owner's own product categories; a shop without
 * categories gets the featured row alone, nothing invented.
 */
export default function ShopfrontCollections({
  products,
  businessId,
  basePath,
  ordersEnabled,
  catalogLabel,
}: {
  products: StorefrontProduct[];
  businessId: string;
  basePath: string;
  ordersEnabled: boolean;
  catalogLabel: string;
}) {
  if (products.length === 0) return null;
  const collections = groupByCategory(products)
    .filter((g) => g.id !== null)
    .slice(0, MAX_COLLECTIONS);
  const featured = products.slice(0, FEATURED);
  const priceById = new Map(products.map((p) => [p.id, Number(p.price)]));

  return (
    <>
      <section className={shared.section} id="collections" data-sf-section="CATALOGUE">
        <div className={shared.container}>
          {collections.length > 1 && (
            <>
              <div className={shared.sectionHead}>
                <div>
                  <p className={shared.eyebrow}>Collections</p>
                  <h2 className={styles.heading}>Browse by collection.</h2>
                </div>
                <Link href={`${basePath}/shop`} className={styles.viewAll}>
                  All {catalogLabel.toLowerCase()} →
                </Link>
              </div>
              <ul className={styles.tiles}>
                {collections.map((collection) => {
                  const cover = collection.products.find((p) => p.imageUrl)?.imageUrl ?? null;
                  const name = collection.name ?? "More";
                  return (
                    <li key={collection.id}>
                      <Link href={`${basePath}/shop?collection=${encodeURIComponent(name)}`} className={styles.tile} data-sf-event="CTA_CLICK">
                        {cover ? (
                          // Business-supplied photo, not a bundled asset.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={cover} alt="" className={styles.tileImage} loading="lazy" />
                        ) : (
                          <div className={styles.tileFallback} aria-hidden="true">
                            {name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span className={styles.tileBody}>
                          <span className={styles.tileName}>{name}</span>
                          <span className={styles.tileCount}>
                            {collection.products.length} {collection.products.length === 1 ? "piece" : "pieces"}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <div className={`${shared.sectionHead} ${styles.featuredHead}`}>
            <div>
              <p className={shared.eyebrow}>Featured</p>
              <h2 className={styles.heading}>Worth a look this week.</h2>
            </div>
            {collections.length <= 1 && (
              <Link href={`${basePath}/shop`} className={styles.viewAll}>
                All {catalogLabel.toLowerCase()} →
              </Link>
            )}
          </div>
          <div className={styles.featured}>
            {featured.map((product) => (
              <ShopfrontProductCard key={product.id} product={product} businessId={businessId} basePath={basePath} ordersEnabled={ordersEnabled} />
            ))}
          </div>
        </div>
      </section>
      {ordersEnabled && <ShopfrontStickyBar businessId={businessId} basePath={basePath} priceById={priceById} />}
    </>
  );
}
