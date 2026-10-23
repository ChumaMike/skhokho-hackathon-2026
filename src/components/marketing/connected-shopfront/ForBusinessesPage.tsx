import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Store, Sparkles, ShoppingBag, Wrench } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import MarketingCTA from "./MarketingCTA";
import MarketingFooter from "./MarketingFooter";
import VerticalDemoSwitcher from "./VerticalDemoSwitcher";
import styles from "./connected-shopfront.module.css";

/**
 * /for-businesses — the page most directly about "different businesses,
 * different setups," so it gets the full interactive vertical demo
 * (console + phone mockup, synced to the same tab as the detail list)
 * rather than static always-visible cards. Vertical content itself lives in
 * vertical-demo-data.ts, shared with the mockups so the demo and the copy
 * can never drift apart.
 */
export default function ForBusinessesPage() {
  return (
    <main className={styles.page}>
      <SiteHeader current="forBusinesses" />

      <section className={styles.pageIntro}>
        <Link href="/" className={styles.backLink}><ArrowLeft size={14} /> Back home</Link>
        <p className={styles.eyebrow}>Different businesses. Same possibilities.</p>
        <h1>One platform that adapts around the business.</h1>
        <p className={styles.pageIntroText}>
          The underlying platform is shared — but what you see and what your customers
          see adapts to how your business actually works. Try switching between a few
          below.
        </p>
      </section>

      {/* Two crops of the same real street-scene photo used for the old
         single panorama — split into a deliberate two-up composition (an
         "under one roof" pairing and a "street-facing" pairing) rather than
         one flat banner, with a label chip per panel setting up the
         "different businesses, same platform" pitch before the switcher
         below makes it interactive. */}
      <div className={styles.diptych}>
        <div className={styles.diptychPanel}>
          <Image
            src="/homepage/for-businesses-left.jpg"
            alt="A food vendor plating a takeaway order, with a hair salon chair behind"
            fill
            unoptimized
            sizes="(max-width: 700px) 100vw, 50vw"
            style={{ objectFit: "cover" }}
          />
          <div className={styles.diptychLabels}>
            <span className={styles.diptychChip}><Store size={13} /> Food &amp; takeaway</span>
            <span className={styles.diptychChip}><Sparkles size={13} /> Salon &amp; beauty</span>
          </div>
        </div>
        <div className={styles.diptychGap} aria-hidden="true" />
        <div className={styles.diptychPanel}>
          <Image
            src="/homepage/for-businesses-right.jpg"
            alt="A clothing rack outside a retail shop, with a mechanic working on a car alongside"
            fill
            unoptimized
            sizes="(max-width: 700px) 100vw, 50vw"
            style={{ objectFit: "cover" }}
          />
          <div className={styles.diptychLabels}>
            <span className={styles.diptychChip}><ShoppingBag size={13} /> Retail</span>
            <span className={styles.diptychChip}><Wrench size={13} /> Services</span>
          </div>
        </div>
      </div>

      <section className={styles.businessSection}>
        <VerticalDemoSwitcher mode="both" showDetails />
      </section>

      <MarketingCTA />
      <MarketingFooter />
    </main>
  );
}
