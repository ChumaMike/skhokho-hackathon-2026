import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Check,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  Store,
  Users,
} from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import { ConsoleMock } from "./ProductMockups";
import VerticalDemoSwitcher from "./VerticalDemoSwitcher";
import StampCardDemo from "./StampCardDemo";
import MarketingCTA from "./MarketingCTA";
import MarketingFooter from "./MarketingFooter";
import styles from "./connected-shopfront.module.css";
import pageStyles from "./product-page.module.css";

const capabilities = [
  {
    icon: Store,
    title: "Online storefront",
    text: "A page for what you sell or offer, ready to share the same day — no separate website builder to learn.",
    detail: "Your own branded page at one shareable link. Colours, hero and catalogue all update from inside the same console you already use — never a second tool to keep in sync.",
  },
  {
    icon: ShoppingBag,
    title: "Orders & bookings",
    text: "Customers order for collection or delivery, or book a slot with the person they want, from the same link.",
    detail: "Products and services share one checkout flow, with real-time slot availability for bookings and a server-checked total at checkout — never a price a customer can tamper with.",
  },
  {
    icon: Users,
    title: "Customers & loyalty",
    text: "Every visit fills a stamp card. See who's a regular, who's gone quiet, and reward the people who keep coming back.",
    detail: "Try the real card interaction below — the same rubber-stamp tilt and tap your customers see, no login needed to try it here.",
  },
  {
    icon: PackageCheck,
    title: "Run the work",
    text: "Kitchen, counter, delivery and staff tools appear as your business needs them — the same platform, more workspace.",
    detail: "Kitchen shows tickets moving New → Preparing → Ready. Counter is a fast product grid for walk-ins. Delivery dispatch assigns drivers to orders that are ready. Each only appears for the staff role that needs it.",
  },
  {
    icon: BarChart3,
    title: "Know what is happening",
    text: "See what needs your attention right now, instead of digging through reports to find it.",
    detail: "The home screen is built around what needs a decision today — not a wall of charts you have to interpret yourself.",
  },
  {
    icon: ShieldCheck,
    title: "Built to grow",
    text: "Staff permissions, tenant isolation and adaptive tools stay consistent as your team gets bigger.",
    detail: "Every staff member's access is scoped by permission, not just job title, and every business's data stays isolated from every other business on the platform.",
  },
];

/**
 * /product — what a business actually gets, in full: capability
 * deep-dives (native <details>, real extra detail on expand), a real
 * loyalty-card demo, and the vertical switcher in phone-only mode with
 * /product-specific copy (not the homepage's sections reused verbatim).
 */
export default function ProductPage() {
  return (
    <main className={styles.page}>
      <SiteHeader current="product" />

      <section className={styles.pageIntro}>
        <Link href="/" className={styles.backLink}><ArrowLeft size={14} /> Back home</Link>
        <p className={styles.eyebrow}>The connected platform</p>
        <h1>Everything you need to run and grow your business.</h1>
        <p className={styles.pageIntroText}>
          One platform, not a bundle of separate tools. Your storefront, your orders or
          bookings, your customers and your team all live in the same place — set up for
          the way your business actually works.
        </p>
      </section>

      <section className={styles.lightSection}>
        <div className={styles.sectionHeading}>
          <p className={styles.lightEyebrow}>What you get</p>
          <h2>Real workflows, not a generic dashboard.</h2>
          <p>Tap any of these to see more.</p>
        </div>
        <div className={styles.capabilityGrid}>
          {capabilities.map(({ icon: Icon, title, text, detail }) => (
            <details key={title} className={`${styles.capability} ${pageStyles.capability}`}>
              <summary className={pageStyles.capabilitySummary}>
                <span>
                  <div className={styles.iconDisc}><Icon size={21} /></div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </span>
                <span className={pageStyles.indicator} aria-hidden="true" />
              </summary>
              <p className={pageStyles.capabilityBody}>{detail}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={pageStyles.loyaltyDemo}>
        <div className={pageStyles.loyaltyPhoto}>
          <Image
            src="/homepage/product-customer.jpg"
            alt="A customer checking her phone outside a small business"
            fill
            unoptimized
            sizes="(max-width: 900px) 100vw, 30vw"
            style={{ objectFit: "cover" }}
          />
        </div>
        <div>
          <p className={styles.eyebrow}>Customers & loyalty</p>
          <h2>The card your customers actually see.</h2>
          <p>
            No punch cards to lose, no app to download. Every visit fills a slot,
            hand-stamped-looking every time — try it yourself.
          </p>
        </div>
        <StampCardDemo />
      </section>

      <section className={styles.consoleShowcase}>
        <div className={styles.consolePitch}>
          <p className={styles.eyebrow}>A powerful console</p>
          <h2>One home screen for everything that needs you.</h2>
          <p>
            Metric tiles, a sales chart and the orders that actually need a decision —
            then move into the right workspace from there.
          </p>
          <ul>
            <li><Check size={16} /> Adaptive to your business</li>
            <li><Check size={16} /> Desktop-ready management</li>
            <li><Check size={16} /> Mobile when you need it</li>
          </ul>
          <Link href="/join" className={styles.primaryButtonLarge}>Start with your business <ArrowRight size={18} /></Link>
        </div>
        <div className={styles.consoleFrame}><ConsoleMock /></div>
      </section>

      <section className={styles.customerSection}>
        <div className={`${styles.customerVisual} ${pageStyles.customerVisualDemo}`}>
          <VerticalDemoSwitcher mode="phone" />
        </div>
        <div className={styles.customerCopy}>
          <p className={styles.lightEyebrow}>What your customers see</p>
          <h2>This is what your customers open — whatever you sell.</h2>
          <p>
            Switch between a few business types above. Same platform underneath, a
            different, fitted experience for whoever opens the link.
          </p>
          <Link href="/for-businesses" className={styles.textLink}>See how this fits your business <ArrowRight size={17} /></Link>
        </div>
      </section>

      <MarketingCTA />
      <MarketingFooter />
    </main>
  );
}
