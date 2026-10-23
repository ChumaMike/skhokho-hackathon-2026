import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, ArrowRight } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import MarketingCTA from "./MarketingCTA";
import MarketingFooter from "./MarketingFooter";
import ProcessRail from "./ProcessRail";
import styles from "./connected-shopfront.module.css";
import pageStyles from "./how-it-works-page.module.css";

const FAQS = [
  {
    q: "Do my customers need to download an app?",
    a: "No. Your storefront is a normal web link — the same page works whether it's opened from WhatsApp, Instagram or a QR code, on any phone or desktop.",
  },
  {
    q: "Does Skhokho work for my kind of business?",
    a: "It adapts to what you actually do — food and takeaway, salon and beauty, retail, car wash, mechanic, events, childcare, laundry and more all have their own language and tools inside the same platform.",
  },
  {
    q: "What if I sell products and also take bookings?",
    a: "That's supported too — your storefront and console combine both a catalogue and a bookings calendar rather than forcing you into one or the other.",
  },
  {
    q: "Can my staff have their own logins?",
    a: "Yes — each team member gets their own login, scoped to only what their role needs (kitchen, counter, deliveries, bookings and so on).",
  },
];

const ONBOARDING_STEPS = [
  {
    n: "01",
    title: "What kind of business?",
    text: "Your business name and one category — this is the single choice that adapts every label and tool from here on.",
  },
  {
    n: "02",
    title: "Your details",
    text: "Name, email (your login), a WhatsApp number and a password. Nothing else is asked for.",
  },
  {
    n: "03",
    title: "Straight to your console",
    text: "No blank dashboard — the console is already speaking your language, ready for your first product, service or booking.",
  },
];

/**
 * /how-it-works — an interactive process rail (real category labels, the
 * real console mockup, the real stamp math), an honest FAQ, and an
 * onboarding walkthrough grounded in /join's actual one-form sign-up
 * (no invented pricing/tiers — see vertical-demo plan notes).
 */
export default function HowItWorksPage() {
  return (
    <main className={styles.page}>
      <SiteHeader current="howItWorks" />

      <section className={styles.pageIntro}>
        <Link href="/" className={styles.backLink}><ArrowLeft size={14} /> Back home</Link>
        <p className={styles.eyebrow}>How it works</p>
        <h1>From link to daily operations.</h1>
        <p className={styles.pageIntroText}>
          Skhokho connects the customer-facing shopfront to the work behind it — set up
          once, then it&apos;s part of how the business already runs.
        </p>
      </section>

      <section className={styles.workflowSection}>
        <ProcessRail />
      </section>

      <section className={styles.storySection}>
        <div className={styles.storyImage}>
          <Image
            src="/homepage/story-owner.jpg"
            alt="A South African small-business owner packing an order for a customer at her counter"
            fill
            unoptimized
            sizes="(max-width: 800px) 100vw, 45vw"
            style={{ objectFit: "cover" }}
          />
        </div>
        <blockquote>
          <p>&ldquo;The software should disappear into the day — customers see a simple shopfront, while the owner sees the work that matters.&rdquo;</p>
          <footer>Connected Shopfront principle</footer>
        </blockquote>
      </section>

      <section className={styles.lightSection}>
        <div className={styles.sectionHeading}>
          <p className={styles.lightEyebrow}>Getting started</p>
          <h2>One form. About a minute. No training.</h2>
          <p>Here&apos;s exactly what that first minute asks for — nothing more.</p>
        </div>
        <div className={pageStyles.onboardingSteps}>
          {ONBOARDING_STEPS.map((s) => (
            <article key={s.n} className={pageStyles.onboardingStep}>
              <span>{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </article>
          ))}
        </div>
        <Link href="/join" className={styles.primaryButtonLarge} style={{ marginTop: 30 }}>
          Start free <ArrowRight size={18} />
        </Link>
      </section>

      <section className={styles.lightSection} style={{ paddingTop: 0 }}>
        <div className={styles.sectionHeading}>
          <p className={styles.lightEyebrow}>Questions</p>
          <h2>Before you start</h2>
        </div>
        <div className={pageStyles.faq}>
          {FAQS.map((f) => (
            <details key={f.q} className={pageStyles.faqItem}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <MarketingCTA />
      <MarketingFooter />
    </main>
  );
}
