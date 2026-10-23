"use client";

import Link from "next/link";
import { useMemo } from "react";
import { formatZAR } from "@/lib/utils";
import { useCart } from "@/lib/storefront/useCart";
import { MAX_LINE_QUANTITY } from "@/lib/storefront/cart";
import viewStyles from "@/components/StorefrontView.module.css";
import styles from "./ProductsSection.module.css";
import { groupByCategory } from "@/lib/storefront/catalog-groups";

export interface StorefrontProduct {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  price: string;
  /** Food Menu Domain Foundation §9 — null for an uncategorised item, a valid common state. */
  categoryId: string | null;
  categoryName: string | null;
  /** §10 — when true, "Add" opens the configurator instead of adding one unit directly. */
  hasOptions: boolean;
}


/**
 * Replaces the old per-product order form (removed — see
 * StorefrontView.tsx). A product card is now: image, name, description,
 * price, and an Add-to-basket control. No phone/email/consent/fulfilment
 * here — the basket is for browsing, the checkout page (once) collects
 * everything else. Renders the sticky basket entry point alongside the
 * product list since both share one `useCart` instance and must update
 * together the instant a quantity changes.
 *
 * Food Menu Domain Foundation (Phase 4) §9/§10: products are grouped by
 * category where categories exist, and a product with configured customer
 * choices links to the dedicated configurator route instead of exposing an
 * inline quantity stepper (a card can't sensibly show "how many" when
 * several differently-configured lines of the same product may exist at
 * once — see cart-line identity, lib/storefront/cart.ts).
 */
export default function ProductsSection({
  businessId,
  basePath,
  products,
  ordersEnabled,
  catalogLabel = "Products",
}: {
  businessId: string;
  basePath: string;
  products: StorefrontProduct[];
  /** A business can have PRODUCTS for display without ORDERS turned on (an explicit settings.capabilities override) — the basket/order flow is gated on ORDERS specifically, never assumed from PRODUCTS alone. */
  ordersEnabled: boolean;
  /** Business Experience Registry's catalogLabel (e.g. "Menu" for Food) — the fallback heading shown when every product is uncategorised. Defaults to "Products" for any caller that doesn't pass it. */
  catalogLabel?: string;
}) {
  const cart = useCart(businessId);

  // Display-only, from catalogue data already rendered on this page — the
  // server quote (fetched fresh on Basket/Checkout entry) is what actually
  // controls the real total. A configured line's real price (with option
  // deltas) is only known once quoted server-side; this browse-time total
  // undercounts configured lines by their deltas, same honest limitation
  // the sticky bar already had for stale-price drift before a fresh quote.
  const priceById = useMemo(() => new Map(products.map((p) => [p.id, Number(p.price)])), [products]);
  const browseSubtotal = cart.lines.reduce((sum, line) => sum + (priceById.get(line.productId) ?? 0) * line.quantity, 0);

  if (products.length === 0) return null;

  const groups = groupByCategory(products);

  return (
    <>
      <section className={viewStyles.section} id="storefront-products">
        {groups.map((group) => (
          <div key={group.id ?? "uncategorised"} className={styles.categoryGroup}>
            {group.name && <h2 className={viewStyles.sectionTitle}>{group.name}</h2>}
            {!group.name && groups.length === 1 && <h2 className={viewStyles.sectionTitle}>{catalogLabel}</h2>}
            {/* Photo-forward grid — one column on a phone, two once the
               storefront's own .column.wide breakpoint (860px) gives it
               real room. Services (StorefrontView.tsx) deliberately stay a
               single duration-forward list instead — a grid suits browsing
               a catalogue by picture, not scanning appointment durations. */}
            <ul className={styles.productGrid}>
              {group.products.map((product) => (
                <li key={product.id} className={`card ${styles.productCard}`}>
                  {product.imageUrl ? (
                    // Business-supplied photo, not a bundled asset — plain img.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.imageUrl} alt={product.name} className={styles.productImage} />
                  ) : (
                    <div className={styles.productImagePlaceholder} aria-hidden="true">
                      {product.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className={styles.productBody}>
                    <div className={styles.productInfo}>
                      <span className={styles.productName}>{product.name}</span>
                      {product.description && <span className={styles.productDesc}>{product.description}</span>}
                    </div>
                    <div className={styles.productFooter}>
                      <span className={styles.productPrice}>{formatZAR(product.price)}</span>
                      {ordersEnabled &&
                        (product.hasOptions ? (
                          <Link
                            href={`${basePath}/configure/${product.id}`}
                            className={`btn ${viewStyles.storeActionSecondary} ${styles.addButton}`}
                          >
                            Add
                          </Link>
                        ) : (
                          <QuantityControl
                            productName={product.name}
                            quantity={cart.quantityOf(product.id)}
                            onAdd={() => cart.addQuantity(product.id, 1)}
                            onDecrease={() => cart.addQuantity(product.id, -1)}
                            onRemove={() => cart.removeLine(product.id)}
                          />
                        ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {ordersEnabled && cart.hydrated && cart.totalCount > 0 && (
        <div className={styles.stickyBar} aria-live="polite">
          <div className={styles.stickyBarSummary}>
            <span className={styles.stickyBarCount}>
              {cart.totalCount} {cart.totalCount === 1 ? "item" : "items"}
            </span>
            <span className={styles.stickyBarTotal}>{formatZAR(browseSubtotal)}</span>
          </div>
          <Link href={`${basePath}/basket`} className={styles.stickyBarLink}>
            View basket →
          </Link>
        </div>
      )}
    </>
  );
}

function QuantityControl({
  productName,
  quantity,
  onAdd,
  onDecrease,
  onRemove,
}: {
  productName: string;
  quantity: number;
  onAdd: () => void;
  onDecrease: () => void;
  onRemove: () => void;
}) {
  if (quantity <= 0) {
    return (
      <button
        type="button"
        className={`btn ${viewStyles.storeActionSecondary} ${styles.addButton}`}
        onClick={onAdd}
        aria-label={`Add ${productName} to basket`}
      >
        Add
      </button>
    );
  }

  return (
    <div className={styles.stepper} role="group" aria-label={`${productName} quantity`}>
      <button
        type="button"
        className={styles.stepperButton}
        onClick={quantity === 1 ? onRemove : onDecrease}
        aria-label={quantity === 1 ? `Remove ${productName}` : `Decrease ${productName} quantity`}
      >
        {quantity === 1 ? "×" : "−"}
      </button>
      <span className={styles.stepperQty}>{quantity}</span>
      <button
        type="button"
        className={styles.stepperButton}
        onClick={onAdd}
        disabled={quantity >= MAX_LINE_QUANTITY}
        aria-label={`Increase ${productName} quantity`}
      >
        +
      </button>
    </div>
  );
}
