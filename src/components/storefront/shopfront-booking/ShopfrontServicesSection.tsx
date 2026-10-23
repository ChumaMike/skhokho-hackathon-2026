import { Clock } from "lucide-react";
import { formatZAR } from "@/lib/utils";
import type { BusinessCatalog } from "@/modules/catalog/catalog.service";
import ConsentFields from "@/components/storefront/ConsentFields";
import SlotPicker from "@/components/storefront/SlotPicker";
import shared from "@/components/storefront/shopfront/Shopfront.module.css";
import styles from "./ShopfrontServicesSection.module.css";
import HoneypotField from "@/components/HoneypotField";

/**
 * Visual-only Shopfront restyling of ServicesSection.tsx — the booking
 * form itself (hidden fields, SlotPicker, phone input, ConsentFields,
 * POST to /api/store/book) is copied over exactly, unchanged, never
 * reimplemented. Same reasoning Phase 1 used to restyle BasketView/
 * CheckoutView without touching their logic.
 */
export default function ShopfrontServicesSection({
  businessId,
  services,
  returnTo,
  serviceCatalogLabel,
}: {
  businessId: string;
  services: BusinessCatalog["services"];
  returnTo: string;
  serviceCatalogLabel: string;
}) {
  if (services.length === 0) return null;

  return (
    <section className={shared.section} id="services" data-sf-section="CATALOGUE">
      <div className={shared.container}>
        <div className={shared.sectionHead}>
          <div>
            <p className={shared.eyebrow}>{serviceCatalogLabel}</p>
            <h2 className={styles.heading}>Book an appointment.</h2>
          </div>
        </div>
        <ul className={styles.serviceList}>
          {services.map((service) => (
            <li key={service.id} className={`${shared.card} ${styles.serviceCard}`}>
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
              <form method="post" action="/api/store/book" className={styles.bookingForm}>
                <HoneypotField />
                <input type="hidden" name="businessId" value={businessId} />
                <input type="hidden" name="serviceId" value={service.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <SlotPicker businessId={businessId} serviceId={service.id} name="startTime" />
                <input
                  className="input"
                  type="tel"
                  name="phone"
                  placeholder="082 123 4567"
                  required
                  aria-label={`Your WhatsApp number, to book ${service.name}`}
                />
                <ConsentFields idPrefix={`book-${service.id}`} />
                <button type="submit" className={`${shared.btn} ${shared.btnPrimary} ${styles.bookButton}`}>
                  Book
                </button>
              </form>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
