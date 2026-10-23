"use client";

import { useMemo, useState } from "react";
import type { StorefrontProduct } from "@/components/storefront/ProductsSection";
import ShopfrontProductCard from "./ShopfrontProductCard";
import ShopfrontStickyBar from "./ShopfrontStickyBar";
import shared from "./Shopfront.module.css";
import styles from "./ShopfrontShopGrid.module.css";

/**
 * Client-side category filter + search over the real catalog already
 * fetched server-side — these catalogs are small (a handful to a few dozen
 * items for these merchants), so no pagination/server-search is needed,
 * same judgement call the prototype itself made.
 */
export default function ShopfrontShopGrid({
  products,
  businessId,
  basePath,
  ordersEnabled,
  catalogLabel,
  initialCategory,
}: {
  products: StorefrontProduct[];
  businessId: string;
  basePath: string;
  ordersEnabled: boolean;
  catalogLabel: string;
  /** A collection to start filtered on (from ?collection= — a collection tile on Home links here). */
  initialCategory?: string;
}) {
  const [activeCategory, setActiveCategory] = useState(initialCategory && products.some((p) => p.categoryName === initialCategory) ? initialCategory : "All");
  const [search, setSearch] = useState("");

  const categories = useMemo(() => {
    const names = new Set<string>();
    for (const p of products) if (p.categoryName) names.add(p.categoryName);
    return ["All", ...names];
  }, [products]);

  const filtered = products.filter(
    (p) =>
      (activeCategory === "All" || p.categoryName === activeCategory) &&
      p.name.toLowerCase().includes(search.toLowerCase()),
  );

  const priceById = new Map(products.map((p) => [p.id, Number(p.price)]));

  if (products.length === 0) {
    return (
      <div className={`${shared.container} ${styles.empty}`}>
        <p>No {catalogLabel.toLowerCase()} to show yet.</p>
      </div>
    );
  }

  return (
    <>
      <section className={shared.section}>
        <div className={shared.container}>
          {categories.length > 2 && (
            <div className={styles.toolbar}>
              <div className={styles.filters}>
                {categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`${styles.filter} ${c === activeCategory ? styles.filterActive : ""}`}
                    onClick={() => setActiveCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <input
                className={styles.search}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${catalogLabel.toLowerCase()}…`}
                aria-label={`Search ${catalogLabel.toLowerCase()}`}
              />
            </div>
          )}
          {filtered.length === 0 ? (
            <div className={styles.empty}>
              <p>No {catalogLabel.toLowerCase()} match your search.</p>
            </div>
          ) : (
            <div className={styles.grid}>
              {filtered.map((product) => (
                <ShopfrontProductCard
                  key={product.id}
                  product={product}
                  businessId={businessId}
                  basePath={basePath}
                  ordersEnabled={ordersEnabled}
                />
              ))}
            </div>
          )}
        </div>
      </section>
      {ordersEnabled && <ShopfrontStickyBar businessId={businessId} basePath={basePath} priceById={priceById} />}
    </>
  );
}
