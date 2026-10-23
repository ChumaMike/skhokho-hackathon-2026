import Link from "next/link";
import styles from "./connected-shopfront.module.css";

/**
 * Shared across every Connected Shopfront marketing page (/, /product,
 * /for-businesses, /how-it-works) so provenance and site links stay
 * consistent everywhere, not just on the homepage.
 *
 * Naming: the product is "Skhokho"; the company behind it is Skhokho
 * Laboratory, trading as "Skhokho Labs". Legal copy (terms, privacy) must
 * name Skhokho Laboratory ("Skhokho Labs"), never just "Skhokho".
 */
export default function MarketingFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.brand}><span className={styles.sunmark}>✦</span><span>Skhokho</span></div>
      <p>Skhokho is built by Skhokho Labs. Real businesses. A brighter tomorrow.</p>
      <nav>
        <Link href="/product">Product</Link>
        <Link href="/for-businesses">For businesses</Link>
        <Link href="/how-it-works">How it works</Link>
        <Link href="/discover">Explore</Link>
        <Link href="/terms">Terms</Link>
      </nav>
      <small>© {new Date().getFullYear()} Skhokho Laboratory (&ldquo;Skhokho Labs&rdquo;)</small>
    </footer>
  );
}
