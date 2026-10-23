import Link from "next/link";
import { STOREFRONT_PAGE_LABELS, type StorefrontPageId } from "@/modules/tenant/storefront-templates";
import styles from "./StorefrontNav.module.css";

const PAGE_ORDER: StorefrontPageId[] = ["HOME", "ABOUT", "GALLERY", "CONTACT"];

/**
 * Links between a storefront's own pages — confirmed via direct code check
 * that nothing filled this role before: a customer landing on /about had no
 * way to reach /gallery, /contact, or back to Home except editing the URL.
 *
 * `pages` is the active template's own page list (resolveStorefrontTemplate
 * — the same source of truth every route already 404s against), so this can
 * never link to a page that doesn't exist for this business. Renders
 * nothing for a single-page (HOME-only, e.g. CLASSIC) business — a nav with
 * one link to the page you're already on isn't navigation.
 *
 * `basePath` is `/store/${slug}` for path-based routing or `''` for
 * subdomain routing (the tenant subdomain's own root already IS the
 * storefront, so its links are bare `/about` etc.) — same dual-routing
 * split every other storefront route already carries.
 */
export default function StorefrontNav({ basePath, pages }: { basePath: string; pages: StorefrontPageId[] }) {
  if (pages.length <= 1) return null;

  const links = PAGE_ORDER.filter((id) => pages.includes(id));

  return (
    <nav className={styles.nav} aria-label="Storefront pages">
      {links.map((id) => (
        <Link key={id} href={id === "HOME" ? basePath || "/" : `${basePath}/${id.toLowerCase()}`} className={styles.link}>
          {STOREFRONT_PAGE_LABELS[id]}
        </Link>
      ))}
    </nav>
  );
}
