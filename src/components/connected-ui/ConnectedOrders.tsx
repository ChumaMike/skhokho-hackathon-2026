import type { ReactNode } from "react";
import type { OrderRow, Tone } from "./types";
import s from "./connected.module.css";
import Link from "next/link";

export function StatusPill({tone,label}: {tone: Tone; label: string}) {
  return <span className={s.pill} data-tone={tone}>{label}</span>;
}

/**
 * `rowActions` renders the caller's already-authorized server-action forms in
 * a trailing column. It exists because the screen this replaces let staff
 * advance or cancel an order straight from the list; forcing them to select a
 * row first would add a click to the single most repeated action in a busy
 * shop. The component never decides what is allowed — it renders whatever the
 * authenticated Server Component hands it, or nothing.
 */
export function OrdersTable({orders,selectedId,hrefForOrder,rowActions}: {
  orders:OrderRow[];selectedId?:string;hrefForOrder?:(id:string)=>string;rowActions?:(order:OrderRow)=>ReactNode;
}) {
  if (!orders.length) return <div className={s.empty}>No orders to display.</div>;
  return <div className={s.tableWrap}><table className={s.table}>
    <thead><tr><th>Order</th><th>Customer</th><th>Fulfilment</th><th>Total</th><th>Status</th><th>When</th>
      {rowActions && <th><span className={s.srOnly}>Actions</span></th>}</tr></thead>
    <tbody>{orders.map(o => <tr key={o.id} aria-selected={o.id===selectedId}>
      <td className={s.mono}>{hrefForOrder ? <Link href={hrefForOrder(o.id)} className={s.tableLink}>{o.number}</Link>:o.number}
        {/* What's actually in the order, under its number. The card list this
            table replaces showed this inline, and a queue you have to click
            into to see contents is a slower queue. */}
        {o.items && o.items.length > 0 &&
          <span className={s.rowSummary}>{o.items.map(i=>`${i.quantity}× ${i.label}`).join(", ")}</span>}</td>
      <td>{o.customer}</td><td>{o.fulfilment}</td><td className={s.mono}>{o.total}</td>
      <td><StatusPill tone={o.tone} label={o.statusLabel}/></td><td>{o.placedAt??"—"}</td>
      {rowActions && <td className={s.rowActions}>{rowActions(o)}</td>}</tr>)}</tbody>
  </table></div>;
}

/**
 * Action slots hold EXISTING server-action forms / authorized transitions,
 * never decorative buttons.
 *
 * `toolbar` sits under the page header for filters the caller owns (the
 * status tabs, in this app). `children` renders after the queue for anything
 * else the route needs to keep — this app puts its "ask for a review" list
 * there. Both exist so migrating a real screen onto this layout does not mean
 * silently dropping the parts the layout did not anticipate.
 */
export function ConnectedOrders({orders,selectedId,hrefForOrder,actions,rowActions,toolbar,children,emptyMessage}: {
  orders:OrderRow[];selectedId?:string;hrefForOrder:(id:string)=>string;actions?:ReactNode;
  rowActions?:(order:OrderRow)=>ReactNode;toolbar?:ReactNode;children?:ReactNode;emptyMessage?:string;
}) {
  const selected=orders.find(o=>o.id===selectedId)??orders[0];
  return <main className={`${s.root} ${s.page}`}>
    <div className={s.pageHeader}><div><div className={s.eyebrow}>Run your business</div>
      <h1 className={`${s.display} ${s.pageTitle}`}>Orders</h1><p className={s.pageLead}>See what’s new, move work along and keep customers updated.</p></div>
      <Link href="/dashboard" className={s.button}><span aria-hidden="true">←</span> Home</Link></div>
    {toolbar}
    <div className={`${s.grid} ${s.two}`}>
      <section className={s.panel}><div className={s.panelHead}><h2>Order queue</h2><span className={s.pill}>{orders.length} shown</span></div>
        {orders.length===0 && emptyMessage ? <div className={s.empty}>{emptyMessage}</div>
          : <OrdersTable orders={orders} selectedId={selected?.id} hrefForOrder={hrefForOrder} rowActions={rowActions}/>}</section>
      <aside className={s.panel}><div className={s.panelHead}><h2>Selected order</h2>{selected && <StatusPill tone={selected.tone} label={selected.statusLabel}/>}</div>
        <div className={s.panelBody}>{selected ? <div className={s.orderDetail}>
          <h2>{selected.number}</h2><div><strong>{selected.customer}</strong><p className={s.muted}>{selected.fulfilment}</p></div>
          {selected.items?.map((i,idx)=><div key={`${i.label}-${idx}`}><div className={s.orderLine}><span>{i.quantity} × {i.label}</span>
            {i.priceLabel && <span className={s.mono}>{i.priceLabel}</span>}</div>
            {i.options?.map(opt=><div key={opt} className={s.orderOptions}>{opt}</div>)}</div>)}
          <div className={`${s.orderLine} ${s.orderTotal}`}><span>Total</span><span>{selected.total}</span></div>
          {actions}</div> : <div className={s.empty}>No order selected.</div>}</div></aside>
    </div>
    {children}
  </main>;
}
