import { formatOperatingHours } from "@/modules/tenant/storefront-hours";
import viewStyles from "@/components/StorefrontView.module.css";
import styles from "./HoursSection.module.css";

/** Renders nothing until an owner has actually set operating hours — never claims hours the business hasn't configured (same rule storefront-recommendations.ts already applies to reviews). */
export default function HoursSection({ operatingHours }: { operatingHours: unknown }) {
  const hours = formatOperatingHours(operatingHours);
  if (hours.length === 0) return null;
  return (
    <section className={viewStyles.section}>
      <h2 className={viewStyles.sectionTitle}>Hours</h2>
      <ul className={styles.list}>
        {hours.map((day) => (
          <li key={day.day} className={styles.row}>
            <span className={styles.day}>{day.day}</span>
            <span>{day.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
