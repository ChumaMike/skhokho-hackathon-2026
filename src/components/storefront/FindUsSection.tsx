import viewStyles from "@/components/StorefrontView.module.css";
import HoursSection from "./HoursSection";

export interface FindUsBusiness {
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  suburb: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  operatingHours: unknown;
}

/**
 * Plain "Get directions" link, no maps SDK — coordinates first (exact pin),
 * falling back to the free-text address when a business hasn't set
 * latitude/longitude. Never rendered at all when neither is available.
 */
function directionsHref(business: FindUsBusiness): string | null {
  if (business.latitude != null && business.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${business.latitude},${business.longitude}`;
  }
  const addressParts = [business.address, business.suburb, business.city].filter(Boolean);
  if (addressParts.length === 0) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressParts.join(", "))}`;
}

/**
 * The dedicated /contact page's content — distinct from StorefrontView's own
 * fixed-last contact block (that one stays untouched; this is for the new
 * standalone route only, once a template actually includes it).
 */
export default function FindUsSection({ business }: { business: FindUsBusiness }) {
  const directions = directionsHref(business);
  const hasContactInfo = !!(
    business.phone ||
    business.whatsapp ||
    business.address ||
    business.suburb ||
    business.city
  );

  return (
    <>
      {hasContactInfo && (
        <section className={viewStyles.section}>
          <h2 className={viewStyles.sectionTitle}>Contact</h2>
          <ul className={viewStyles.contactList}>
            {business.phone && <li>Phone: {business.phone}</li>}
            {business.whatsapp && <li>WhatsApp: {business.whatsapp}</li>}
            {(business.address || business.suburb || business.city) && (
              <li>{[business.address, business.suburb, business.city].filter(Boolean).join(", ")}</li>
            )}
            {directions && (
              <li>
                <a href={directions} target="_blank" rel="noopener noreferrer">
                  Get directions
                </a>
              </li>
            )}
          </ul>
        </section>
      )}
      <HoursSection operatingHours={business.operatingHours} />
    </>
  );
}
