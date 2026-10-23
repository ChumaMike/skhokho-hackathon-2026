import Link from "next/link";
import type { CSSProperties } from "react";
import type { BusinessCategory } from "@prisma/client";
import { categoryLabel } from "@/lib/business-categories";
import shared from "./Shopfront.module.css";
import styles from "./ShopfrontHero.module.css";
import { whatsappLink } from "@/lib/utils";

/**
 * Full-bleed hero using the business's own real bannerUrl — never a stock
 * placeholder photo (nothing here belongs to a business that hasn't
 * uploaded one yet). No bannerUrl degrades gracefully to a colour-only
 * hero built from the business's own primary/accent tokens, same honest
 * "nothing fabricated" discipline as the rest of this codebase.
 */
export default function ShopfrontHero({
  business,
  headline,
  subheadline,
  basePath,
  rating,
  primaryAction,
  size = "default",
}: {
  business: { name: string; category: BusinessCategory; bannerUrl: string | null; suburb: string | null; city: string | null; whatsapp: string | null; description: string | null };
  headline?: string;
  subheadline?: string;
  basePath: string;
  rating?: { average: number; count: number };
  /** Defaults to "Shop the collection" → `${basePath}/shop` (Phase 1, product businesses). The booking variant (ShopfrontBookingHome) passes its own "Book now" action instead — same component, different call to action, never a forked copy of this file. */
  primaryAction?: { label: string; href: string };
  /** "compact" = a short banner so the content below (e.g. a menu) starts on the first phone screen. */
  size?: "default" | "compact";
}) {
  const location = business.suburb || business.city;
  const waLink = whatsappLink(business.whatsapp);
  const action = primaryAction ?? { label: "Shop the collection", href: `${basePath}/shop` };

  return (
    <section
      className={styles.hero}
      style={business.bannerUrl ? ({ "--hero-image": `url(${JSON.stringify(business.bannerUrl)})` } as CSSProperties) : undefined}
      data-has-image={business.bannerUrl ? "true" : "false"}
      data-size={size}
    >
      <div className={`${shared.container} ${styles.content}`}>
        <p className={shared.eyebrow}>
          {categoryLabel(business.category)}
          {location ? ` · ${location}` : ""}
          {rating && rating.count > 0 ? ` · ★ ${rating.average.toFixed(1)} (${rating.count})` : ""}
        </p>
        <h1 className={styles.heading}>{headline || business.name}</h1>
        <p className={styles.sub}>{subheadline || business.description || `Welcome to ${business.name}.`}</p>
        <div className={styles.actions}>
          <Link href={action.href} className={`${shared.btn} ${shared.btnPrimary}`} data-sf-event="CTA_CLICK" data-sf-section="HERO">
            {action.label}
          </Link>
          {/* The WhatsApp shortcut, unless WhatsApp already IS the main button. */}
          {waLink && !action.href.startsWith("https://wa.me/") && (
            <a href={waLink} className={`${shared.btn} ${styles.btnGhost}`} data-sf-event="ENQUIRY_CLICK" data-sf-section="HERO">
              Chat on WhatsApp
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
