"use client";

import Link from "next/link";
import ActionButton from "@/components/ActionButton";
import { publishBusinessAction } from "./actions";
import styles from "./dashboard.module.css";

type Status = "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED";

/**
 * Publication state, front and center on the dashboard home — not a modal,
 * not a separate settings page, so a business that's invisible to customers
 * is never a quiet surprise. See docs on Business.status in
 * tenant.service.ts for the full lifecycle this reflects.
 */
export default function PublicationStatus({
  status,
  missing,
  slug,
}: {
  status: Status;
  missing: string[];
  slug: string;
}) {
  if (status === "ACTIVE") {
    return (
      <div className={`${styles.pubStatus} ${styles.pubStatusLive}`}>
        <span className={styles.pubDot} />
        <div className={styles.pubBody}>
          <p className={styles.pubTitle}>Live — customers can find and order from you.</p>
        </div>
        <Link href={`/store/${slug}`} className={styles.pubLink}>
          View storefront
        </Link>
      </div>
    );
  }

  if (status === "SUSPENDED") {
    return (
      <div className={`${styles.pubStatus} ${styles.pubStatusOff}`}>
        <span className={styles.pubDot} />
        <div className={styles.pubBody}>
          <p className={styles.pubTitle}>Suspended — hidden from customers.</p>
          <p className={styles.pubSub}>Contact Skhokho support to resolve this.</p>
        </div>
      </div>
    );
  }

  if (status === "DEACTIVATED") {
    return (
      <div className={`${styles.pubStatus} ${styles.pubStatusOff}`}>
        <span className={styles.pubDot} />
        <div className={styles.pubBody}>
          <p className={styles.pubTitle}>Deactivated — hidden from customers.</p>
        </div>
      </div>
    );
  }

  // PENDING_VERIFICATION
  const ready = missing.length === 0;
  return (
    <div className={`${styles.pubStatus} ${styles.pubStatusDraft}`}>
      <span className={styles.pubDot} />
      <div className={styles.pubBody}>
        <p className={styles.pubTitle}>Draft — not public yet.</p>
        <p className={styles.pubSub}>Customers can&apos;t find or order from you until you publish.</p>
        {!ready && (
          <ul className={styles.pubChecklist}>
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </div>
      <div className={styles.pubActions}>
        <Link href="/dashboard/preview" className={styles.pubLink}>
          Preview
        </Link>
        <ActionButton
          action={publishBusinessAction}
          className={`btn btnPrimary ${styles.pubPublishBtn}`}
          pendingLabel="Publishing…"
        >
          Publish business
        </ActionButton>
      </div>
    </div>
  );
}
