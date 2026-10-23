import Link from "next/link";
import type { StorefrontProduct } from "@/components/storefront/ProductsSection";
import ShopfrontProductCard from "./ShopfrontProductCard";
import ShopfrontStickyBar from "./ShopfrontStickyBar";
import shared from "./Shopfront.module.css";
import styles from "./ShopfrontFeaturedProducts.module.css";

export default function ShopfrontFeaturedProducts({
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
  const featured = products.slice(0, 4);
  const priceById = new Map(products.map((p) => [p.id, Number(p.price)]));

  return (
    <>
      <section className={shared.section} data-sf-section="CATALOGUE">
        <div className={shared.container}>
          <div className={shared.sectionHead}>
            <div>
              <p className={shared.eyebrow}>Featured</p>
              <h2 className={styles.heading}>What people come back for.</h2>
            </div>
            <Link href={`${basePath}/shop`} className={styles.viewAll}>
              View {catalogLabel.toLowerCase()} →
            </Link>
          </div>
          <div className={styles.grid}>
            {featured.map((product) => (
              <ShopfrontProductCard
                key={product.id}
                product={product}
                businessId={businessId}
                basePath={basePath}
                ordersEnabled={ordersEnabled}
              />
            ))}
          </div>
        </div>
      </section>
      {ordersEnabled && <ShopfrontStickyBar businessId={businessId} basePath={basePath} priceById={priceById} />}
    </>
  );
}
