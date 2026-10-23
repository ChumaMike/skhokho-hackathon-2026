import shared from "./Shopfront.module.css";
import styles from "./ShopfrontContact.module.css";
import { whatsappLink } from "@/lib/utils";

/**
 * Real contact info only — no "send us a message" form. There's no real
 * messaging backend behind one anywhere in Skhokho (same reasoning as the
 * footer's dropped newsletter form), so this stays an honest recap of the
 * business's real phone/WhatsApp/location plus a WhatsApp CTA, not a form
 * that would silently go nowhere.
 */
export default function ShopfrontContact({
  business,
}: {
  business: {
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    address: string | null;
    suburb: string | null;
    city: string | null;
  };
}) {
  const locationLine = [business.address, business.suburb, business.city].filter(Boolean).join(", ");
  const waLink = whatsappLink(business.whatsapp);
  const hasAnything = !!(business.phone || business.whatsapp || business.email || locationLine);

  if (!hasAnything) return null;

  return (
    <section className={shared.section} id="contact">
      <div className={shared.container}>
        <p className={shared.eyebrow}>Contact</p>
        <h2 className={styles.heading}>We&rsquo;re close by.</h2>
        <div className={styles.list}>
          {locationLine && (
            <div className={styles.item}>
              <small>Location</small>
              {locationLine}
            </div>
          )}
          {business.phone && (
            <div className={styles.item}>
              <small>Phone</small>
              <a href={`tel:${business.phone}`}>{business.phone}</a>
            </div>
          )}
          {business.email && (
            <div className={styles.item}>
              <small>Email</small>
              <a href={`mailto:${business.email}`}>{business.email}</a>
            </div>
          )}
          {waLink && (
            <div className={styles.item}>
              <small>WhatsApp</small>
              <a href={waLink} className={styles.waLink}>
                Chat with us →
              </a>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
