import type { ReactNode } from "react";
import s from "./connected.module.css";
import { StatusPill } from "./ConnectedOrders";
import type { Tone } from "./types";
import Link from "next/link";

/** A useful base for owner Customers/Team screens; pass already permission-filtered rows. */
export function ConnectedRecords({title,description,headers,rows,actions,emptyMessage}: {
 title:string;description?:string;headers:string[];
 rows:{id:string;values:ReactNode[];href?:string}[];actions?:ReactNode;emptyMessage?:string;
}) {
 return <main className={`${s.root} ${s.page}`}><div className={s.pageHeader}><div>
   <div className={s.eyebrow}>Your business</div><h1 className={`${s.display} ${s.pageTitle}`}>{title}</h1>
   {description&&<p className={s.pageLead}>{description}</p>}</div>{actions}</div>
   <section className={s.panel}>{!rows.length?<div className={s.empty}>{emptyMessage??"No records yet."}</div>:
     <div className={s.tableWrap}><table className={s.table}><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead>
       <tbody>{rows.map(row=><tr key={row.id}>{row.values.map((value,i)=><td key={`${row.id}-${i}`}>
         {i===0&&row.href?<Link className={s.tableLink} href={row.href}>{value}</Link>:value}
       </td>)}</tr>)}</tbody></table></div>}</section></main>;
}

export type CalendarBooking={id:string;title:string;timeLabel:string;detail?:string;href:string;statusLabel:string;tone:Tone};
/** Display real availability from service query; do not generate or promise staff slots. */
export function ConnectedBookings({dateLabel,bookings,nextHref}: {
 dateLabel:string;bookings:CalendarBooking[];nextHref?:string;
}) {
 return <main className={`${s.root} ${s.page}`}><div className={s.pageHeader}><div>
   <div className={s.eyebrow}>Run your business</div><h1 className={`${s.display} ${s.pageTitle}`}>Bookings</h1>
   <p className={s.pageLead}>{dateLabel} · Your confirmed and upcoming work.</p></div>
   {nextHref&&<Link href={nextHref} className={`${s.button} ${s.buttonPrimary}`}>Manage services <span aria-hidden="true">→</span></Link>}</div>
   <section className={s.panel}><div className={s.panelHead}><h2>Appointments</h2><span className={s.pill}>{bookings.length}</span></div>
     <div className={s.panelBody}><div className={s.list}>{bookings.length===0?<div className={s.empty}>No bookings for this date.</div>:
       bookings.map(b=><Link href={b.href} key={b.id} className={s.listRow}>
         <div className={`${s.mono} ${s.bookingTime}`}>{b.timeLabel}</div>
         <div className={s.listRowText}><strong>{b.title}</strong>{b.detail&&<span>{b.detail}</span>}</div>
         <StatusPill tone={b.tone} label={b.statusLabel}/><span aria-hidden="true">↗</span>
       </Link>)}</div></div></section></main>;
}
