"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/lib/storefront/useCart";
import type { NavItem } from "@/modules/storefront-spec/pages";
import styles from "./ShopfrontNavCentered.module.css";

/**
 * Nav for the services/booking Shopfront variant — a 3-column grid (brand
 * left / links centred / actions right). Links are the business's own pages
 * (storefront-spec/pages.ts); the main action stays pinned on the right.
 * A basket only appears when the business also sells products. On a phone
 * the links fold behind a Menu button; the main action stays visible.
 */
export default function ShopfrontNavCentered({
  businessId,
  businessName,
  basePath,
  hasShop,
  action,
  items,
}: {
  businessId: string;
  businessName: string;
  basePath: string;
  /** True only when the business also has the PRODUCTS capability — adds the basket. */
  hasShop: boolean;
  /** The storefront's main action (a published template may lead with WhatsApp/call instead of booking). */
  action?: { label: string; href: string };
  items: NavItem[];
}) {
  const cart = useCart(businessId);
  const cta = action ?? { label: "Book now", href: `${basePath}#services` };
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
        <div className={styles.actions}>
          {hasShop && (
            <Link href={`${basePath}/basket`} className={styles.basketLink} aria-label="View basket">
              Basket
              {cart.hydrated && cart.totalCount > 0 && <span className={styles.badge}>{cart.totalCount}</span>}
            </Link>
          )}
          <Link href={cta.href} className={styles.bookButton} data-sf-event="CTA_CLICK" data-sf-section="NAV">
            {cta.label}
          </Link>
          {items.length > 1 && (
            <button type="button" className={styles.menuButton} aria-expanded={open} aria-controls="shopfront-menu" onClick={() => setOpen((v) => !v)}>
              {open ? "Close" : "Menu"}
            </button>
          )}
        </div>
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
