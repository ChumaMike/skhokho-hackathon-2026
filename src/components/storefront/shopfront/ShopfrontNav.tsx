"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/lib/storefront/useCart";
import type { NavItem } from "@/modules/storefront-spec/pages";
import styles from "./ShopfrontNav.module.css";

/**
 * Connected Shopfront nav. The links are the business's own pages
 * (storefront-spec/pages.ts → site.ts): whatever the owner has switched on
 * and ordered, minus anything that would open empty. On a phone the links
 * fold behind a Menu button so the brand and basket stay thumb-reachable.
 * No account icon — there is no customer login behind it.
 */
export default function ShopfrontNav({
  businessId,
  businessName,
  basePath,
  items,
}: {
  businessId: string;
  businessName: string;
  basePath: string;
  items: NavItem[];
}) {
  const cart = useCart(businessId);
  const [open, setOpen] = useState(false);

  return (
    <header className={styles.nav}>
      <div className={styles.inner}>
        <Link href={basePath || "/"} className={styles.brand}>
          {businessName}
        </Link>
        <nav className={styles.links} aria-label="Pages">
          {items.map((item) => (
            <Link key={item.id} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <Link href={`${basePath}/basket`} className={styles.basketLink} aria-label="View basket">
          Basket
          {cart.hydrated && cart.totalCount > 0 && <span className={styles.badge}>{cart.totalCount}</span>}
        </Link>
        {items.length > 1 && (
          <button type="button" className={styles.menuButton} aria-expanded={open} aria-controls="shopfront-menu" onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : "Menu"}
          </button>
        )}
      </div>
      {open && items.length > 1 && (
        <nav id="shopfront-menu" className={styles.mobileLinks} aria-label="Pages">
          {items.map((item) => (
            <Link key={item.id} href={item.href} onClick={() => setOpen(false)}>
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
