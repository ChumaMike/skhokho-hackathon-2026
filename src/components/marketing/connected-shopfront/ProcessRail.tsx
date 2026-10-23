"use client";

import { useState, type CSSProperties } from "react";
import { Link2, QrCode } from "lucide-react";
import { BUSINESS_CATEGORIES } from "@/lib/business-categories";
import { stampTransform } from "@/app/dashboard/customers/stamp-seed";
import { ConsoleMock } from "./ProductMockups";
import styles from "./how-it-works-page.module.css";

const STEPS = [
  ["01", "Set up your business", "Tell Skhokho what you sell or do. Your tools and language adapt around that from the first step."],
  ["02", "Share one storefront", "Put the link on WhatsApp, Instagram, a QR code or anywhere your customers already are."],
  ["03", "Run the day", "Orders, bookings, customers and staff activity land in one operating console — not four different apps."],
  ["04", "Bring people back", "Keep the relationship after the sale with customer history and loyalty stamps."],
] as const;

const SAMPLE_CATEGORIES = BUSINESS_CATEGORIES.slice(0, 6);

function CategoryFragment() {
  return (
    <div className={styles.fragmentChips} aria-label="Real business categories from Skhokho's own sign-up form">
      {SAMPLE_CATEGORIES.map(([id, label], i) => (
        <span key={id} className={i === 1 ? styles.fragmentChipActive : styles.fragmentChip}>{label}</span>
      ))}
    </div>
  );
}

function LinkFragment() {
  return (
    <div className={styles.fragmentLink}>
      <span className={styles.fragmentUrl}><Link2 size={15} /> skhokho.co.za/store/your-business</span>
      <div className={styles.fragmentQr} aria-hidden="true"><QrCode size={64} /></div>
    </div>
  );
}

function ConsoleFragment() {
  return (
    <div className={styles.fragmentConsole}>
      <ConsoleMock />
    </div>
  );
}

const STAMP_REQUIRED = 8;
const STAMP_FILLED = 4;

function StampFragment() {
  return (
    <article className={styles.fragmentStampCard} aria-label={`A loyalty card with ${STAMP_FILLED} of ${STAMP_REQUIRED} stamps filled`}>
      <header className={styles.fragmentStampHeader}>
        <span>Demo customer</span>
        <span className={styles.fragmentStampMeta}>
          <span className={styles.fragmentStampProgress}>{STAMP_FILLED} of {STAMP_REQUIRED}</span>
          <span className={styles.fragmentStampCode}>SK-4821</span>
        </span>
      </header>
      <div className={styles.fragmentStamps} aria-hidden="true">
        {Array.from({ length: STAMP_REQUIRED }, (_, i) => {
          if (i < STAMP_FILLED) {
            const t = stampTransform("process-rail-demo", i);
            const style = { "--rotate": `${t.rotate}deg`, "--ox": `${t.x}px`, "--oy": `${t.y}px` } as CSSProperties;
            return <span key={i} className={styles.fragmentDisc} style={style} />;
          }
          return <span key={i} className={styles.fragmentDiscEmpty} />;
        })}
      </div>
      <p className={styles.fragmentStampHint}>{STAMP_REQUIRED - STAMP_FILLED} more visits to a reward</p>
    </article>
  );
}

const FRAGMENTS = [CategoryFragment, LinkFragment, ConsoleFragment, StampFragment];

/**
 * The 4-step "how it works" process, made interactive: clicking a step
 * swaps a small supporting visual next to it, each grounded in something
 * real (actual category labels, the real console mockup, the real stamp
 * rotation math) rather than decorative filler.
 */
export default function ProcessRail() {
  const [active, setActive] = useState(0);
  // Named ActiveFragment rather than the shorter "Fragment" purely to
  // avoid shadowing React's own well-known export of that name — not
  // fixing an actual bug, just avoiding a confusing identifier.
  const ActiveFragment = FRAGMENTS[active];

  return (
    <div className={styles.processRail}>
      <div className={styles.processSteps} role="tablist" aria-label="How Skhokho works, step by step">
        {STEPS.map(([n, t, d], i) => (
          <button
            key={n}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-controls="process-fragment"
            className={`${styles.processStep} ${i === active ? styles.processStepActive : ""}`}
            onClick={() => setActive(i)}
          >
            <span className={styles.processNum}>{n}</span>
            <span className={styles.processStepBody}>
              <strong>{t}</strong>
              <span>{d}</span>
            </span>
          </button>
        ))}
      </div>
      <div id="process-fragment" className={styles.processFrame} role="tabpanel">
        <ActiveFragment />
      </div>
    </div>
  );
}
