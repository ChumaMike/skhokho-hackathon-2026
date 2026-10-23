"use client";

import Link from "next/link";
import { useCart } from "@/lib/storefront/useCart";
import { MAX_LINE_QUANTITY } from "@/lib/storefront/cart";
import styles from "./ShopfrontProductCard.module.css";

/**
 * The one "Add / − qty +" control every Shopfront catalogue display uses
 * (product cards, menu rows) — the real cart (useCart), and items with
 * options go to the real /configure route. Shared, so a template can change
 * how items LOOK without ever forking how they're ADDED.
 */
export default function ShopfrontAddControl({
  product,
  businessId,
  basePath,
}: {
  product: { id: string; name: string; hasOptions: boolean };
  businessId: string;
  basePath: string;
}) {
  const cart = useCart(businessId);
  const quantity = cart.quantityOf(product.id);

  if (product.hasOptions) {
    return (
      <Link
        href={`${basePath}/configure/${product.id}`}
        className={styles.miniBtn}
        aria-label={`Choose options for ${product.name}`}
        data-sf-event="ADD_TO_BASKET"
        data-sf-item={product.id}
      >
        Add
      </Link>
    );
  }

  if (quantity > 0) {
    return (
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
    );
  }

  return (
    <button
      type="button"
      className={styles.miniBtn}
      onClick={() => cart.addQuantity(product.id, 1)}
      aria-label={`Add ${product.name} to basket`}
      data-sf-event="ADD_TO_BASKET"
      data-sf-item={product.id}
    >
      Add
    </button>
  );
}
