"use client";

import Link from "next/link";
import { formatZAR } from "@/lib/utils";
import { useCart } from "@/lib/storefront/useCart";
import { MAX_LINE_QUANTITY } from "@/lib/storefront/cart";
import type { StorefrontProduct } from "@/components/storefront/ProductsSection";
import shared from "./Shopfront.module.css";
import styles from "./ShopfrontProductDetail.module.css";

/** Same real useCart/configure-route contract as ShopfrontProductCard, single-product layout. */
export default function ShopfrontProductDetail({
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
  const cart = useCart(businessId);
  const quantity = cart.quantityOf(product.id);

  return (
    <section className={shared.section}>
      <div className={`${shared.container} ${styles.detail}`}>
        <div className={styles.imageWrap}>
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.imageUrl} alt={product.name} className={styles.image} />
          ) : (
            <div className={styles.imagePlaceholder} aria-hidden="true">
              {product.name.charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div className={styles.meta}>
          {product.categoryName && <div className={styles.category}>{product.categoryName}</div>}
          <h1 className={styles.name}>{product.name}</h1>
          <div className={styles.price}>{formatZAR(product.price)}</div>
          {product.description && <p className={styles.description}>{product.description}</p>}

          {ordersEnabled &&
            (product.hasOptions ? (
              <Link href={`${basePath}/configure/${product.id}`} className={`${shared.btn} ${shared.btnPrimary}`}>
                Choose options
              </Link>
            ) : quantity > 0 ? (
              <div className={styles.stepper} role="group" aria-label={`${product.name} quantity`}>
                <button
                  type="button"
                  className={styles.stepperButton}
                  onClick={() => (quantity === 1 ? cart.removeLine(product.id) : cart.addQuantity(product.id, -1))}
                  aria-label={quantity === 1 ? `Remove ${product.name}` : `Decrease ${product.name} quantity`}
                >
                  {quantity === 1 ? "×" : "−"}
                </button>
                <span className={styles.stepperQty}>{quantity}</span>
                <button
                  type="button"
                  className={styles.stepperButton}
                  onClick={() => cart.addQuantity(product.id, 1)}
                  disabled={quantity >= MAX_LINE_QUANTITY}
                  aria-label={`Increase ${product.name} quantity`}
                >
                  +
                </button>
              </div>
            ) : (
              <button type="button" className={`${shared.btn} ${shared.btnPrimary}`} onClick={() => cart.addQuantity(product.id, 1)}>
                Add to basket
              </button>
            ))}

          <p className={styles.helpLine}>
            Need something specific? <Link href={`${basePath}/contact`}>Get in touch</Link>.
          </p>
        </div>
      </div>
    </section>
  );
}
