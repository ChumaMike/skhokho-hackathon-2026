import { Clock } from "lucide-react";
import { formatZAR, whatsappLink } from "@/lib/utils";
import type { BusinessCatalog } from "@/modules/catalog/catalog.service";
import shared from "@/components/storefront/shopfront/Shopfront.module.css";
import styles from "./ShopfrontEnquiryServices.module.css";

/**
 * The SERVICES_LEAD template's catalogue: for businesses that quote or
 * arrange work by chat or phone rather than taking online bookings. Every
 * service card ends in one enquiry button — WhatsApp (with a prefilled
 * message naming the service) when the business has it, otherwise a call.
 * id="services" so every "#services" link (nav, hero) lands here.
 */
export default function ShopfrontEnquiryServices({
  services,
  business,
  basePath,
  serviceCatalogLabel,
}: {
  services: BusinessCatalog["services"];
  business: { name: string; whatsapp: string | null; phone: string | null };
  basePath: string;
  serviceCatalogLabel: string;
}) {
  if (services.length === 0) return null;

  function enquiry(serviceName: string): { href: string; label: string } {
    const wa = whatsappLink(business.whatsapp, `Hi ${business.name}, I'd like to ask about ${serviceName}.`);
    if (wa) return { href: wa, label: "Ask on WhatsApp" };
    if (business.phone) return { href: `tel:${business.phone}`, label: "Call to ask" };
    return { href: `${basePath}/contact`, label: "Get in touch" };
  }

  return (
    <section className={shared.section} id="services" aria-labelledby="services-heading" data-sf-section="CATALOGUE">
      <div className={shared.container}>
        <div className={shared.sectionHead}>
          <div>
            <p className={shared.eyebrow}>{serviceCatalogLabel}</p>
            <h2 id="services-heading" className={styles.heading}>
              What we do.
            </h2>
          </div>
        </div>
        <ul className={styles.grid}>
          {services.map((service) => {
            const action = enquiry(service.name);
            const price = Number(service.price);
            return (
              <li key={service.id} className={`${shared.card} ${styles.card}`}>
                {service.imageUrl && (
                  // Business-supplied photo, not a bundled asset.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={service.imageUrl} alt={service.name} className={styles.image} loading="lazy" />
                )}
                <div className={styles.body}>
                  <h3 className={styles.name}>{service.name}</h3>
                  {service.description && <p className={styles.desc}>{service.description}</p>}
                  <div className={styles.meta}>
                    <span className={styles.price}>{price > 0 ? formatZAR(price) : "Price on request"}</span>
                    {service.duration && (
                      <span className={styles.duration}>
                        <Clock size={13} aria-hidden="true" /> {service.duration} min
                      </span>
                    )}
                  </div>
                  <a
                    href={action.href}
                    className={`${shared.btn} ${shared.btnPrimary} ${styles.ask}`}
                    aria-label={`${action.label} — ${service.name}`}
                    data-sf-event="ENQUIRY_CLICK"
                    data-sf-item={service.id}
                  >
                    {action.label}
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
