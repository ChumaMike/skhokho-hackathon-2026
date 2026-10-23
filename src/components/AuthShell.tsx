import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import styles from "./AuthShell.module.css";

/**
 * Split-panel shell for every auth page (login, staff-login, join,
 * forgot-password, reset-password) — a photo/brand panel on one side, the
 * actual form on the other, replacing the plain centred card these five
 * pages shared before. No concept-pack reference exists for this (checked
 * both packs, neither has a login/signup screen) — original design work,
 * within the app's existing dark --ink/--chalk/--amber tokens (these are
 * regular app pages, not the marketing site's fixed-dark identity or the
 * storefront's fixed-neutral one, so they still flip with the viewer's OS
 * theme like the rest of the app).
 *
 * Presentation only — every page using this keeps its own <form>,
 * action="/api/platform/...", field names and validation completely
 * unchanged; this component contributes no new behaviour.
 */
export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className={styles.shell}>
      <div className={styles.imagePanel}>
        {/* unoptimized: see ConnectedShopfrontHomepage.tsx's identical note
           — this repo's local image optimizer fails on any local raster
           image in dev; re-verify against a deployed preview. A king
           protea (South Africa's national flower) rather than another
           owner portrait — this page isn't about any one business type, so
           a symbolic brand image fits better than a specific narrative
           photo already used elsewhere (hero-owner.jpg/story-owner.jpg). */}
        <Image
          src="/homepage/auth-protea.jpg"
          alt="A king protea, South Africa's national flower"
          fill
          priority
          unoptimized
          sizes="(max-width: 860px) 100vw, 46vw"
          style={{ objectFit: "cover" }}
        />
        <div className={styles.imageScrim} />
        <Link href="/" className={styles.brandMark}>
          <span className={styles.sunmark}>S</span> Skhokho
        </Link>
        <p className={styles.imageQuote}>Real businesses. Real customers. A brighter tomorrow.</p>
      </div>

      <div className={styles.formPanel}>
        <div className={styles.formPanelInner}>
          <Link href="/" className={styles.brandMarkCompact}>
            <span className={styles.sunmark}>S</span> Skhokho
          </Link>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.subtitle}>{subtitle}</p>

          {children}

          {footer && <div className={styles.footer}>{footer}</div>}
        </div>
      </div>
    </main>
  );
}
