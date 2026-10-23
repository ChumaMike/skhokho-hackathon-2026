import viewStyles from "@/components/StorefrontView.module.css";
import styles from "./BenefitsSection.module.css";

/** Renders StorefrontContent.highlights.items as a grid — real, owner/AI-written differentiators only (see storefront-content.ts). Structure inspired by bantcolon's benefits grid, redesigned on skhokho's own tokens rather than copied. */
export default function BenefitsSection({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className={viewStyles.section}>
      <h2 className={viewStyles.sectionTitle}>Why choose us</h2>
      <ul className={styles.grid}>
        {items.map((item) => (
          <li key={item} className={`card ${styles.tile}`}>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
