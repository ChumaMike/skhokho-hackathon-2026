import Link from "next/link";
import type { ReactNode } from "react";
import type { NavItem } from "@/modules/storefront-spec/pages";
import styles from "./ShopfrontFooter.module.css";
import { whatsappLink } from "@/lib/utils";

/**
 * Real business fields only (name/whatsapp/phone/email/location), plus the
 * owner's own footer pages (policies, anything they put there — see
 * storefront-spec/pages.ts). The prototype's newsletter signup band is
 * replaced with a WhatsApp CTA — there is no email-capture backend
 * anywhere in Skhokho, so a form here would silently go nowhere.
 *
 * `legal` is a slot for the merchant-identity / ECTA block that Tab 2
 * owns: whatever is passed renders between the links and the copyright
 * line. This component writes no legal text of its own.
 */
export default function ShopfrontFooter({
  business,
  links = [],
  legal,
}: {
  business: {
    name: string;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    address: string | null;
    suburb: string | null;
    city: string | null;
  };
  /** Footer pages, already filtered to what can open (site.ts). */
  links?: NavItem[];
  /** Slot for the legal / business-details block (Tab 2). */
  legal?: ReactNode;
}) {
  const locationLine = [business.address, business.suburb, business.city].filter(Boolean).join(", ");
  const waLink = whatsappLink(business.whatsapp);

  return (
    <>
      {waLink && (
        <section className={styles.ctaBand}>
          <div className={styles.ctaInner}>
            <div>
              <p className={styles.ctaEyebrow}>Stay connected</p>
              <h2 className={styles.ctaHeading}>Have a question for {business.name}?</h2>
            </div>
            <a className={styles.ctaButton} href={waLink}>
              Chat on WhatsApp
            </a>
          </div>
        </section>
      )}
      <footer className={styles.footer}>
        <div className={styles.inner}>
          <div className={styles.grid} data-columns={links.length > 0 ? "4" : "3"}>
            <div>
              <p className={styles.brand}>{business.name}</p>
              <p className={styles.tagline}>A connected digital shopfront, powered by Skhokho.</p>
            </div>
            <div>
              <h3>Connect</h3>
              {waLink && <a href={waLink}>WhatsApp</a>}
              {business.phone && <a href={`tel:${business.phone}`}>{business.phone}</a>}
              {business.email && <a href={`mailto:${business.email}`}>{business.email}</a>}
            </div>
            <div>
              <h3>Visit</h3>
              {locationLine && <span>{locationLine}</span>}
            </div>
            {links.length > 0 && (
              <nav aria-label="More pages">
                <h3>More</h3>
                {links.map((item) => (
                  <Link key={item.id} href={item.href}>
                    {item.label}
                  </Link>
                ))}
              </nav>
            )}
          </div>
          {legal && <div className={styles.legal}>{legal}</div>}
          <div className={styles.bottom}>
            <span>
              © {new Date().getFullYear()} {business.name}. All rights reserved.
            </span>
            <span>Powered by Skhokho</span>
          </div>
        </div>
      </footer>
    </>
  );
}
