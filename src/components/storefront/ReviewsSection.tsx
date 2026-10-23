import type { listPublishedReviews } from "@/modules/reviews/review.service";
import viewStyles from "@/components/StorefrontView.module.css";
import StarRow from "./StarRow";

export type StorefrontReview = Awaited<ReturnType<typeof listPublishedReviews>>[number];

/** Extracted from StorefrontView's inline REVIEWS renderer — same markup, now reusable elsewhere. */
export default function ReviewsSection({ reviews }: { reviews: StorefrontReview[] | undefined }) {
  if (!reviews || reviews.length === 0) return null;
  return (
    <section className={viewStyles.section}>
      <h2 className={viewStyles.sectionTitle}>Reviews</h2>
      <ul className={viewStyles.reviewsList}>
        {reviews.map((review) => (
          <li key={review.id} className={`card ${viewStyles.reviewCard}`}>
            <div className={viewStyles.reviewTop}>
              <StarRow value={review.rating} />
              <span className={viewStyles.reviewAuthor}>
                {review.membership.displayName || review.membership.shortCode}
              </span>
            </div>
            {review.comment && <p className={viewStyles.reviewComment}>{review.comment}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}
