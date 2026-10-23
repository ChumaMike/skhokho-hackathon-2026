"use client";

import Link from "next/link";
import { useMemo } from "react";
import { formatZAR } from "@/lib/utils";
import { useCart } from "@/lib/storefront/useCart";
import styles from "./ShopfrontStickyBar.module.css";

/**
 * Same browse-time-estimate discipline as ProductsSection's sticky bar —
 * display-only, the real total comes from the server quote on
 * Basket/Checkout. Shared by the Home featured grid and the full Shop page
 * so both stay in sync with the one real cart instance.
 */
export default function ShopfrontStickyBar({
  businessId,
  basePath,
  priceById,
}: {
  businessId: string;
  basePath: string;
  priceById: Map<string, number>;
}) {
  const cart = useCart(businessId);
  const subtotal = useMemo(
    () => cart.lines.reduce((sum, line) => sum + (priceById.get(line.productId) ?? 0) * line.quantity, 0),
    [cart.lines, priceById],
  );

  if (!cart.hydrated || cart.totalCount === 0) return null;

  return (
    <div className={styles.bar} aria-live="polite">
      <div className={styles.summary}>
        <span className={styles.count}>
          {cart.totalCount} {cart.totalCount === 1 ? "item" : "items"}
        </span>
        <span className={styles.total}>{formatZAR(subtotal)}</span>
      </div>
      <Link href={`${basePath}/basket`} className={styles.link}>
        View basket →
      </Link>
    </div>
  );
}
