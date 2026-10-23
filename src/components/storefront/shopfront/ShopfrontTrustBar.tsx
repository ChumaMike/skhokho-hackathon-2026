import type { TrustBarFact } from "@/modules/tenant/storefront-content";
import shared from "./Shopfront.module.css";
import styles from "./ShopfrontTrustBar.module.css";

/** Wraps the existing, real computeTrustBarFacts() — never decorative/fabricated facts. `layout` TILES = separate tiles instead of one divided row (layouts.ts). */
export default function ShopfrontTrustBar({ facts, layout = "BAR" }: { facts: TrustBarFact[]; layout?: "BAR" | "TILES" }) {
  if (facts.length === 0) return null;

  return (
    <section className={styles.trust} data-layout={layout}>
      <div className={`${shared.container} ${styles.grid}`}>
        {facts.map((fact) => (
          <div key={fact.label} className={styles.item}>
            {fact.label}
          </div>
        ))}
      </div>
    </section>
  );
}
