"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Menu, X, ExternalLink, Eye, Sun } from "lucide-react";
import type { DashboardSection, DashboardNavBusiness } from "./DashboardNav";
import type { AdminConsoleGroup } from "@/modules/dashboard/admin-modules";
import { DASHBOARD_ICONS } from "./dashboard-icons";
import styles from "./BusinessConsoleNav.module.css";

interface BusinessConsoleNavProps {
  current: DashboardSection;
  groups: AdminConsoleGroup[];
  business: DashboardNavBusiness | null;
}

function statusMeta(status: DashboardNavBusiness["status"] | undefined): { label: string; dotClass: string } {
  switch (status) {
    case "ACTIVE":
      return { label: "Live", dotClass: styles.dotLive };
    case "SUSPENDED":
      return { label: "Suspended", dotClass: styles.dotOff };
    case "DEACTIVATED":
      return { label: "Deactivated", dotClass: styles.dotOff };
    default:
      return { label: "Draft", dotClass: styles.dotDraft };
  }
}

function NavGroups({
  groups,
  current,
  onNavigate,
}: {
  groups: AdminConsoleGroup[];
  current: DashboardSection;
  onNavigate?: () => void;
}) {
  return (
    <>
      {groups.map((group) => (
        <section key={group.id} className={styles.group}>
          <p className={styles.groupTitle}>{group.title}</p>
          <div className={styles.groupLinks}>
            {group.modules.map((mod) => {
              const Icon = DASHBOARD_ICONS[mod.key];
              const active = current === mod.key;
              return (
                <Link
                  key={mod.key}
                  href={mod.href}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  className={`${styles.link} ${active ? styles.linkActive : ""}`}
                >
                  <Icon className={styles.linkIcon} size={18} aria-hidden="true" />
                  {mod.label}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

function IdentityBlock({ business, statusInfo }: { business: DashboardNavBusiness | null; statusInfo: { label: string; dotClass: string } }) {
  return (
    <div className={styles.identity}>
      {business?.logoUrl ? (
        // Merchant-supplied logo, not a bundled asset — plain img, small brand accent only (§8: the admin never inherits the full storefront theme).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={business.logoUrl} alt="" className={styles.logo} />
      ) : (
        <div className={styles.logoFallback} aria-hidden="true">
          {(business?.name ?? "S").charAt(0).toUpperCase()}
        </div>
      )}
      <div className={styles.identityText}>
        <span className={styles.businessName}>{business?.name ?? "Your business"}</span>
        <span className={styles.statusPill}>
          <span className={`${styles.statusDot} ${statusInfo.dotClass}`} aria-hidden="true" />
          {statusInfo.label}
        </span>
      </div>
    </div>
  );
}

function FooterLinks({ storefrontHref, onNavigate }: { storefrontHref: string | null; onNavigate?: () => void }) {
  return (
    <div className={styles.footer}>
      <Link href="/dashboard/preview" onClick={onNavigate} className={styles.footerLink}>
        <Eye className={styles.linkIcon} size={16} aria-hidden="true" />
        Preview storefront
      </Link>
      {storefrontHref && (
        <Link href={storefrontHref} target="_blank" rel="noopener noreferrer" className={styles.footerLink}>
          <ExternalLink className={styles.linkIcon} size={16} aria-hidden="true" />
          View storefront
        </Link>
      )}
    </div>
  );
}

/**
 * The grouped Business Console shell (§8 of the Business Console
 * milestone): a persistent sidebar at desktop widths, a top app bar +
 * slide-out drawer on mobile. Rendered only when workspace-nav.ts returns
 * grouped sections (Owner/Manager/General) — see DashboardNav.tsx.
 *
 * Deliberately does NOT wrap page content: it renders as a sibling within
 * each page's existing `<main className="shell"><div className="column">`
 * (zero route/page-structure changes). The desktop sidebar is
 * `position: fixed`, and globals.css reserves matching space on `.shell`
 * via a `:has(.console-sidebar-anchor)` rule — scoped automatically to
 * exactly the pages that render this component (e.g. NOT
 * /dashboard/preview, which intentionally renders the full-width
 * storefront preview with no console chrome at all).
 */
export default function BusinessConsoleNav({ current, groups, business }: BusinessConsoleNavProps) {
  const [open, setOpen] = useState(false);
  const drawerId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const trigger = triggerRef.current;

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [open]);

  const statusInfo = statusMeta(business?.status);
  const activeLabel = groups.flatMap((g) => g.modules).find((m) => m.key === current)?.label ?? "Dashboard";
  const storefrontHref = business ? `/store/${business.slug}` : null;

  return (
    <>
      <div className={styles.mobileBar}>
        <button
          ref={triggerRef}
          type="button"
          aria-label="Open navigation"
          aria-controls={drawerId}
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className={styles.iconBtn}
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <div className={styles.mobileIdentity}>
          <span className={styles.mobileBusinessName}>{business?.name ?? "Skhokho"}</span>
          <span className={styles.mobileSection}>{activeLabel}</span>
        </div>
        {storefrontHref && (
          <Link href={storefrontHref} target="_blank" rel="noopener noreferrer" aria-label="View storefront" className={styles.iconBtn}>
            <ExternalLink size={18} aria-hidden="true" />
          </Link>
        )}
      </div>

      {/* "console-sidebar-anchor" is a plain global class, deliberately not a CSS Module — it's a :has() selector hook, see globals.css */}
      <aside className={`${styles.sidebar} console-sidebar-anchor`} aria-label="Business console">
        {/* Product lockup above the business identity — the Connected shell's
            two-level "whose software / whose business" split. */}
        <div className={styles.brand}>
          <span className={styles.brandIcon} aria-hidden="true">
            <Sun size={17} />
          </span>
          Skhokho
        </div>
        <IdentityBlock business={business} statusInfo={statusInfo} />
        <nav className={styles.sidebarNav} aria-label="Business console navigation">
          <NavGroups groups={groups} current={current} />
        </nav>
        <FooterLinks storefrontHref={storefrontHref} />
        <span className={styles.footerTagline}>Real businesses. Real possibility.</span>
      </aside>

      <div className={`${styles.drawerScrim} ${open ? styles.drawerScrimOpen : ""}`}>
        <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className={styles.scrim} />
        <div
          id={drawerId}
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Business console navigation"
          className={`${styles.drawer} ${open ? styles.drawerOpen : ""}`}
        >
          <div className={styles.drawerHeader}>
            <IdentityBlock business={business} statusInfo={statusInfo} />
            <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className={styles.iconBtn}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          <nav className={styles.drawerNav} aria-label="Business console navigation (mobile)">
            <NavGroups groups={groups} current={current} onNavigate={() => setOpen(false)} />
          </nav>
          <FooterLinks storefrontHref={storefrontHref} onNavigate={() => setOpen(false)} />
        </div>
      </div>
    </>
  );
}
