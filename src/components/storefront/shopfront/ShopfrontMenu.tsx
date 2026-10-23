import Link from "next/link";
import { formatZAR } from "@/lib/utils";
import { groupByCategory } from "@/lib/storefront/catalog-groups";
import { PRODUCT_SORT_LABELS, PRODUCT_SORTS, sortProducts, type ProductSort } from "@/lib/storefront/catalog-sort";
import type { StorefrontProduct } from "@/components/storefront/ProductsSection";
import ShopfrontAddControl from "./ShopfrontAddControl";
import ShareButton from "@/components/storefront/share/ShareButton";
import ShopfrontStickyBar from "./ShopfrontStickyBar";
import shared from "./Shopfront.module.css";
import styles from "./ShopfrontMenu.module.css";

/** Enough for a real menu; a very long catalogue continues on the Shop page. */
const MENU_LIMIT = 60;

/**
 * The FOOD_MENU template's catalogue: the whole menu as a scannable,
 * categorised list — name, a short description, price, and the same Add
 * control the product cards use. Photos are optional small thumbnails; the
 * menu reads fully without them. Nothing renders for an empty menu (the home
 * page shows its own "still setting up" message).
 */
export default function ShopfrontMenu({
  products,
  businessId,
  basePath,
  ordersEnabled,
  catalogLabel,
  grouped = true,
  sort = "default",
  sortHref,
}: {
  products: StorefrontProduct[];
  businessId: string;
  basePath: string;
  ordersEnabled: boolean;
  catalogLabel: string;
  /** false = the LIST layout: one plain list, no category chips (layouts.ts). */
  grouped?: boolean;
  /** Customer's price sort (from ?sort=); applied inside each category group so the owner's grouping holds. */
  sort?: ProductSort;
  /** Where the sort links go (the page path); when absent no sort control renders (e.g. the Home excerpt). */
  sortHref?: string;
}) {
  if (products.length === 0) return null;

  const shown = products.slice(0, MENU_LIMIT);
  const groups = (grouped ? groupByCategory(shown) : [{ id: null, name: null, products: shown }]).map((g) => ({ ...g, products: sortProducts(g.products, sort) }));
  const priceById = new Map(products.map((p) => [p.id, Number(p.price)]));

  return (
    <>
      <section className={shared.section} id="menu" aria-labelledby="menu-heading" data-sf-section="CATALOGUE">
        <div className={shared.container}>
          <div className={shared.sectionHead}>
            <div>
              <p className={shared.eyebrow}>{catalogLabel}</p>
              <h2 id="menu-heading" className={styles.heading}>
                Our {catalogLabel.toLowerCase()}
              </h2>
            </div>
          </div>

          {groups.length > 1 && (
            <nav className={styles.chips} aria-label={`${catalogLabel} sections`}>
              {groups.map((group, i) => (
                <a key={group.id ?? "more"} href={`#menu-group-${i}`} className={styles.chip}>
                  {group.name ?? "More"}
                </a>
              ))}
            </nav>
          )}
          {sortHref && shown.length > 1 && (
            <nav className={styles.chips} aria-label="Sort by price">
              {PRODUCT_SORTS.map((s) => (
                <Link key={s} href={s === "default" ? sortHref : `${sortHref}?sort=${s}`} className={styles.chip} aria-current={s === sort ? "true" : undefined} rel="nofollow">
                  {PRODUCT_SORT_LABELS[s]}
                </Link>
              ))}
            </nav>
          )}

          <div className={styles.columns}>
            {groups.map((group, i) => (
              <section key={group.id ?? "more"} id={`menu-group-${i}`} className={styles.group} aria-label={group.name ?? catalogLabel}>
                {groups.length > 1 && <h3 className={styles.groupName}>{group.name ?? "More"}</h3>}
                <ul className={styles.list}>
                  {group.products.map((product) => (
                    <li key={product.id} className={styles.row}>
                      <div className={styles.main}>
                        {product.imageUrl && (
                          // Business-supplied photo, not a bundled asset.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={product.imageUrl} alt={product.name} className={styles.thumb} loading="lazy" />
                        )}
                        <div className={styles.info}>
                          <Link href={`${basePath}/product/${product.id}`} className={styles.name}>
                            {product.name}
                          </Link>
                          {product.description && <p className={styles.desc}>{product.description}</p>}
                        </div>
                      </div>
                      <div className={styles.side}>
                        <span className={styles.priceRow}>
                          <span className={styles.price}>{formatZAR(product.price)}</span>
                          {/* Social products (Tab 7): share this dish. */}
                          <ShareButton product={product} />
                        </span>
                        {ordersEnabled && <ShopfrontAddControl product={product} businessId={businessId} basePath={basePath} />}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {products.length > MENU_LIMIT && (
            <p className={styles.more}>
              <Link href={`${basePath}/shop`}>See the full {catalogLabel.toLowerCase()} →</Link>
            </p>
          )}
        </div>
      </section>
      {ordersEnabled && <ShopfrontStickyBar businessId={businessId} basePath={basePath} priceById={priceById} />}
    </>
  );
}
