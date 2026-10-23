import Link from "next/link";
import type { BusinessCatalog } from "@/modules/catalog/catalog.service";
import type { StorefrontProcessStep } from "@/modules/tenant/storefront-content";
import type { GalleryLayout } from "@/modules/storefront-spec/layouts";
import { formatZAR, whatsappLink } from "@/lib/utils";
import shared from "@/components/storefront/shopfront/Shopfront.module.css";
import styles from "./ShopfrontPortfolio.module.css";

const MAX_GALLERY = 12;

/**
 * The SERVICE_PORTFOLIO composition's catalogue (PORTFOLIO layout): services
 * as photo-first cards, a work gallery built from those same photos (grid,
 * or before-and-after pairs when the owner chose that layout — their photos,
 * their order), the owner's own "how it works" steps, and one request
 * button as the way out. Nothing here is invented: no step, photo or
 * testimonial appears unless the business supplied it.
 */
export default function ShopfrontPortfolio({
  services,
  business,
  basePath,
  serviceCatalogLabel,
  process,
  enquiry,
  galleryLayout = "GRID",
}: {
  services: BusinessCatalog["services"];
  business: { name: string; whatsapp: string | null; phone: string | null };
  basePath: string;
  serviceCatalogLabel: string;
  process: StorefrontProcessStep[];
  /** The storefront's primary request (page + words), or null to fall back to WhatsApp / call. */
  enquiry: { href: string; label: string } | null;
  galleryLayout?: GalleryLayout;
}) {
  if (services.length === 0) return null;
  const photos = services.filter((s) => s.imageUrl).slice(0, MAX_GALLERY);
  const wa = whatsappLink(business.whatsapp);
  const fallback = wa ? { href: wa, label: "Ask on WhatsApp" } : business.phone ? { href: `tel:${business.phone}`, label: "Call to ask" } : { href: `${basePath}/contact`, label: "Get in touch" };
  const ask = enquiry ?? fallback;
  const askFor = (name: string) => (enquiry ? `${enquiry.href}?service=${encodeURIComponent(name)}` : whatsappLink(business.whatsapp, `Hi ${business.name}, I'd like to ask about ${name}.`) ?? fallback.href);

  return (
    <section className={shared.section} id="services" aria-labelledby="portfolio-heading" data-sf-section="CATALOGUE">
      <div className={shared.container}>
        <div className={shared.sectionHead}>
          <div>
            <p className={shared.eyebrow}>{serviceCatalogLabel}</p>
            <h2 id="portfolio-heading" className={styles.heading}>
              Our work.
            </h2>
          </div>
          <a href={ask.href} className={`${shared.btn} ${shared.btnPrimary}`} data-sf-event="CTA_CLICK">
            {ask.label}
          </a>
        </div>

        <ul className={styles.cards}>
          {services.map((service) => {
            const price = Number(service.price);
            return (
              <li key={service.id} className={`${shared.card} ${styles.card}`}>
                {service.imageUrl ? (
                  // Business-supplied photo, not a bundled asset.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={service.imageUrl} alt={service.name} className={styles.cardImage} loading="lazy" />
                ) : (
                  <div className={styles.cardFallback} aria-hidden="true">
                    {service.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className={styles.cardBody}>
                  <h3 className={styles.cardName}>{service.name}</h3>
                  {service.description && <p className={styles.cardDesc}>{service.description}</p>}
                  <div className={styles.cardMeta}>
                    <span className={styles.price}>{price > 0 ? `From ${formatZAR(price)}` : "Price on request"}</span>
                    <a href={askFor(service.name)} className={styles.askLink} data-sf-event="ENQUIRY_CLICK" data-sf-item={service.id}>
                      Ask about this →
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {photos.length > 0 && (
          <div className={styles.gallery} data-layout={galleryLayout} aria-label="Photos of our work">
            {photos.map((service, i) => (
              <figure key={service.id} className={styles.figure}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={service.imageUrl as string} alt={service.name} className={styles.photo} loading="lazy" />
                {galleryLayout === "PAIRS" && <figcaption className={styles.caption}>{i % 2 === 0 ? "Before" : "After"}</figcaption>}
              </figure>
            ))}
          </div>
        )}

        {process.length > 0 && (
          <ol className={styles.steps} aria-label="How it works">
            {process.map((step, i) => (
              <li key={i} className={styles.step}>
                <span className={styles.stepNumber}>{i + 1}</span>
                <div>
                  <strong className={styles.stepTitle}>{step.title}</strong>
                  <p className={styles.stepBody}>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        )}

        <div className={styles.closing}>
          <Link href={ask.href} className={`${shared.btn} ${shared.btnPrimary} ${styles.closingBtn}`} data-sf-event="CTA_CLICK">
            {ask.label}
          </Link>
        </div>
      </div>
    </section>
  );
}
