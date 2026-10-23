import type { StorefrontHighlightsContent } from "@/modules/tenant/storefront-content";
import shared from "./Shopfront.module.css";
import styles from "./ShopfrontAbout.module.css";
import { aboutHeading } from "@/lib/storefront/about-heading";

/**
 * Renders the business's real About content (StorefrontContent.about.body,
 * falling back to Business.description — same fallback AboutSection
 * already uses). The prototype's separate "Story" page is intentionally
 * merged into this one section rather than adding a duplicate content
 * field for the same information.
 */
export default function ShopfrontAbout({
  businessName,
  description,
  body,
  logoUrl,
  highlights,
  layout = "SPLIT",
}: {
  businessName: string;
  description: string | null;
  body?: string;
  logoUrl: string | null;
  highlights: StorefrontHighlightsContent;
  /** SPLIT = photo beside the story (desktop); STACKED = photo above it everywhere (layouts.ts). */
  layout?: "SPLIT" | "STACKED";
}) {
  const text = body || description;
  if (!text) return null;
  const heading = aboutHeading(body, description);

  return (
    <section className={`${shared.section} ${shared.sectionAlt}`} id="about" data-layout={layout}>
      <div className={`${shared.container} ${styles.grid}`} data-layout={layout}>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className={styles.photo} />
        ) : (
          <div className={styles.photoFallback} aria-hidden="true">
            {businessName.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <p className={shared.eyebrow}>About {businessName}</p>
          <h2 className={styles.heading}>{heading}</h2>
          <p className={styles.body}>{text}</p>
          {highlights.items.length > 0 && (
            <ul className={styles.highlights}>
              {highlights.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
