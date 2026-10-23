import type { ReactNode } from "react";
import type { StoreIdentity, StoreOffering } from "./types";
import s from "./connected.module.css";
import Link from "next/link";

/** Customer-facing shell; never applies merchant colors to admin or invents payment/booking behavior. */
export function ConnectedStorefront({business,kind,offerings,catalogLabel,children}: {
 business:StoreIdentity;kind:"food"|"salon"|"retail"|"service";
 offerings:StoreOffering[];catalogLabel:string;children?:ReactNode;
}) {
  return <div className={`${s.root} ${s.store}`} data-kind={kind}>
    <header className={s.storeHeader}><a className={s.storeBrand} href="#top">{business.name}</a>
      <nav className={s.storeLinks} aria-label="Storefront"><a href="#catalog">{catalogLabel}</a><a href="#about">Our story</a>
        <a href="#contact">Contact</a><Link href={business.customerActionHref} className={s.storeAction}>{business.customerActionLabel} <span aria-hidden="true">→</span></Link></nav></header>
    <section className={s.storeHero} id="top">
      <div className={s.storeHeroText}><span className={`${s.eyebrow} ${s.eyebrowOnDark}`}>{business.categoryLabel}{business.location?` · ${business.location}`:""}</span>
        <h1 className={s.display}>{business.tagline}</h1><p>{business.about}</p>
        <Link className={s.storeAction} href={business.customerActionHref}>{business.customerActionLabel} <span aria-hidden="true">→</span></Link></div>
      <div className={s.storeHeroPhoto}>{business.coverUrl && <img src={business.coverUrl} alt="" />}</div>
    </section>
    <section className={s.storeContent} id="catalog"><div className={s.storeSectionHead}><div><div className={s.eyebrow}>Made for you</div>
      <h2>{catalogLabel}</h2></div><span className={s.muted}>{offerings.length} {offerings.length===1?"offering":"offerings"}</span></div>
      <div className={s.storeCards}>{offerings.map(item => <article className={s.storeCard} key={item.id}>
        {item.imageUrl?<img src={item.imageUrl} alt={item.name} loading="lazy"/>:<div className={s.storeCardArt} aria-hidden="true"/>}
        <div className={s.storeCardBody}><h3>{item.name}</h3>{item.detail&&<p>{item.detail}</p>}
          <div className={s.storeCardBottom}><strong>{item.priceLabel}</strong>
            {/* `action` is the real configurator / booking control passed in by the
             existing ProductsSection / ServicesSection. The fallback is only ever
             a link to the item page — never labelled "Book"/"Add", which would be
             a decorative control that silently does nothing. */}
            {item.action ?? <Link href={item.href}>View details <span aria-hidden="true">→</span></Link>}
          </div></div></article>)}</div>
      {offerings.length===0&&<p>No offerings are published yet.</p>}
      {children}
      <section id="about" className={s.storeAbout}><div><div className={s.eyebrow}>Behind the business</div>
        <h2 className={`${s.display} ${s.storeStoryHeading}`}>Our story. Your neighbourhood.</h2>
        <p>{business.about ?? "Find out more about the people behind this business."}</p>
      </div><div className={`${s.panel} ${s.panelPadded}`}><strong>{business.name}</strong><p>{business.location}</p>
        <Link className={s.storeAction} href={business.customerActionHref}>{business.customerActionLabel}</Link></div></section>
    </section>
    <footer id="contact" className={s.storeFooter}><strong>{business.name}</strong>
      <span>{business.location ?? "Independent business"}</span>{business.whatsappHref&&<a href={business.whatsappHref} target="_blank" rel="noopener noreferrer">WhatsApp <span aria-hidden="true">↗</span></a>}</footer>
  </div>;
}

/** Adapt real existing quote-backed checkout by passing CheckoutView as children. */
export function ConnectedCheckoutFrame({storeName,backHref,children,summary}: {
 storeName:string;backHref:string;children:ReactNode;summary?:ReactNode;
}) {
 return <main className={`${s.root} ${s.store}`}>
   <header className={s.storeHeader}><Link href={backHref}><span aria-hidden="true">←</span> Back to {storeName}</Link><strong>Secure checkout</strong></header>
   <div className={s.storeContent}><div className={s.pageHeader}><div><div className={s.eyebrow}>Your order</div>
     <h1 className={`${s.display} ${s.pageTitle}`}>Nearly there.</h1><p className={s.pageLead}>Review your choices and details before placing your order.</p></div></div>
     <div className={`${s.grid} ${s.two}`}><section className={s.panel}><div className={s.panelBody}>{children}</div></section>
       {summary&&<aside className={s.panel}><div className={s.panelHead}><h2>Order summary</h2></div><div className={s.panelBody}>{summary}</div></aside>}</div>
   </div>
 </main>;
}
