import ActionButton from "@/components/ActionButton";
import Link from "next/link";
import { markAllReadAction } from "./notifications/actions";
import type { BusinessNotificationRow } from "@/modules/dashboard/notifications";
import styles from "./dashboard.module.css";

function formatWhen(date: Date): string {
  return date.toLocaleString("en-ZA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * The guaranteed fallback to email: BusinessNotification rows are written
 * transactionally with the event that created them (a new order, a new
 * booking), so this list can never miss something the way an unconfigured
 * or failed email can. Server component — ActionButton (client) handles
 * the one interactive bit.
 */
export default function RecentActivity({
  items,
  unreadCount,
}: {
  items: BusinessNotificationRow[];
  unreadCount: number;
}) {
  if (items.length === 0) return null;

  return (
    <section className={styles.recentActivity}>
      <div className={styles.recentActivityHeader}>
        <h2 className={styles.attentionTitle}>
          Recent activity{unreadCount > 0 && <span className={styles.recentActivityBadge}>{unreadCount}</span>}
        </h2>
        {unreadCount > 0 && (
          <ActionButton action={markAllReadAction} className={styles.recentActivityMarkRead} pendingLabel="Marking…">
            Mark all read
          </ActionButton>
        )}
      </div>
      <ul className={styles.recentActivityList}>
        {items.map((item) => (
          <li
            key={item.id}
            className={`${styles.recentActivityItem} ${item.isRead ? "" : styles.recentActivityItemUnread}`}
          >
            <div className={styles.recentActivityItemBody}>
              <span className={styles.recentActivityItemTitle}>{item.title}</span>
              <span className={styles.recentActivityItemMessage}>{item.message}</span>
            </div>
            <span className={styles.recentActivityItemTime}>{formatWhen(item.createdAt)}</span>
          </li>
        ))}
      </ul>
      <p><Link href="/dashboard/notifications">All notifications →</Link></p>
    </section>
  );
}
