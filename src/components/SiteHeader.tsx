import Link from "next/link";
import styles from "./SiteHeader.module.css";

type Page =
  | "home"
  | "product"
  | "forBusinesses"
  | "howItWorks"
  | "discover"
  | "showcase"
  | "login"
  | "join";

// Product/For businesses/How it works are real pages (not homepage
// anchors) so this nav works identically from any page on the site, not
// just when scrolled to the top of "/".
const NAV_LINKS: { page: Page; href: string; label: string }[] = [
  { page: "product", href: "/product", label: "Product" },
  { page: "forBusinesses", href: "/for-businesses", label: "For businesses" },
  { page: "howItWorks", href: "/how-it-works", label: "How it works" },
  { page: "discover", href: "/discover", label: "Find a business" },
  { page: "login", href: "/login", label: "Log in" },
];

/**
 * Shared header for the public-facing pages (/, /product, /for-businesses,
 * /how-it-works, /discover, /showcase, /login, /join). Not used on
 * /dashboard (has its own header + logout) or /r/[slug] / storefronts
 * (business-branded, no Skhokho nav — see DESIGN.md).
 *
 * Sticky + backdrop-blur (was static, no visual weight at all — the single
 * biggest reason the page read as "unstyled" at first glance, since it's
 * the one element on screen at every scroll position). The register CTA is
 * new too: NAV_LINKS never had a /join entry, so the page's one conversion
 * action previously lived only in the bottom bar and mid-page CTAs, never
 * in the header a visitor sees first.
 */
export default function SiteHeader({ current }: { current: Page }) {
  const links = NAV_LINKS.filter((link) => link.page !== current);

  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        <span className={styles.mark} aria-hidden="true" />
        <span className="eyebrow" style={{ margin: 0 }}>
          Skhokho
        </span>
      </Link>
      <nav className={styles.nav} aria-label="Site">
        {links.map((link) => (
          <Link key={link.page} href={link.href} className={styles.link}>
            {link.label}
          </Link>
        ))}
        {current !== "join" && (
          <Link href="/join" className={styles.registerBtn}>
            Start free
          </Link>
        )}
      </nav>
    </header>
  );
}
