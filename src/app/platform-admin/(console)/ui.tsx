import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./admin.module.css";

export function PageHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <h1 className={styles.title}>{title}</h1>
      {sub && <p className={styles.sub}>{sub}</p>}
    </>
  );
}

export function Stats({ items }: { items: { label: string; value: ReactNode; tone?: "ok" | "warn" | "bad" }[] }) {
  return (
    <div className={styles.grid}>
      {items.map((s) => (
        <div key={s.label} className={styles.stat}>
          <div className={`${styles.statValue} ${s.tone ? styles[s.tone] : ""}`}>{s.value}</div>
          <div className={styles.statLabel}>{s.label}</div>
        </div>
      ))}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Table({ head, rows, empty = "Nothing here." }: { head: string[]; rows: ReactNode[][]; empty?: string }) {
  if (rows.length === 0) return <p className={styles.muted}>{empty}</p>;
  return (
    <table className={styles.table}>
      <thead>
        <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: "ok" | "warn" | "bad" }) {
  return <span className={`${styles.badge} ${tone ? styles[tone] : ""}`}>{children}</span>;
}

/** Filter chips that build a query string; the current one is highlighted. */
export function Filters({
  base,
  param,
  options,
  current,
  keep = {},
}: {
  base: string;
  param: string;
  options: { value: string; label: string }[];
  current: string;
  keep?: Record<string, string | undefined>;
}) {
  const href = (v: string) => {
    const q = new URLSearchParams(Object.entries({ ...keep, [param]: v }).filter(([, x]) => x) as [string, string][]);
    return `${base}?${q.toString()}`;
  };
  return (
    <nav className={styles.filters}>
      {options.map((o) => (
        <Link key={o.value} href={href(o.value)} aria-current={o.value === current ? "page" : undefined}>
          {o.label}
        </Link>
      ))}
    </nav>
  );
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className={styles.kv}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Banner({ ok, err }: { ok?: string; err?: string }) {
  return (
    <>
      {ok && <div className="successBanner">Done.</div>}
      {err && <div className="errorBanner">{err}</div>}
    </>
  );
}

/** A reason box every sensitive admin command carries (validated server-side too). */
export function ReasonField({ placeholder = "Reason (recorded in the audit log)" }: { placeholder?: string }) {
  return <input className="input" name="reason" aria-label="Reason (recorded in the audit log)" placeholder={placeholder} required minLength={5} maxLength={500} />;
}

export const when = (d: Date | null | undefined) => (d ? d.toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" }) : "—");
export { styles };
