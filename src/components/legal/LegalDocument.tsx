import Link from "next/link";
import type { ReactNode } from "react";
import { parseLegalMarkdown, type Block, type Inline } from "@/lib/legal/markdown";
import type { LegalDocument as LegalDocumentMeta } from "@/lib/legal/documents";
import styles from "./LegalDocument.module.css";

/**
 * Renders one of the platform's legal documents (Terms, Privacy) from its
 * generated markdown copy. The page chrome (version banner, draft warning,
 * sibling links) is the same for every document so a customer always sees
 * which version is in force — the version string here is the one recorded
 * on their order or booking when they accept.
 */
export default function LegalDocument({ meta, markdown }: { meta: LegalDocumentMeta; markdown: string }) {
  const blocks = parseLegalMarkdown(markdown);
  return (
    <main className="shell">
      <div className={`column ${styles.column}`}>
        <span className="eyebrow">Skhokho · Skhokho Laboratory (&ldquo;Skhokho Labs&rdquo;)</span>
        <p className={styles.versionLine}>
          <span>
            Version <code>{meta.version}</code>
          </span>
          {meta.draft && <span className={styles.draftBadge}>Draft for attorney review — not yet in force</span>}
        </p>
        <nav className={styles.siblings} aria-label="Legal documents">
          <Link href="/terms" aria-current={meta.key === "terms" ? "page" : undefined}>
            Terms of Service
          </Link>
          <Link href="/privacy" aria-current={meta.key === "privacy" ? "page" : undefined}>
            Privacy Notice
          </Link>
        </nav>
        <article className={styles.article}>{blocks.map((b, i) => renderBlock(b, i))}</article>
        <p className={styles.back}>
          <Link href="/">Back to Skhokho</Link>
        </p>
      </div>
    </main>
  );
}

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.kind) {
      case "text":
        return n.text;
      case "strong":
        return <strong key={i}>{renderInline(n.children)}</strong>;
      case "code":
        return <code key={i}>{n.text}</code>;
      case "link": {
        const internal = n.href.startsWith("/");
        return internal ? (
          <Link key={i} href={n.href}>
            {renderInline(n.children)}
          </Link>
        ) : (
          <a key={i} href={n.href} rel="noopener noreferrer">
            {renderInline(n.children)}
          </a>
        );
      }
    }
  });
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.kind) {
    case "heading": {
      const children = renderInline(block.children);
      if (block.level === 1) return <h1 key={key} id={block.id} className={styles.h1}>{children}</h1>;
      if (block.level === 2) return <h2 key={key} id={block.id} className={styles.h2}>{children}</h2>;
      if (block.level === 3) return <h3 key={key} id={block.id} className={styles.h3}>{children}</h3>;
      return <h4 key={key} id={block.id} className={styles.h4}>{children}</h4>;
    }
    case "paragraph":
      return <p key={key}>{renderInline(block.children)}</p>;
    case "list":
      return block.ordered ? (
        <ol key={key}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case "quote":
      return (
        <blockquote key={key} className={styles.quote}>
          {block.children.map((b, i) => renderBlock(b, i))}
        </blockquote>
      );
    case "table":
      return (
        <div key={key} className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th key={i}>{renderInline(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c}>{renderInline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "rule":
      return <hr key={key} className={styles.rule} />;
    case "code":
      return (
        <pre key={key} className={styles.pre}>
          <code>{block.text}</code>
        </pre>
      );
  }
}
