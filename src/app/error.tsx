"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Shown when a page fails to render. Plain words, a way forward, and no
 * error details (those go to the server logs, never to the visitor).
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[page error]", error.digest ?? "");
  }, [error]);

  return (
    <main className="shell">
      <div className="column" style={{ textAlign: "center", paddingTop: 64 }}>
        <h1>Something went wrong on our side</h1>
        <p>Please try again. If it keeps happening, wait a few minutes — we&apos;re on it.</p>
        <p style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btnPrimary" onClick={reset}>
            Try again
          </button>
          <Link className="btn" href="/">
            Go to the home page
          </Link>
        </p>
        {error.digest && <p style={{ opacity: 0.6, fontSize: 13 }}>Reference: {error.digest}</p>}
      </div>
    </main>
  );
}
