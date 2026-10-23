import type { ReactNode } from "react";
import type { ConsoleIdentity, NavGroup } from "./types";
import s from "./connected.module.css";
import Link from "next/link";

/** Server-safe layout. Pass navigation already filtered by admin-modules/permissions. */
export function ConnectedConsole({identity,groups,children}: {
  identity: ConsoleIdentity; groups: NavGroup[]; children: ReactNode;
}) {
  const nav = groups.map(group => (
    <div key={group.title}>
      <div className={s.navHeading}>{group.title}</div>
      {group.items.map(item => <Link className={s.navLink} data-active={Boolean(item.active)}
        aria-current={item.active ? "page" : undefined} href={item.href} key={item.href}>
        <span aria-hidden="true">{item.active ? "●" : "○"}</span>{item.label}
      </Link>)}
    </div>
  ));
  return <div className={`${s.root} ${s.shell}`}>
    <aside className={s.sidebar} aria-label="Business navigation">
      <div className={s.brand}><span className={s.brandIcon} aria-hidden="true">✺</span>Skhokho</div>
      <div className={s.identity}><strong>{identity.businessName}</strong>
        <small>{identity.categoryLabel ?? "Business"}{identity.status ? ` · ${identity.status}` : ""}</small></div>
      <nav>{nav}</nav>
      <div className={s.sidebarFooter}>{identity.storefrontHref && <Link href={identity.storefrontHref}>View your storefront <span aria-hidden="true">↗</span></Link>}
        <span>Real businesses. Real possibility.</span></div>
    </aside>
    <div className={s.workspace}>
      <details className={s.mobileNav}><summary>✺ Skhokho · {identity.businessName} ☰</summary><nav>
        {groups.flatMap(g => g.items).map(item => <Link key={item.href} href={item.href} aria-current={item.active ? "page" : undefined}>{item.label}</Link>)}
      </nav></details>
      <header className={s.topbar}><div><strong>{identity.businessName}</strong><div className={s.topbarHint}>Your connected business workspace</div></div>
        <span className={s.pill} data-tone="ready">{identity.status ?? "Business"}</span></header>
      <div className={s.content}>{children}</div>
    </div>
  </div>;
}
