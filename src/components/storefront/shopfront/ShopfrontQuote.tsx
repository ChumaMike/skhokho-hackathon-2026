import styles from "./ShopfrontQuote.module.css";

export interface ShopfrontReview {
  id: string;
  rating: number;
  comment: string | null;
  membership: { displayName: string | null; shortCode: string };
}

/**
 * A real customer quote, never a fabricated testimonial — picks the
 * highest-rated recent review that actually has a comment. Renders nothing
 * if the business has none yet (an honest "no reviews" state, same
 * discipline as the rest of this codebase's storefront content).
 */
export default function ShopfrontQuote({ reviews }: { reviews: ShopfrontReview[] }) {
  const best = [...reviews].filter((r) => r.comment?.trim()).sort((a, b) => b.rating - a.rating)[0];
  if (!best) return null;

  const author = best.membership.displayName || `Customer ${best.membership.shortCode}`;

  return (
    <section className={styles.quote}>
      <p className={styles.text}>&ldquo;{best.comment}&rdquo;</p>
      <small className={styles.author}>
        — {author}, {best.rating}/5
      </small>
    </section>
  );
}
