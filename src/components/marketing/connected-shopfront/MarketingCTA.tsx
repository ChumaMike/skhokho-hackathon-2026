import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import styles from "./connected-shopfront.module.css";

/**
 * Closing CTA, shared across every Connected Shopfront marketing page so a
 * visitor who lands directly on /product, /for-businesses or /how-it-works
 * (not just /) still gets a clear next step.
 */
export default function MarketingCTA() {
  return (
    <section className={styles.ctaSection}>
      <Image src="/connected-shopfront/sa-growth-art.svg" alt="" fill sizes="100vw" className={styles.ctaArt} />
      <div>
        <p className={styles.eyebrow}>Built for where you are. Ready for where you&rsquo;re going.</p>
        <h2>Give your business one place to meet its customers — and run what comes next.</h2>
        <div className={styles.heroActions}>
          <Link href="/join" className={styles.primaryButtonLarge}>Start free <ArrowRight size={18} /></Link>
          <Link href="/discover" className={styles.secondaryButton}>See live businesses</Link>
        </div>
      </div>
    </section>
  );
}
