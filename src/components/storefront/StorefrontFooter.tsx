import styles from "./StorefrontFooter.module.css";
import EctaInformation from "./EctaInformation";
import type { EctaSourceBusiness } from "@/modules/tenant/legal-information";

/**
 * New — confirmed via research that no footer exists anywhere on the real
 * tenant-facing storefront today (only the separate marketing site has
 * one). Structure (closing band with a contact recap + copyright) inspired
 * by bantcolon's site-footer.tsx, redesigned on skhokho's own tokens rather
 * than copied — real data only. Deliberately doesn't repeat the full weekly
 * hours list (HoursSection already owns that, in detail, elsewhere) — this
 * is a closing identity/contact recap, not a second hours table.
 *
 * Below the recap sits the ECTA s43 block (EctaInformation) — the legal
 * name, returns terms and complaints route every online seller must show.
 * The business row the callers already pass carries everything it needs.
 */
export default function StorefrontFooter({ business }: { business: EctaSourceBusiness }) {
  const locationLine = [business.address, business.suburb, business.city].filter(Boolean).join(", ");
  const hasAnything = !!(business.phone || business.whatsapp || locationLine);

  return (
    <footer className={styles.footer}>
      <p className={styles.name}>{business.name}</p>
      {hasAnything && (
        <ul className={styles.list}>
          {locationLine && <li>{locationLine}</li>}
          {business.phone && <li>{business.phone}</li>}
          {business.whatsapp && <li>WhatsApp: {business.whatsapp}</li>}
        </ul>
      )}
      <p className={styles.copyright}>
        © {new Date().getFullYear()} {business.name}
      </p>
      <EctaInformation business={business} tone="light" />
    </footer>
  );
}
