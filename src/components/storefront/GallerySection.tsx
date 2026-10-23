import viewStyles from "@/components/StorefrontView.module.css";
import styles from "./GallerySection.module.css";

export interface GalleryProduct {
  name: string;
  imageUrl: string | null;
  images: string[];
}

// Generous but bounded — a gallery page is meant to be browsed, not to load
// every photo a large catalogue has ever accumulated in one request.
const MAX_IMAGES = 40;

/** Product photos only (Product.images, plus imageUrl as a fallback per product) — no new table, matches the plan's own reuse-existing-data choice. */
export default function GallerySection({ products }: { products: GalleryProduct[] }) {
  const images = products
    .flatMap((product) => {
      const urls = product.images.length > 0 ? product.images : product.imageUrl ? [product.imageUrl] : [];
      return urls.map((src) => ({ src, alt: product.name }));
    })
    .slice(0, MAX_IMAGES);

  if (images.length === 0) return null;

  return (
    <section className={viewStyles.section}>
      <h2 className={viewStyles.sectionTitle}>Gallery</h2>
      <div className={styles.grid}>
        {images.map((image, i) => (
          // Business-supplied product photos, not bundled/optimised assets — plain img, same choice StorefrontView already makes for the logo.
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${image.src}-${i}`} src={image.src} alt={image.alt} className={styles.tile} loading="lazy" />
        ))}
      </div>
    </section>
  );
}
