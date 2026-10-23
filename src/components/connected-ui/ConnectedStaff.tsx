import type { ReactNode } from "react";
import type { KitchenTicket, StoreOffering } from "./types";
import { StatusPill } from "./ConnectedOrders";
import s from "./connected.module.css";
import Link from "next/link";

/** Ticket action is the actual server-action form from current kitchen/page.tsx. */
export function ConnectedKitchen({newTickets,preparing,ready}: {
  newTickets:KitchenTicket[];preparing:KitchenTicket[];ready?:KitchenTicket[];
}) {
 // `ready` is optional rather than an empty array: a service whose kitchen
 // query stops at PROCESSING (as this app's listKitchenOrders does) should
 // show two columns, not a third that can never fill.
 const columns=[{title:"New",items:newTickets,tone:"new" as const},{title:"Preparing",items:preparing,tone:"preparing" as const},
   ...(ready ? [{title:"Ready",items:ready,tone:"ready" as const}] : [])];
 return <main className={`${s.root} ${s.staffDark}`}>
   <div className={s.pageHeader}><div><div className={s.eyebrow}>Staff operations · Kitchen</div><h1 className={`${s.display} ${s.pageTitle}`}>Keep the food moving.</h1>
     <p className={s.pageLead}>Clear tickets. Simple actions. No customer contact or payment details.</p></div>
   <Link href="/dashboard" className={s.button}><span aria-hidden="true">←</span> Workspace</Link></div>
   <div className={s.ticketBoard}>{columns.map(col=><section key={col.title}>
     <div className={s.columnHead}><h2>{col.title}</h2><StatusPill tone={col.tone} label={String(col.items.length)}/></div>
     <div className={s.grid}>{col.items.length===0&&<p className={s.staffEmpty}>No tickets.</p>}
       {col.items.map(ticket=><article key={ticket.id} className={s.ticket}>
         <div className={s.ticketTop}><h3>{ticket.number}</h3><span className={s.pill} data-tone={col.tone}>{ticket.ageLabel}</span></div>
         {ticket.fulfilment && <div className={s.small}>{ticket.fulfilment}</div>}
         {ticket.items.map((item,idx)=><div key={`${item.name}-${idx}`} className={s.ticketItem}>
           <strong>{item.quantity} × {item.name}</strong>{item.options?.map(option=><span className={s.ticketOption} key={option}>{option}</span>)}</div>)}
         {ticket.note&&<p className={s.small}>Note: {ticket.note}</p>}
         <div className={s.ticketFooter}>{ticket.action}</div>
       </article>)}</div></section>)}</div>
 </main>;
}

/** Integrate actual CounterPOS basket & sale action through cartSlot, not a new POS transaction implementation. */
export function ConnectedCounter({products,cartSlot}: {products:(StoreOffering & {action: ReactNode})[];cartSlot:ReactNode}) {
 return <main className={`${s.root} ${s.staffDark}`}><div className={s.pageHeader}><div>
   <div className={s.eyebrow}>Staff operations · Counter</div><h1 className={`${s.display} ${s.pageTitle}`}>Make the sale.</h1>
   <p className={s.pageLead}>Find items quickly, build one order and complete it with your existing payment flow.</p></div></div>
   <div className={s.posGrid}><section className={s.panel}><div className={s.panelHead}><h2>Menu and products</h2></div><div className={s.panelBody}>
     <div className={s.posProducts}>{products.map(p=><article className={s.posCard} key={p.id}>
       <div className={s.eyebrow}>{p.category ?? "Item"}</div><strong>{p.name}</strong><span>{p.priceLabel}</span>
       {/* No decorative fallback here on purpose: a link labelled "Select" that
           doesn't touch the basket is exactly the fake control the integration
           brief forbids, so `action` is required above and rendered as-is. */}
       {p.action}</article>)}</div>
   </div></section><aside className={s.posBasket}><h2>Current sale</h2>{cartSlot}</aside></div>
 </main>;
}

/** One-job phone surface; caller owns authorization, status transitions and address privacy. */
export function ConnectedDriver({number,stopLabel,address,summary,actions}: {
  number:string;stopLabel:string;address:string;summary?:string;actions:ReactNode;
}) {
 return <main className={`${s.root} ${s.staffDark}`}><div className={s.driver}>
   <div className={s.eyebrow}>Your delivery</div><h1 className={`${s.display} ${s.pageTitle}`}>{number}</h1>
   <StatusPill tone="preparing" label={stopLabel}/><div className={s.driverAddress}>{address}</div>
   {summary&&<p className={s.muted}>{summary}</p>}<div className={s.driverActions}>{actions}</div>
 </div></main>;
}
