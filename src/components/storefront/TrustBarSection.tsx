import type { TrustBarFact } from "@/modules/tenant/storefront-content";
import styles from "./TrustBarSection.module.css";

/**
 * Renders exactly the real, computed facts computeTrustBarFacts produced —
 * never free text, never a number. See storefront-content.ts's own doc
 * comment for why this section can't express a fabricated stat even if
 * someone wanted it to.
 */
export default function TrustBarSection({ facts }: { facts: TrustBarFact[] }) {
  if (facts.length === 0) return null;
  return (
    <ul className={styles.bar}>
      {facts.map((fact) => (
        <li key={fact.label} className={styles.item}>
          {fact.label}
        </li>
      ))}
    </ul>
  );
}
