import Link from "next/link";
import type { ReactNode } from "react";
import { adminPage } from "@/modules/platform-admin/page-guard";
import { can, ROLE_LABELS, type AdminPermission } from "@/modules/platform-admin/permissions";
import styles from "./admin.module.css";

export const dynamic = "force-dynamic";

const NAV: { href: string; label: string; perm: AdminPermission }[] = [
  { href: "/platform-admin", label: "Overview", perm: "overview" },
  { href: "/platform-admin/businesses", label: "Businesses & shops", perm: "businesses.view" },
  { href: "/platform-admin/users", label: "Users", perm: "users.view" },
  { href: "/platform-admin/orders", label: "Orders", perm: "orders.view" },
  { href: "/platform-admin/payments", label: "Payments", perm: "payments.view" },
  { href: "/platform-admin/drivers", label: "Drivers", perm: "drivers.view" },
  { href: "/platform-admin/deliveries", label: "Deliveries", perm: "deliveries.view" },
  { href: "/platform-admin/payouts", label: "Payouts", perm: "payouts.view" },
  // Billing = merchants paying Skhokho Laboratory. Distinct from "Payments"
  // above (merchants' own customers paying them) and "Payouts" (driver
  // earnings) — three separate money streams, deliberately separate screens.
  { href: "/platform-admin/billing", label: "Billing", perm: "billing.view" },
  { href: "/platform-admin/domains", label: "Domains", perm: "domains.view" },
  { href: "/platform-admin/ai", label: "AI", perm: "ai.view" },
  { href: "/platform-admin/data-subjects", label: "Data-subject requests", perm: "privacy.manage" },
  { href: "/platform-admin/security", label: "Security", perm: "security.view" },
  { href: "/platform-admin/audit", label: "Audit log", perm: "audit.view" },
  { href: "/platform-admin/health", label: "System health", perm: "health" },
  { href: "/platform-admin/settings", label: "Settings", perm: "settings.view" },
];

/**
 * The one platform admin console. Navigation shows only what the admin's role
 * allows — presentation only: every page and action checks its own
 * permission again (adminPage / requireAdmin).
 */
export default async function AdminConsoleLayout({ children }: { children: ReactNode }) {
  const admin = await adminPage("overview");
  return (
    <div className={styles.frame}>
      <aside className={styles.side}>
        <div className={styles.brand}>Skhokho admin</div>
        <div className={styles.who}>
          {admin.email} · {ROLE_LABELS[admin.role]}
        </div>
        <nav className={styles.nav} aria-label="Admin">
          {NAV.filter((n) => can(admin.role, n.perm)).map((n) => (
            <Link key={n.href} href={n.href}>
              {n.label}
            </Link>
          ))}
        </nav>
        <form method="post" action="/api/admin/logout" style={{ marginTop: 18 }}>
          <button type="submit" className="btn btnBlock">Sign out</button>
        </form>
      </aside>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
