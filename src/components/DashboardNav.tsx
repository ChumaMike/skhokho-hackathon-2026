import Link from "next/link";
import { getWorkspaceNav } from "@/lib/workspace-nav";
import type { StaffPermissions, StaffWorkspace } from "@/types";
import type { BusinessCapability } from "@/modules/tenant/capabilities";
import type { BusinessCategory, BusinessStatus } from "@prisma/client";
import BusinessConsoleNav from "./BusinessConsoleNav";
import { DASHBOARD_ICONS } from "./dashboard-icons";
import styles from "./DashboardNav.module.css";

export type DashboardSection =
  | "home"
  | "customers"
  | "orders"
  | "kitchen"
  | "appointments"
  | "leads"
  | "catalog"
  | "storefront"
  | "staff"
  | "assistant"
  | "analytics"
  | "settings"
  | "domains"
  | "payments"
  | "deliveries"
  | "content";

export interface DashboardNavBusiness {
  name: string;
  slug: string;
  logoUrl: string | null;
  status: BusinessStatus;
}

export interface DashboardNavProps {
  current: DashboardSection;
  isOwner: boolean;
  permissions: StaffPermissions;
  primaryWorkspace: StaffWorkspace | null;
  capabilities?: Set<BusinessCapability>;
  businessCategory?: BusinessCategory;
  business?: DashboardNavBusiness | null;
}

/**
 * Shared across every /dashboard/* screen. The section list itself is no
 * longer a static array here — it comes from the central
 * src/lib/workspace-nav.ts policy, which is presentation-only: hiding a
 * link here never replaces the independent requireOwner()/
 * requireStaffPermission() checks every page and action already has.
 *
 * Two render modes, decided by whether workspace-nav.ts returned grouped
 * sections: the full merchant console (Owner/Manager/General — grouped
 * sidebar/drawer, business identity, "View storefront") delegates to
 * BusinessConsoleNav; the deliberately minimal single-link operational
 * workspaces (Kitchen/Delivery/Counter) keep today's plain inline links —
 * wrapping a single link in a whole console shell would be exactly the
 * "duplicate the entire dashboard application" this codebase has already
 * decided against (see workspace-nav.ts's KITCHEN/DELIVERY cases).
 */
export default function DashboardNav({
  current,
  isOwner,
  permissions,
  primaryWorkspace,
  capabilities,
  businessCategory,
  business,
}: DashboardNavProps) {
  const { sections, groups } = getWorkspaceNav({ isOwner, permissions, primaryWorkspace, capabilities, businessCategory });

  if (groups && groups.length > 0) {
    return <BusinessConsoleNav current={current} groups={groups} business={business ?? null} />;
  }

  return (
    <nav className={styles.nav} aria-label="Dashboard">
      {sections.map((section) => {
        const Icon = DASHBOARD_ICONS[section.key];
        return (
          <Link
            key={section.key}
            href={section.href}
            className={`${styles.link} ${current === section.key ? styles.linkActive : ""}`}
          >
            <Icon className={styles.icon} size={18} aria-hidden="true" />
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
