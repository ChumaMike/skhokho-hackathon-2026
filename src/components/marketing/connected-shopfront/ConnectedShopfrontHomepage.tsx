import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Heart,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import { ConsoleMock, PhoneStorefront } from "./ProductMockups";
import { VERTICAL_DEMOS } from "./vertical-demo-data";
import CategoryMarquee from "./CategoryMarquee";
import MarketingCTA from "./MarketingCTA";
import MarketingFooter from "./MarketingFooter";
import styles from "./connected-shopfront.module.css";

// Short entry points into the three dedicated marketing pages — the
// homepage introduces each idea in one line, the full detail lives on its
// own page rather than being stitched into one long scroll.
const teasers = [
  { href: "/product", title: "Product", text: "Storefront, orders and bookings, customers, loyalty and a console to run it all from." },
  { href: "/for-businesses", title: "For businesses", text: "Food, salon, retail or services — see how Skhokho adapts to the way your business works." },
  { href: "/how-it-works", title: "How it works", text: "From setting up your business to bringing customers back — the process, step by step." },
];

/**
 * Connected Shopfront homepage — the site's entry point, not the whole
 * site. It introduces the pitch and links out to /product, /for-businesses
 * and /how-it-works for the full detail, rather than stitching everything
 * into one long page.
 *
 * Uses the site-wide SiteHeader (now a permanent nav into those three
 * pages, not homepage-only anchors) so every public route keeps one
 * consistent header.
 *
 * connected-shopfront.module.css pins the 8 brand tokens as literal values
 * on .page rather than inheriting globals.css's var()s — this page mixes
 * hardcoded-dark decorative overlays (hero gradient tail, consoleShowcase,
 * ctaSection scrim) with token-driven text colour, so letting the app's
 * light-mode media query flip --chalk to near-black produced dark text on
 * a dark overlay. The pack's own DESIGN_SYSTEM.md never describes a light
 * variant — this is a fixed dark brand identity, like the hero already was
 * before this redesign, not a page that should follow OS/user theme
 * preference.
 */
export default function ConnectedShopfrontHomepage() {
  return (
    <main className={styles.page}>
      <SiteHeader current="home" />

      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Real businesses. Real customers. A brighter tomorrow.</p>
          <h1>Put your business online. <span>Run it from one place.</span></h1>
          <p className={styles.heroText}>Your storefront, orders or bookings, customers, loyalty and team — set up for the way your business works.</p>
          <div className={styles.heroActions}><Link href="/join" className={styles.primaryButtonLarge}>Start free <ArrowRight size={18}/></Link><Link href="/product" className={styles.secondaryButton}>See how it works</Link></div>
          <div className={styles.heroProof}><span><ShieldCheck size={16}/> Built for South African small business</span><span><MessageCircle size={16}/> WhatsApp-ready</span><span><Heart size={16}/> No customer app needed</span></div>
        </div>
        {/* unoptimized: this repo's Next image optimizer currently fails
           on ANY local raster image in dev (confirmed with a synthetic
           4x4 test PNG, unrelated to these specific files) — the raw
           file itself serves correctly, so this bypasses the optimizer
           rather than shipping a broken hero image. Source files are
           already pre-sized/compressed. Worth re-checking against a
           deployed preview before treating this as permanent. */}
        <div className={styles.heroVisual}>
          <div className={styles.photoPanel}><Image src="/homepage/hero-owner.jpg" alt="A South African small-business owner smiling behind her counter" fill priority unoptimized sizes="(max-width: 900px) 100vw, 46vw" style={{ objectFit: "cover" }} /></div>
          <div className={styles.heroConsole}><ConsoleMock /></div>
          <div className={styles.heroPhone}><PhoneStorefront /></div>
          <div className={styles.stamp}>LOCAL<br/>BUSINESSES<br/><b>REAL IMPACT</b></div>
        </div>
      </section>

      <section className={styles.proofStrip} aria-label="Skhokho benefits"><span>Built for South African small businesses</span><span>No technical skills needed</span><span>Customers use one simple link</span><span>Works across phone & desktop</span></section>

      <CategoryMarquee />

      <section className={styles.lightSection}>
        <div className={styles.sectionHeading}><p className={styles.lightEyebrow}>Explore the platform</p><h2>Three ways to see what Skhokho gives your business.</h2><p>One platform. Different businesses. Real workflows.</p></div>
        <div className={styles.verticalTeaserRow}>
          {VERTICAL_DEMOS.map(({ key, label, icon: Icon }) => (
            <Link key={key} href="/for-businesses" className={styles.verticalTeaserChip}><Icon size={14} /> {label}</Link>
          ))}
        </div>
        <div className={styles.teaserGrid}>
          {teasers.map((t) => (
            <Link key={t.href} href={t.href} className={styles.teaserCard}>
              <h3>{t.title}</h3>
              <p>{t.text}</p>
              <span className={styles.teaserLink}>Learn more <ArrowRight size={14} /></span>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.consoleShowcase}>
        <div className={styles.consolePitch}><p className={styles.eyebrow}>A powerful console</p><h2>Run the day without losing the bigger picture.</h2><p>See what needs you now, then move into the right workspace — Orders, Kitchen, Bookings, Customers, Delivery or Storefront.</p><ul><li><Check size={16}/> Adaptive to your business</li><li><Check size={16}/> Desktop-ready management</li><li><Check size={16}/> Mobile when you need it</li></ul><Link href="/join" className={styles.primaryButtonLarge}>Start with your business <ArrowRight size={18}/></Link></div>
        <div className={styles.consoleFrame}><ConsoleMock /></div>
      </section>

      <section className={styles.customerSection}>
        <div className={styles.customerVisual}><PhoneStorefront /><div className={styles.customerGlow}/></div>
        <div className={styles.customerCopy}><p className={styles.lightEyebrow}>One link for customers</p><h2>Beautiful for them. Useful for you.</h2><p>Customers can browse, order or book without downloading another app. You keep the storefront, operations and customer relationship connected.</p><div className={styles.customerPoints}><span><UtensilsCrossed size={18}/> Food storefronts</span><span><CalendarDays size={18}/> Service bookings</span><span><Users size={18}/> Loyalty & customers</span><span><Sparkles size={18}/> Your own brand</span></div><Link href="/discover" className={styles.textLink}>Explore live businesses <ArrowRight size={17}/></Link></div>
      </section>

      <MarketingCTA />
      <MarketingFooter />
    </main>
  );
}
