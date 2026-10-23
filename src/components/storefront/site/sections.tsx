import { formatOperatingHours } from "@/modules/tenant/storefront-hours";
import { appOrigin } from "@/modules/tenant/storefront-url";
import type { PageSection } from "@/modules/storefront-spec/pages";
import type { GalleryLayout } from "@/modules/storefront-spec/layouts";
import shared from "@/components/storefront/shopfront/Shopfront.module.css";
import styles from "./SitePage.module.css";

/**
 * Renderers for the owner-page section types that have no Shopfront
 * component of their own yet. Every one renders nothing when it has
 * nothing real to show — the same "omit, don't fabricate" rule the home
 * sections follow.
 */

function Section({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <section className={styles.pageSection} id={id}>
      <div className={shared.container}>{children}</div>
    </section>
  );
}

/** Plain owner text: blank lines make paragraphs. No markup is ever interpreted. */
export function TextSection({ section }: { section: Extract<PageSection, { type: "TEXT" }> }) {
  const paragraphs = section.body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) return null;
  return (
    <Section>
      {section.heading && <h2 className={styles.subheading}>{section.heading}</h2>}
      <div className={styles.prose}>
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
    </Section>
  );
}

export function FaqSection({ section }: { section: Extract<PageSection, { type: "FAQ" }> }) {
  return (
    <Section>
      <h2 className={styles.subheading}>Questions people ask</h2>
      <ul className={styles.faq}>
        {section.items.map((item, i) => (
          <li key={i}>
            <details className={styles.faqItem}>
              <summary>{item.q}</summary>
              <div className={styles.faqAnswer}>{item.a}</div>
            </details>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Opening hours from Business.operatingHours — nothing until the owner has set them. */
export function HoursBlock({ operatingHours }: { operatingHours: unknown }) {
  const hours = formatOperatingHours(operatingHours);
  if (hours.length === 0) return null;
  return (
    <Section id="hours">
      <h2 className={styles.subheading}>Opening hours</h2>
      <ul className={styles.hoursList}>
        {hours.map((day) => (
          <li key={day.day} className={styles.hoursRow}>
            <span className={styles.hoursDay}>{day.day}</span>
            <span>{day.label}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export interface GalleryImage {
  src: string;
  alt: string;
}

const MAX_GALLERY_IMAGES = 40;

/** Catalogue photos (products' image lists, services' photos) — never a stock image. */
export function galleryImages(catalog: {
  products: { name: string; imageUrl: string | null; images: string[] }[];
  services: { name: string; imageUrl: string | null }[];
}): GalleryImage[] {
  const fromProducts = catalog.products.flatMap((p) => {
    const urls = p.images.length > 0 ? p.images : p.imageUrl ? [p.imageUrl] : [];
    return urls.map((src) => ({ src, alt: p.name }));
  });
  const fromServices = catalog.services.filter((s) => s.imageUrl).map((s) => ({ src: s.imageUrl as string, alt: s.name }));
  return [...fromProducts, ...fromServices].slice(0, MAX_GALLERY_IMAGES);
}

/** GRID, STRIP (wide, stacked) or PAIRS (two-up with Before / After captions — the owner's photos in the owner's order). */
export function GalleryGrid({ images, layout = "GRID" }: { images: GalleryImage[]; layout?: GalleryLayout }) {
  if (images.length === 0) return null;
  return (
    <Section id="gallery">
      <div className={styles.galleryGrid} data-layout={layout}>
        {images.map((image, i) => (
          <figure key={`${image.src}-${i}`} className={styles.galleryFigure}>
            {/* Business-supplied photos, not bundled assets. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image.src} alt={image.alt} className={styles.galleryTile} loading="lazy" />
            {layout === "PAIRS" && <figcaption className={styles.galleryCaption}>{i % 2 === 0 ? "Before" : "After"}</figcaption>}
          </figure>
        ))}
      </div>
    </Section>
  );
}

export interface ReviewRow {
  id: string;
  rating: number;
  comment: string | null;
  membership: { displayName: string | null; shortCode: string };
}

/** Every published review, newest first — the whole picture, not the one best quote the home page shows. */
export function ReviewsList({ reviews, rating }: { reviews: ReviewRow[]; rating?: { average: number; count: number } }) {
  if (reviews.length === 0) return null;
  return (
    <Section id="reviews">
      {rating && rating.count > 0 && (
        <p className={styles.reviewSummary}>
          Rated {rating.average.toFixed(1)} out of 5 from {rating.count} {rating.count === 1 ? "review" : "reviews"}.
        </p>
      )}
      <ul className={styles.reviewList}>
        {reviews.map((review) => (
          <li key={review.id} className={styles.reviewCard}>
            <div className={styles.reviewTop}>
              <span className={styles.reviewStars} aria-label={`${review.rating} out of 5`}>
                {"★".repeat(review.rating)}
                {"☆".repeat(Math.max(0, 5 - review.rating))}
              </span>
              <span className={styles.reviewAuthor}>{review.membership.displayName || `Customer ${review.membership.shortCode}`}</span>
            </div>
            {review.comment && <p className={styles.reviewComment}>{review.comment}</p>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function HighlightsBlock({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Section>
      <ul className={styles.highlights}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * A pointer to the platform's privacy notice (Tab 2 writes that notice; this
 * only links to it). Absolute, because on a merchant's own domain a bare
 * /privacy would resolve inside their storefront.
 */
export function PrivacyPointer({ businessName }: { businessName: string }) {
  return (
    <Section>
      <div className={styles.pointer}>
        <p>
          {businessName} runs this website on Skhokho. The details you share here — your name, phone number and what you order or ask for
          — are handled under Skhokho&apos;s privacy notice, and {businessName} only uses them to serve you.
        </p>
        <p>
          <a href={`${appOrigin()}/privacy`}>Read Skhokho&apos;s privacy notice →</a>
        </p>
      </div>
    </Section>
  );
}
