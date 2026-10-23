"use client";

/** Last-resort error page (the root layout itself failed). Self-contained: no app styles or layout. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "64px 16px", textAlign: "center", background: "#fffdf8", color: "#1b1208" }}>
        <h1>Something went wrong on our side</h1>
        <p>Please try again in a moment.</p>
        <button type="button" onClick={reset} style={{ minHeight: 44, padding: "8px 16px", borderRadius: 10, border: 0, background: "#f59e0b", fontWeight: 700 }}>
          Try again
        </button>
        {error.digest && <p style={{ opacity: 0.6, fontSize: 13 }}>Reference: {error.digest}</p>}
      </body>
    </html>
  );
}
