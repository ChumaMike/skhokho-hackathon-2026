import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import type { Business, BusinessSubscription } from "@prisma/client";
import { getStorefrontConfig, resolveStorefrontTokens } from "@/modules/tenant/storefront-theme";
import viewStyles from "@/components/StorefrontView.module.css";
import styles from "./CheckoutShell.module.css";

type StorefrontBusiness = Business & { subscription: BusinessSubscription | null };

/**
 * The shared, lightweight theme wrapper for Basket and Checkout — both
 * customer-facing storefront surfaces that must use the same Storefront
 * Theme Engine tokens as the main storefront page (never a second colour
 * system, never the dashboard's --chalk/--ink). Deliberately NOT the full
 * StorefrontView (no hero/catalogue/reviews here) — just its `.themeScope`
 * token wrapper and a minimal identity header + back link, reused as-is.
 */
export default function CheckoutShell({
  business,
  basePath,
  pageTitle,
  children,
  wide,
}: {
  business: StorefrontBusiness;
  /** '' on the business's own host, `/store/<slug>` on the platform host — see storefront-request.ts. */
  basePath: string;
  pageTitle: string;
  children: ReactNode;
  /** Checkout only — widens past the storefront's standard 520px single
   * column so the order summary can sit in a sticky side rail on desktop.
   * Basket/Configurator stay at the default width. */
  wide?: boolean;
}) {
  const storefrontConfig = getStorefrontConfig(business);
  const tokens = resolveStorefrontTokens(
    { primaryColor: business.primaryColor, accentColor: business.accentColor },
    storefrontConfig,
  );

  return (
    <main className="shell">
      <div
        className={`column ${viewStyles.themeScope} ${wide ? styles.wideColumn : ""}`}
        style={tokens as CSSProperties}
      >
        <header className={styles.header}>
          <h1 className={styles.name}>{business.name}</h1>
          <Link href={basePath || "/"} className={styles.backLink}>
            ← Back to store
          </Link>
        </header>
        <h2 className={styles.pageTitle}>{pageTitle}</h2>
        {children}
      </div>
    </main>
  );
}
