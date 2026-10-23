import type { OwnerHomeModel } from "./types";
import { StatusPill, OrdersTable } from "./ConnectedOrders";
import s from "./connected.module.css";
import Link from "next/link";

/** Do not calculate sales in this component: existing dashboard/page.tsx supplies truthful scoped signals. */
export function ConnectedHome({model}: {model: OwnerHomeModel}) {
  return <main className={`${s.root} ${s.page}`}>
    <div className={s.pageHeader}><div><div className={s.eyebrow}>{model.eyebrow ?? "Your business, connected"}</div>
      <h1 className={`${s.display} ${s.pageTitle}`}>{model.greeting}</h1>
      <p className={s.pageLead}>{model.intro ?? "Here’s what’s happening — and what needs you."}</p></div>
      {model.storefrontHref && <Link className={s.button} href={model.storefrontHref}>View storefront <span aria-hidden="true">↗</span></Link>}</div>
    {/* The top priority is promoted to a banner, so the list below starts at
        the second one — the pack rendered priorities[0] in both places, which
        showed the most urgent item to the owner twice. */}
    {model.priorities.length > 0 && <div className={s.notice} data-tone={model.priorities[0].tone ?? "new"}>
      <div><h2>{model.priorities[0].title}</h2>
      {model.priorities[0].detail && <p>{model.priorities[0].detail}</p>}</div>
      <Link href={model.priorities[0].href} className={`${s.button} ${s.buttonDark}`}>Take action <span aria-hidden="true">→</span></Link></div>}
    <div className={`${s.grid} ${s.four} ${s.gridSpaced}`}>
      {model.signals.map(signal => <div className={s.metric} key={signal.label}>
        <span className={s.metricLabel}>{signal.label}</span><span className={s.metricValue}>{signal.value}</span>
        {signal.detail && <span className={s.metricDetail}>{signal.detail}</span>}
      </div>)}</div>
    <div className={`${s.grid} ${s.two}`}>
      <section className={s.panel}><div className={s.panelHead}><h2>What needs you</h2><span className={s.small}>Prioritised</span></div>
        <div className={s.panelBody}><div className={s.list}>{model.priorities.length<=1 ? <div className={s.empty}>{model.priorities.length===1
            // One priority means it is already promoted to the banner above;
            // saying "all caught up" directly under it reads as a contradiction.
            ? "Nothing else needs you." : "You’re all caught up."}</div>
          : model.priorities.slice(1).map(p => <Link className={s.listRow} href={p.href} key={p.id}>
            <StatusPill tone={p.tone ?? "neutral"} label={p.tone ?? "neutral"} /><span className={s.listRowText}><strong>{p.title}</strong>{p.detail && <span>{p.detail}</span>}</span><span aria-hidden="true">↗</span>
          </Link>)}</div></div></section>
      <section className={s.panel}><div className={s.panelHead}><h2>Your storefront</h2><StatusPill tone="ready" label="Connected" /></div>
        <div className={s.panelBody}><div className={s.eyebrow}>Customer-facing</div>
          <h2 className={`${s.display} ${s.panelHeadline}`}>{model.storefrontTitle ?? "Your business, online."}</h2>
          <p className={s.muted}>{model.storefrontDescription ?? "A real storefront your customers can visit and share."}</p>
          {model.storefrontEditorHref && <Link className={`${s.button} ${s.buttonPrimary}`} href={model.storefrontEditorHref}>Manage storefront <span aria-hidden="true">→</span></Link>}
        </div></section>
    </div>
    {model.orders && <div className={s.sectionSpaced}><section className={s.panel}><div className={s.panelHead}><h2>Recent orders</h2>
      {model.ordersHref && <Link href={model.ordersHref} className={s.strong}>View all <span aria-hidden="true">→</span></Link>}</div>
      <OrdersTable orders={model.orders}/></section></div>}
    {model.children}
  </main>;
}
