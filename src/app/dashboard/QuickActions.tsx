import Link from "next/link";
import { getQuickActions } from "@/modules/dashboard/home-composition";
import type { StaffPermissions } from "@/types";
import type { BusinessCapability } from "@/modules/tenant/capabilities";
import styles from "./dashboard.module.css";

export default function QuickActions({
  capabilities,
  permissions,
  isOwner,
}: {
  capabilities: Set<BusinessCapability>;
  permissions: StaffPermissions;
  isOwner: boolean;
}) {
  const actions = getQuickActions(capabilities, permissions, isOwner);
  if (actions.length === 0) return null;

  return (
    <section className={styles.quickActions}>
      <h2 className={styles.attentionTitle}>Quick actions</h2>
      <ul className={styles.quickActionsList}>
        {actions.map((action) => (
          <li key={action.id}>
            <Link href={action.href} className={styles.quickActionItem}>
              {action.label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
