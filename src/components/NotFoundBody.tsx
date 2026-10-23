import Link from "next/link";

/**
 * Shared by two distinct not-found paths that both need this content:
 *   - src/app/not-found.tsx — Next's own special-file boundary, used by
 *     `notFound()` calls (e.g. store/[slug]/page.tsx) and genuinely
 *     unmatched routes.
 *   - src/app/not-found/page.tsx — the literal routed page
 *     src/middleware.ts rewrites reserved subdomains, inactive
 *     businesses, and unrecognised hosts to. Middleware rewrites need an
 *     actual matchable route, which Next's special file isn't (it's a
 *     rendering boundary, not a routable path) — hence two entry points
 *     for what should look like one page to a visitor.
 */
export default function NotFoundBody() {
  return (
    <main className="shell">
      <div className="column">
        <div style={{ textAlign: "center", paddingTop: 80 }}>
          <span className="eyebrow">Not found</span>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-xl)", margin: "8px 0 12px" }}>
            Nothing here yet
          </h1>
          <p style={{ color: "var(--dust)", marginBottom: 24 }}>
            That business page doesn&apos;t exist, or isn&apos;t live yet.
          </p>
          <Link href="/discover" className="btn btnPrimary">
            Find a business
          </Link>
        </div>
      </div>
    </main>
  );
}
