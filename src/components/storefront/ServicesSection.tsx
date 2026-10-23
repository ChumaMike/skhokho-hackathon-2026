import { Clock } from "lucide-react";
import { formatZAR } from "@/lib/utils";
import type { BusinessCatalog } from "@/modules/catalog/catalog.service";
import ConsentFields from "./ConsentFields";
import SlotPicker from "./SlotPicker";
import viewStyles from "@/components/StorefrontView.module.css";
import styles from "./ServicesSection.module.css";
import HoneypotField from "@/components/HoneypotField";

/**
 * Duration-and-booking-forward treatment for services — the counterpart to
 * ProductsSection's photo-forward product grid (Phase 6). Deliberately
 * NOT a grid: a service card carries more to scan (description, duration,
 * a date/time picker, a phone field) than a product card does, so it stays
 * the single-column list the storefront's mobile-first rule already
 * expects, distinguished instead by a duration badge, a left accent bar
 * and a full-width Book action rather than by column count.
 *
 * Extracted out of StorefrontView.tsx, which rendered this inline before —
 * same booking form/fields/behaviour, unchanged; only the presentation and
 * file location moved.
 */
export default function ServicesSection({
  businessId,
  services,
  returnTo,
  bookEmphasis,
}: {
  businessId: string;
  services: BusinessCatalog["services"];
  returnTo: string;
  bookEmphasis: "primary" | "secondary";
}) {
  if (services.length === 0) return null;

  return (
    <section className={viewStyles.section} id="storefront-services">
      <h2 className={viewStyles.sectionTitle}>Services</h2>
      <ul className={styles.serviceList}>
        {services.map((service) => (
          <li key={service.id} className={`card ${styles.serviceCard}`}>
            <div className={styles.serviceMain}>
              {service.imageUrl && (
                // Business-supplied photo, not a bundled asset — plain img.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={service.imageUrl} alt={service.name} className={styles.serviceImage} />
              )}
              <div className={styles.serviceInfo}>
                <span className={styles.serviceName}>{service.name}</span>
                {service.description && <span className={styles.serviceDesc}>{service.description}</span>}
                <div className={styles.serviceMeta}>
                  <span className={styles.servicePrice}>{formatZAR(service.price)}</span>
                  {service.duration && (
                    <span className={styles.durationBadge}>
                      <Clock size={13} /> {service.duration} min
                    </span>
                  )}
                </div>
              </div>
            </div>
            <form method="post" action="/api/store/book" className={viewStyles.orderForm}>
              <HoneypotField />
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="serviceId" value={service.id} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <SlotPicker businessId={businessId} serviceId={service.id} name="startTime" />
              <input
                className={`input ${viewStyles.phoneInput}`}
                type="tel"
                name="phone"
                placeholder="082 123 4567"
                required
                aria-label={`Your WhatsApp number, to book ${service.name}`}
              />
              <ConsentFields idPrefix={`book-${service.id}`} />
              <button
                type="submit"
                className={`btn ${bookEmphasis === "primary" ? viewStyles.storeActionPrimary : viewStyles.storeActionSecondary} ${styles.bookButton}`}
              >
                Book
              </button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
