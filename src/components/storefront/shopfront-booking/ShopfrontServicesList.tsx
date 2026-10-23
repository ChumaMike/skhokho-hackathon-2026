import Link from "next/link";
import { Clock } from "lucide-react";
import type { BusinessCatalog } from "@/modules/catalog/catalog.service";
import { formatZAR } from "@/lib/utils";
import shared from "@/components/storefront/shopfront/Shopfront.module.css";
import styles from "./ShopfrontServicesList.module.css";

const LIST_LIMIT = 30;

/**
 * The LIST layout for a services catalogue (layouts.ts): a compact price
 * list — name, duration, price — with one button to the Services page where
 * each service has its full booking or enquiry card. For businesses whose
 * list is long enough that the home page should read like a menu board.
 */
export default function ShopfrontServicesList({
  services,
  basePath,
  serviceCatalogLabel,
  actionLabel,
}: {
  services: BusinessCatalog["services"];
  basePath: string;
  serviceCatalogLabel: string;
  /** "Book" or "Ask" — whichever the Services page actually offers. */
  actionLabel: string;
}) {
  if (services.length === 0) return null;
  const shown = services.slice(0, LIST_LIMIT);

  return (
    <section className={shared.section} id="services" aria-labelledby="services-list-heading" data-sf-section="CATALOGUE">
      <div className={shared.container}>
        <div className={shared.sectionHead}>
          <div>
            <p className={shared.eyebrow}>{serviceCatalogLabel}</p>
            <h2 id="services-list-heading" className={styles.heading}>
              Prices at a glance.
            </h2>
          </div>
          <Link href={`${basePath}/services`} className={`${shared.btn} ${shared.btnPrimary}`} data-sf-event="CTA_CLICK">
            {actionLabel}
          </Link>
        </div>
        <ul className={styles.list}>
          {shown.map((service) => {
            const price = Number(service.price);
            return (
              <li key={service.id} className={styles.row}>
                <div className={styles.info}>
                  <Link href={`${basePath}/services`} className={styles.name}>
                    {service.name}
                  </Link>
                  {service.duration && (
                    <span className={styles.duration}>
                      <Clock size={13} aria-hidden="true" /> {service.duration} min
                    </span>
                  )}
                </div>
                <span className={styles.price}>{price > 0 ? formatZAR(price) : "On request"}</span>
              </li>
            );
          })}
        </ul>
        {services.length > LIST_LIMIT && (
          <p className={styles.more}>
            <Link href={`${basePath}/services`}>See all {serviceCatalogLabel.toLowerCase()} →</Link>
          </p>
        )}
      </div>
    </section>
  );
}
