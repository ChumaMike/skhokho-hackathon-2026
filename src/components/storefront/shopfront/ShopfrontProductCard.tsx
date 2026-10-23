import Link from "next/link";
import { formatZAR } from "@/lib/utils";
import type { StorefrontProduct } from "@/components/storefront/ProductsSection";
import shared from "./Shopfront.module.css";
import styles from "./ShopfrontProductCard.module.css";
import ShopfrontAddControl from "./ShopfrontAddControl";

/**
 * Same real cart/options contract ProductsSection already uses
 * (useCart, hasOptions -> the real /configure route) — new markup only,
 * no new commerce logic.
 */
export default function ShopfrontProductCard({
  product,
  businessId,
  basePath,
  ordersEnabled,
}: {
  product: StorefrontProduct;
  businessId: string;
  basePath: string;
  ordersEnabled: boolean;
}) {
  return (
    <article className={`${shared.card} ${styles.card}`}>
      <Link href={`${basePath}/product/${product.id}`} className={styles.imageLink}>
        {product.imageUrl ? (
          // Business-supplied photo, not a bundled asset.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt={product.name} className={styles.image} />
        ) : (
          <div className={styles.imagePlaceholder} aria-hidden="true">
            {product.name.charAt(0).toUpperCase()}
          </div>
        )}
      </Link>
      <div className={styles.body}>
        {product.categoryName && <div className={styles.category}>{product.categoryName}</div>}
        <Link href={`${basePath}/product/${product.id}`} className={styles.name}>
          {product.name}
        </Link>
        <div className={styles.row}>
          <span className={styles.price}>{formatZAR(product.price)}</span>
          {ordersEnabled && <ShopfrontAddControl product={product} businessId={businessId} basePath={basePath} />}
        </div>
      </div>
    </article>
  );
}
