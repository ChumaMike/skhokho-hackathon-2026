import type { ReactNode } from "react";
import Link from "next/link";
import DashboardNav from "@/components/DashboardNav";
import type { ContentGate } from "./gate";
import styles from "./content.module.css";

export type ContentSection = "overview" | "create" | "drafts" | "campaigns" | "brand" | "calendar";

const SUBNAV: { key: ContentSection; href: string; label: string }[] = [
  { key: "overview", href: "/dashboard/content", label: "Overview" },
  { key: "create", href: "/dashboard/content/create", label: "Create" },
  { key: "drafts", href: "/dashboard/content/drafts", label: "Drafts" },
  { key: "campaigns", href: "/dashboard/content/campaigns", label: "Campaigns" },
  { key: "brand", href: "/dashboard/content/brand", label: "Brand" },
  { key: "calendar", href: "/dashboard/content/calendar", label: "Calendar" },
];

/**
 * The shell every Content & Marketing page renders inside: the dashboard
 * nav, the section tabs, and the two honest "not available" panels. When
 * the plan lacks the studio the page body is replaced by the upgrade panel
 * — the server actions refuse independently, so this is presentation only.
 */
export default function ContentShell({ gate, current, title, lede, children }: { gate: ContentGate; current: ContentSection; title: string; lede?: string; children: ReactNode }) {
  const tabs = SUBNAV.filter((t) => (t.key === "campaigns" ? gate.canCampaign || !gate.entitled : t.key === "calendar" ? gate.canCalendar || !gate.entitled : true));
  return (
    <main className="shell">
      <div className="column">
        <span className="eyebrow">Skhokho</span>
        <h1 className={styles.title}>{title}</h1>
        {lede && <p className={styles.lede}>{lede}</p>}
        <DashboardNav current="content" {...gate.workspaceContext} />

        {!gate.permitted ? (
          <div className={`card ${styles.panel}`}>
            <p>Your role doesn&apos;t include marketing content — ask the business owner.</p>
          </div>
        ) : !gate.entitled ? (
          <div className={`card ${styles.panel}`}>
            <h2 className={styles.h2}>Content &amp; Marketing</h2>
            <p>
              <strong>Available on {gate.upgrade ? `the ${gate.upgrade.planName} plan` : "a paid plan"}</strong>
              {gate.upgrade?.priceLabel ? ` · ${gate.upgrade.priceLabel}` : ""}
              {gate.entitlements.planName ? ` — you are on ${gate.entitlements.planName}.` : "."}
            </p>
            <p>
              Write social posts, WhatsApp statuses and product descriptions from your own catalogue, keep them as drafts, group them into small campaigns and plan when to post. Your shop, orders and payments keep working exactly as they do now.
            </p>
            <p className={styles.muted}>To move plans during the pilot, contact Skhokho Labs support — plan changes are made for you, with no card needed yet.</p>
          </div>
        ) : (
          <>
            <nav className={styles.subnav} aria-label="Content sections">
              {tabs.map((t) => (
                <Link key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined} className={t.key === current ? styles.subnavActive : styles.subnavLink}>
                  {t.label}
                </Link>
              ))}
            </nav>
            {children}
          </>
        )}
      </div>
    </main>
  );
}
